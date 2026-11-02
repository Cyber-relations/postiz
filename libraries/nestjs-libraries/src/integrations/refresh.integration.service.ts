import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';
import {
  TOYBACO_LEGACY_MISSING_POST_WORKFLOW,
  TOYBACO_LEGACY_MISSING_POST_WORKFLOW_ID,
  TOYBACO_LEGACY_TERMINATE_REASON,
  TOYBACO_REFRESH_TOKEN_WORKFLOW_V2,
  TOYBACO_TOKEN_LIFECYCLE_PROVIDERS,
  ToybacoTokenGeneration,
  ToybacoTokenLifecycleStatus,
  ToybacoTokenRefreshResult,
  toybacoChannelNoticeEmailsEnabled,
  toybacoFinalMayDisconnect,
  toybacoGenerationMismatch,
  toybacoRefreshRejected,
  toybacoRefreshWorkflowId,
  toybacoTimeMs,
  toybacoTokenLifecyclePolicy,
  toybacoTokenLifecycleStatusOf,
} from '@gitroom/nestjs-libraries/toybaco/token-lifecycle';

// toybaco_token_lifecycle_v2: log は固定語と ID だけにする。provider の error 本文は
// URL に token を含むことがあるため出さない。
const toybacoLog = (event: string, fields: Record<string, unknown> = {}) =>
  `toybaco_token_lifecycle_v2 event=${event}${Object.entries(fields)
    .map(([key, value]) => ` ${key}=${String(value)}`)
    .join('')}`;
const toybacoErrorName = (err: unknown) =>
  String((err as { name?: unknown })?.name || 'Error').replace(/[^A-Za-z0-9_]/g, '');

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(
    integration: Integration,
    cause = '',
    toybacoOptions: { expiryOnly?: boolean } = {}
  ): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(
      integration,
      socialProvider,
      cause,
      toybacoOptions.expiryOnly === true
    );

    if (!refresh) {
      return false as const;
    }

    if (refresh === 'keep-current') {
      return this.toybacoCurrentToken(integration);
    }

    const saved = await this._integrationService.saveRefreshedIntegration(
      integration,
      !!socialProvider.oneTimeToken,
      refresh.accessToken,
      refresh.refreshToken,
      refresh.expiresIn,
      refresh
    );

    return saved ? refresh : false;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    if (!(await this._integrationService.setBetweenRefreshSteps(integration))) {
      return;
    }
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(orgId: string, id: string, integration: SocialProvider) {
    // toybaco_token_lifecycle_v2: 更新方針のある provider は V2 を起動し、同じ ID の旧版を置き換える。
    if (toybacoTokenLifecyclePolicy(integration.identifier)) {
      return this._temporalService.client
        .getRawClient()
        ?.workflow.start(TOYBACO_REFRESH_TOKEN_WORKFLOW_V2, {
          workflowId: toybacoRefreshWorkflowId(id),
          args: [{ integrationId: id, organizationId: orgId }],
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        });
    }

    if (!integration.refreshCron) {
      return false;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start(`refreshTokenWorkflow`, {
        workflowId: `refresh_${id}`,
        args: [{integrationId: id, organizationId: orgId}],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      });
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = '',
    expiryOnly = false
  ): Promise<AuthTokenDetails | false | 'keep-current'> {
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(integration.refreshToken)
      .catch((err) => false);

    // toybaco_token_lifecycle_v2: 期限の経過だけで呼んだ更新が空 token を返したのは、
    // 更新の仕組みが無いだけで失効ではない。refreshNeeded にせず今の token を使い続ける。
    if (expiryOnly && refresh && !refresh.accessToken) {
      console.log(
        toybacoLog('expiry_refresh_kept_current', {
          provider: integration.providerIdentifier,
          integration: integration.id,
        })
      );
      return 'keep-current';
    }

    if (!refresh || !refresh.accessToken) {
      if (!(await this._integrationService.markRefreshNeeded(integration))) {
        return false;
      }

      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        cause
      );

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    const reConnect = await socialProvider.reConnect(
      integration.rootInternalId,
      integration.internalId,
      refresh.accessToken
    );

    return {
      ...refresh,
      ...reConnect,
    };
  }

  private toybacoCurrentToken(integration: Integration): AuthTokenDetails {
    return {
      accessToken: integration.token,
      refreshToken: integration.refreshToken || '',
      expiresIn: 0,
      id: integration.internalId,
      name: integration.name,
      picture: integration.picture || '',
      username: integration.profile || '',
    };
  }

  async toybacoTokenLifecycleState(
    integrationId: string,
    organizationId: string
  ): Promise<ToybacoTokenLifecycleStatus> {
    return toybacoTokenLifecycleStatusOf(
      await this._integrationService.getIntegrationById(organizationId, integrationId)
    );
  }

  // 状態を変えない更新。失敗しても refreshNeeded にせず、workflow が間を置いて再試行する。
  async toybacoSoftRefresh(
    integrationId: string,
    organizationId: string,
    expected?: ToybacoTokenGeneration
  ): Promise<ToybacoTokenRefreshResult> {
    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration || !toybacoTokenLifecycleStatusOf(integration).active) {
      return { status: 'inactive' };
    }
    if (this.toybacoGenerationStale(integration, expected, 'soft')) {
      return { status: 'stale' };
    }
    const attempt = await this.toybacoTryRefresh(integration, 'soft');
    return 'error' in attempt ? { status: 'failed' } : attempt;
  }

  // 再試行を尽くした後の最後の段。更新の失敗を上流と同じ破壊的な経路(refreshNeeded と再接続の
  // 通知。disconnectChannel と同じ 2 手)へ渡すのは、provider が資格情報の失効を確かめた時か、
  // 実際に期限を過ぎた時だけ。それ以外の失敗は failed を返し、V2 が状態を保って再試行する。
  async toybacoFinalRefresh(
    integrationId: string,
    organizationId: string,
    expected?: ToybacoTokenGeneration
  ): Promise<ToybacoTokenRefreshResult> {
    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration || !toybacoTokenLifecycleStatusOf(integration).active) {
      return { status: 'inactive' };
    }
    if (this.toybacoGenerationStale(integration, expected, 'final')) {
      return { status: 'stale' };
    }
    const fields = {
      provider: integration.providerIdentifier,
      integration: integration.id,
    };
    const attempt = await this.toybacoTryRefresh(integration, 'final');
    if (!('error' in attempt)) {
      return attempt;
    }
    const rejected = toybacoRefreshRejected(integration.providerIdentifier, attempt.error);
    if (
      !toybacoFinalMayDisconnect(toybacoTokenLifecyclePolicy(integration.providerIdentifier)!, {
        nowMs: Date.now(),
        tokenExpirationMs: toybacoTimeMs(integration.tokenExpiration),
        rejected,
      })
    ) {
      console.log(toybacoLog('final_refresh_deferred', fields));
      return { status: 'failed' };
    }
    // PZ のメールを on にする PR の前提(#556 の D の裁定): sendEmailWorkflow と
    // EmailActivity に、配送の鍵での重複の除きを入れること。markRefreshNeeded の更新の条件は
    // 資格情報の一致だけで refreshNeeded を見ないので、final と投稿・分析の経路の更新が同じ
    // 資格情報で並行して失敗すると、どちらも再接続の通知を出しうる(上流からの弱点。画面の中の
    // 通知も重なりうる)。失効の知らせなので、時間帯は限らない。
    if (await this._integrationService.markRefreshNeeded(integration)) {
      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        '',
        toybacoChannelNoticeEmailsEnabled(process.env)
      );
      console.log(
        toybacoLog('final_refresh_needed', {
          ...fields,
          reason: rejected ? 'rejected' : 'expired',
        })
      );
      return { status: 'refresh-needed' };
    }
    // 同時の再接続・更新・切断に負けた。
    const current = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!current || current.deletedAt) {
      return { status: 'inactive' };
    }
    if (current.refreshNeeded) {
      console.log(toybacoLog('final_refresh_needed', fields));
      return { status: 'refresh-needed' };
    }
    return {
      status:
        current.token !== integration.token ||
        current.refreshToken !== integration.refreshToken
          ? 'stale'
          : 'failed',
    };
  }

  // workflow が知っている世代と、今の接続の世代が違えば、資格情報に触らずに stale を返す。
  private toybacoGenerationStale(
    integration: Integration,
    expected: ToybacoTokenGeneration | undefined,
    stage: 'soft' | 'final'
  ) {
    if (!toybacoGenerationMismatch(expected, toybacoTimeMs(integration.tokenExpiration))) {
      return false;
    }
    console.log(
      toybacoLog(`${stage}_refresh_stale`, {
        provider: integration.providerIdentifier,
        integration: integration.id,
        reason: 'generation',
      })
    );
    return true;
  }

  // provider の更新を 1 回試して保存する。失敗しても refreshNeeded にはせず、error を返す。
  private async toybacoTryRefresh(
    integration: Integration,
    stage: 'soft' | 'final'
  ): Promise<ToybacoTokenRefreshResult | { error: unknown }> {
    const fields = {
      provider: integration.providerIdentifier,
      integration: integration.id,
    };
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    let refresh: AuthTokenDetails;
    try {
      refresh = await socialProvider.refreshToken(integration.refreshToken!);
      if (
        refresh?.accessToken &&
        socialProvider.reConnect &&
        integration.rootInternalId !== integration.internalId
      ) {
        refresh = {
          ...refresh,
          ...(await socialProvider.reConnect(
            integration.rootInternalId!,
            integration.internalId,
            refresh.accessToken
          )),
        };
      }
    } catch (err) {
      console.error(
        toybacoLog(`${stage}_refresh_failed`, { ...fields, error: toybacoErrorName(err) })
      );
      return { error: err };
    }
    if (!refresh?.accessToken) {
      console.error(toybacoLog(`${stage}_refresh_failed`, { ...fields, error: 'EmptyToken' }));
      return { error: null };
    }
    const saved = await this._integrationService.saveRefreshedIntegration(
      integration,
      !!socialProvider.oneTimeToken,
      refresh.accessToken,
      refresh.refreshToken,
      refresh.expiresIn,
      refresh
    );
    if (!saved) {
      // 同時の再接続・更新に負けたなら読み直す。資格情報が同じまま拒まれたなら失敗として間を置く。
      const current = await this._integrationService.getIntegrationById(
        integration.organizationId,
        integration.id
      );
      if (!current || current.deletedAt) {
        return { status: 'inactive' };
      }
      if (
        current.token === integration.token &&
        current.refreshToken === integration.refreshToken
      ) {
        console.error(toybacoLog(`${stage}_refresh_failed`, { ...fields, error: 'Rejected' }));
        return { status: 'failed' };
      }
      console.log(toybacoLog(`${stage}_refresh_stale`, fields));
      return { status: 'stale' };
    }
    console.log(toybacoLog(`${stage}_refresh_succeeded`, fields));
    return { status: 'refreshed' };
  }

  // 対象の provider の integration について更新 workflow の稼働を確かめ、欠けていれば V2 を起動する。
  // 旧版(refreshTokenWorkflow / missingPostWorkflow)の run は V2 に置き換える。対象外の provider(TikTok など)の
  // run は上流のまま触らない。
  async toybacoReconcileTokenLifecycle() {
    const workflow = this._temporalService.client.getRawClient()?.workflow;
    const summary = {
      checked: 0,
      running: 0,
      started: 0,
      replaced: 0,
      failed: 0,
      legacy_missing_post: 'unknown',
    };
    if (!workflow) {
      console.error(toybacoLog('reconcile_unavailable'));
      return summary;
    }

    try {
      const legacy = workflow.getHandle(TOYBACO_LEGACY_MISSING_POST_WORKFLOW_ID);
      const description = await legacy.describe();
      if (
        description.status.name === 'RUNNING' &&
        description.type === TOYBACO_LEGACY_MISSING_POST_WORKFLOW
      ) {
        await legacy.terminate(TOYBACO_LEGACY_TERMINATE_REASON);
        summary.legacy_missing_post = 'terminated';
        console.log(toybacoLog('legacy_missing_post_terminated'));
      } else {
        summary.legacy_missing_post = 'not-running';
      }
    } catch (err) {
      summary.legacy_missing_post =
        toybacoErrorName(err) === 'WorkflowNotFoundError' ? 'absent' : 'failed';
    }

    const candidates = await this._integrationService.toybacoTokenLifecycleCandidates(
      TOYBACO_TOKEN_LIFECYCLE_PROVIDERS
    );
    for (const candidate of candidates) {
      if (!toybacoTokenLifecyclePolicy(candidate.providerIdentifier)) {
        continue;
      }
      summary.checked += 1;
      const workflowId = toybacoRefreshWorkflowId(candidate.id);
      const fields = {
        provider: candidate.providerIdentifier,
        integration: candidate.id,
      };
      let replacing = false;
      try {
        const description = await workflow.getHandle(workflowId).describe();
        if (description.status.name === 'RUNNING') {
          if (description.type === TOYBACO_REFRESH_TOKEN_WORKFLOW_V2) {
            summary.running += 1;
            continue;
          }
          replacing = true;
        }
      } catch (err) {
        if (toybacoErrorName(err) !== 'WorkflowNotFoundError') {
          summary.failed += 1;
          console.error(
            toybacoLog('reconcile_describe_failed', { ...fields, error: toybacoErrorName(err) })
          );
          continue;
        }
      }
      try {
        await workflow.start(TOYBACO_REFRESH_TOKEN_WORKFLOW_V2, {
          workflowId,
          args: [{ integrationId: candidate.id, organizationId: candidate.organizationId }],
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        });
        if (replacing) {
          summary.replaced += 1;
        } else {
          summary.started += 1;
        }
        console.log(
          toybacoLog(replacing ? 'reconcile_replaced' : 'reconcile_started', fields)
        );
      } catch (err) {
        summary.failed += 1;
        console.error(
          toybacoLog('reconcile_start_failed', { ...fields, error: toybacoErrorName(err) })
        );
      }
    }
    console.log(toybacoLog('reconcile', summary));
    return summary;
  }
}
