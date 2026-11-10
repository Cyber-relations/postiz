import { lockConnectSelection, assertConnectSelectionLock, unlockConnectSelection } from '@gitroom/nestjs-libraries/toybaco/connect-browser';
import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ToybacoGmbLookupError } from '@gitroom/nestjs-libraries/integrations/social/gmb.provider';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { toybacoTokenExpiryRequiresRefresh } from '@gitroom/nestjs-libraries/toybaco/token-lifecycle';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  NotEnoughScopes,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { difference, uniq } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { TemporalService } from 'nestjs-temporal-core';
import { toybacoNotificationJa } from '@gitroom/nestjs-libraries/toybaco/notification.ja';

import { instagramCommentCapability, refreshInstagramPermissionSnapshot } from '@gitroom/nestjs-libraries/toybaco/instagram-comment-permissions';

dayjs.extend(utc);

@Injectable()
export class IntegrationService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integrationRepository: IntegrationRepository,
    private _autopostsRepository: AutopostRepository,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _temporalService: TemporalService
  ) {}

  async changeActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);

    for (const item of data.filter((f) => f.active)) {
      try {
        await this._temporalService.terminateWorkflow(`autopost-${item.id}`);
      } catch (err) {}
    }

    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  updateProviderSettings(org: string, id: string, additionalSettings: string) {
    return this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string,
    toybacoInstagramPermissionSnapshot?: string
  ) {
    // toybaco_provider_allowlist_v1: 外部通信やDB更新より前の最終保存境界。
    if (
      type === 'social' &&
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(provider)
    ) {
      throw new HttpException('Integration not allowed', HttpStatus.FORBIDDEN);
    }

    const uploadedPicture = picture
      ? picture?.indexOf('imagedelivery.net') > -1
        ? picture
        : await this.storage.uploadSimple(picture).catch((err) => {
            console.log('Failed to upload profile picture:', picture, err);
            return undefined;
          })
      : undefined;

    return this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails,
      toybacoInstagramPermissionSnapshot
    );
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  getIntegrationsList(org: string) {
    return this._integrationRepository.getIntegrationsList(org);
  }

  getIntegrationForOrder(id: string, order: string, user: string, org: string) {
    return this._integrationRepository.getIntegrationForOrder(
      id,
      order,
      user,
      org
    );
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(id, name, url);
  }

  getIntegrationById(org: string, id: string) {
    return this._integrationRepository.getIntegrationById(org, id);
  }

  getIntegrationByInternalId(org: string, internalId: string) {
    return this._integrationRepository.getIntegrationByInternalId(
      org,
      internalId
    );
  }

  async refreshToken(provider: SocialProvider, refresh: string) {
    try {
      const result = await provider.refreshToken(refresh);
      const { refreshToken, accessToken, expiresIn } = result;

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { ...result, refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration, err = '') {
    if (
      integration.organizationId !== orgId ||
      !(await this.markRefreshNeeded(integration))
    ) {
      return;
    }
    await this.informAboutRefreshError(orgId, integration, err);
  }

  // A reconnect that came back from a different provider (MIGRATE_PROVIDERS):
  // match the disconnected channel by profile and move it to the new provider
  // in place, so scheduled posts, settings and customers survive. Throws the
  // same error as a mismatched reconnect when the migration is not configured
  // or the user connected a different account.
  async migrateIntegration(
    org: string,
    oldInternalId: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const existing = await this._integrationRepository.getIntegrationByInternalId(
      org,
      oldInternalId
    );

    if (
      !existing ||
      this._integrationManager.getMigrationTarget(
        existing.providerIdentifier
      ) !== newProvider
    ) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    const oldProvider = this._integrationManager.getSocialIntegration(
      existing.providerIdentifier
    );

    if (!oldProvider.migrationMatch(auth, existing)) {
      throw new NotEnoughScopes(
        `Please connect the same account (@${existing.profile}) that needs to be refreshed`
      );
    }

    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      throw new NotEnoughScopes(
        'This account is already connected as another channel, please delete one of them first'
      );
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  // A fresh connect of a migration target (MIGRATE_PROVIDERS) for an account
  // the org already has on the source provider: adopt that channel instead of
  // creating a confusing duplicate - the channel is migrated in place exactly
  // like a reconnect, and the follow-up upsert stores the fresh tokens. A no-op
  // when nothing matches, so a genuinely new account still creates a channel.
  async migrateIntegrationOnConnect(
    org: string,
    newProvider: string,
    auth: { id: string; username: string }
  ) {
    const sources = this._integrationManager.getMigrationSources(newProvider);
    if (
      !sources.length ||
      this._integrationManager.getSocialIntegration(newProvider).isBetweenSteps
    ) {
      return;
    }

    // the account already exists on the new provider: the normal upsert
    // updates it, nothing to adopt
    if (
      await this._integrationRepository.getIntegrationByInternalId(org, auth.id)
    ) {
      return;
    }

    const existing = (
      await this._integrationRepository.getIntegrationsList(org)
    ).find(
      (p) =>
        sources.includes(p.providerIdentifier) &&
        this._integrationManager
          .getSocialIntegration(p.providerIdentifier)
          .migrationMatch(auth, p)
    );

    if (!existing) {
      return;
    }

    return this._integrationRepository.migrateIntegration(
      org,
      existing.id,
      auth.id,
      newProvider,
      existing.rootInternalId === existing.internalId
        ? auth.id
        : existing.rootInternalId
    );
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = '',
    // toybaco_token_lifecycle_v2: V2 の final だけがメールの可否を渡す。上流の呼び出しは今までどおり送る。
    toybacoSendEmail = true
  ) {
    // 再接続通知は workflow を通らないため、この service で送信直前に翻訳する。
    const notification = toybacoNotificationJa(
      `Could not refresh your ${integration.providerIdentifier} channel ${err}`,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/launches`
    );
    await this._notificationService.inAppNotification(
      orgId,
      notification.subject,
      notification.message,
      toybacoSendEmail,
      false,
      'info'
    );
  }

  toybacoTokenLifecycleCandidates(providers: string[]) {
    return this._integrationRepository.toybacoTokenLifecycleCandidates(providers);
  }

  async refreshNeeded(org: string, id: string) {
    return this._integrationRepository.refreshNeeded(org, id);
  }

  async setBetweenRefreshSteps(integration: Integration) {
    return this._integrationRepository.setBetweenRefreshSteps(integration);
  }

  async refreshTokens() {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    for (const integration of integrations) {
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );

      const data = await this.refreshToken(provider, integration.refreshToken!);

      if (!data) {
        if (await this.markRefreshNeeded(integration)) {
          await this.informAboutRefreshError(
            integration.organizationId,
            integration
          );
        }
        return;
      }

      const { refreshToken, accessToken, expiresIn } = data;

      await this.saveRefreshedIntegration(
        integration,
        !!provider.oneTimeToken,
        accessToken,
        refreshToken,
        expiresIn,
        data
      );
    }
  }

  async saveRefreshedIntegration(
    integration: Integration,
    oneTimeToken: boolean,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    identity?: Pick<AuthTokenDetails, 'id' | 'toybacoInstagramAppScopedUserId'>
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration.providerIdentifier)
    ) {
      throw new HttpException('Integration not allowed', HttpStatus.FORBIDDEN);
    }
    const instagram = integration.providerIdentifier === 'instagram-standalone';
    if (instagram && identity?.id && String(identity.id) !== integration.internalId) {
      return false;
    }
    const snapshot = instagram ? refreshInstagramPermissionSnapshot(
      integration.toybacoInstagramPermissions,
      { appId: process.env.INSTAGRAM_APP_ID!, internalId: integration.internalId, token: integration.token },
      { appId: process.env.INSTAGRAM_APP_ID!, internalId: integration.internalId,
        appScopedUserId: identity?.toybacoInstagramAppScopedUserId || '', token }
    ) : null;
    return this._integrationRepository.saveRefreshedIntegration(
      integration,
      oneTimeToken,
      token,
      refreshToken,
      expiresIn,
      snapshot
    );
  }

  instagramCommentCapability(integration: Integration) {
    return integration.providerIdentifier === 'instagram-standalone'
      ? instagramCommentCapability(integration.toybacoInstagramPermissions, {
          appId: process.env.INSTAGRAM_APP_ID!, internalId: integration.internalId, token: integration.token,
        })
      : undefined;
  }

  async markRefreshNeeded(integration: Integration) {
    return this._integrationRepository.markRefreshNeeded(integration);
  }

  async disableChannel(org: string, id: string) {
    return this._integrationRepository.disableChannel(org, id);
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      !!process.env.STRIPE_PUBLISHABLE_KEY &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    return this._integrationRepository.enableChannel(org, id);
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    return this._integrationRepository.deleteChannelWithPosts(org, id);
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  private async removeUnusedConnectPicture(uploadedPicture: string) {
    try {
      const local = (process.env.STORAGE_PROVIDER || 'local') === 'local';
      const prefix = process.env.FRONTEND_URL + '/uploads';
      if (local && (!process.env.UPLOAD_DIRECTORY || !uploadedPicture.startsWith(prefix + '/'))) {
        throw new Error('Invalid uploaded picture');
      }
      // LocalStorage.removeFile takes a filesystem path; CloudflareStorage
      // takes the public URL returned by uploadSimple and extracts its key.
      const filePath = local
        ? process.env.UPLOAD_DIRECTORY + uploadedPicture.slice(prefix.length)
        : uploadedPicture;
      await this.storage.removeFile(filePath);
    } catch {
      console.warn('Connect page picture cleanup failed');
    }
  }

  async getConnectPageLocations(org: string, id: string) {
    const current = await this._integrationRepository.getIntegrationById(org, id);
    if (!current || current.deletedAt || current.providerIdentifier !== 'gmb' || !current.inBetweenSteps) {
      throw new HttpException('This connection changed. Start a new connection.', 409);
    }
    const provider = this._integrationManager.getSocialIntegration('gmb');
    if (!('toybacoLocations' in provider) || typeof provider.toybacoLocations !== 'function') {
      throw new HttpException('Location lookup is unavailable', 503);
    }
    return provider.toybacoLocations(current.token);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const readPendingSelection = async () => {
      const getIntegration = await this._integrationRepository.getIntegrationById(
        org,
        id
      );
      if (!getIntegration) {
        throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
      }
      // Match the exact provider selection against persisted state. Recovery
      // must not call the provider or perform a second database write.
      const choice = getIntegration.providerIdentifier === 'facebook' &&
        ['string', 'number'].includes(typeof data?.page) ? String(data.page) :
        getIntegration.providerIdentifier === 'gmb' &&
        typeof data?.accountName === 'string' && /^accounts\/[a-zA-Z0-9_-]+$/.test(data.accountName) &&
        typeof data?.locationName === 'string' && /^locations\/[a-zA-Z0-9_-]+$/.test(data.locationName) &&
        data.id === `${data.accountName}/${data.locationName}` ? data.id : undefined;
      if (getIntegration.deletedAt) {
        // A merge retires the original ticket's pending id. Resolve only its
        // transactionally stored outcome, never a guessed replacement channel.
        let outcome: { version?: number; sourceIntegrationId?: string;
          integrationId?: string; selection?: string } | undefined;
        try {
          outcome = JSON.parse(getIntegration.additionalSettings || 'null')?.toybacoConnectMerge;
        } catch { /* Missing/invalid receipts remain a conflict. */ }
        if (!getIntegration.inBetweenSteps && choice && outcome?.version === 1 &&
            outcome.sourceIntegrationId === id && outcome.selection === choice &&
            typeof outcome.integrationId === 'string' && outcome.integrationId !== id) {
          const survivor = await this._integrationRepository.getIntegrationById(org, outcome.integrationId);
          if (survivor && !survivor.deletedAt && !survivor.inBetweenSteps &&
              survivor.providerIdentifier === getIntegration.providerIdentifier && survivor.internalId === choice) {
            return null;
          }
        }
        throw new HttpException('This connection is no longer available. Start a new connection.', 409);
      }
      if (!getIntegration.inBetweenSteps) {
        if (choice && choice === getIntegration.internalId) return null;
        throw new HttpException({ code: 'TOYBACO_CONNECT_SELECTION_CONFLICT', message: 'This connection already selected a different page. Start a new connection.' }, 409);
      }

      return getIntegration;
    };

    const pending = await readPendingSelection();
    if (!pending) return { success: true };
    const provider = this._integrationManager.getSocialIntegration(
      pending.providerIdentifier
    );
    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    // Provider traversal and picture storage may outlast the short Redis lease.
    // Finish all external I/O before locking, then revalidate the pending row.
    const getIntegrationInformation = await provider.fetchPageInformation(pending.token, data);
    const providerPicture = getIntegrationInformation.picture;
    const storedPicture = [process.env.CLOUDFLARE_BUCKET_URL, process.env.FRONTEND_URL]
      .some(base => base && providerPicture?.startsWith(base.replace(/\/$/, '') + '/'));
    const uploadedPicture = providerPicture && !storedPicture
      ? await this.storage.uploadSimple(providerPicture)
      : undefined;
    const picture = uploadedPicture ?? providerPicture;
    let pictureCleanupSafe = true;
    try {
      const owner = await lockConnectSelection(id);
      try {
        const getIntegration = await readPendingSelection();
        if (!getIntegration) return { success: true };
        if (getIntegration.token !== pending.token || getIntegration.internalId !== pending.internalId ||
            getIntegration.providerIdentifier !== pending.providerIdentifier) {
          throw new HttpException({ code: 'TOYBACO_CONNECT_SELECTION_CONFLICT', message: 'This connection changed or already selected a page. Start a new connection.' }, 409);
        }
        await assertConnectSelectionLock(id, owner);
        // A rejected acknowledgement may still follow a committed transaction.
        // Retain the upload unless our transaction fence proves rollback.
        pictureCleanupSafe = false;
        try {
          return await this._integrationRepository.selectConnectPage(getIntegration, {
            picture,
            internalId: String(getIntegrationInformation.id),
            organizationId: org,
            name: getIntegrationInformation.name,
            inBetweenSteps: false,
            token: getIntegrationInformation.access_token,
            profile: getIntegrationInformation.username,
          });
        } catch (error) {
          const response = error instanceof HttpException ? error.getResponse() : null;
          pictureCleanupSafe = error instanceof HttpException && error.getStatus() === 409 &&
            typeof response === 'object' && response !== null && 'code' in response &&
            response.code === 'TOYBACO_CONNECT_SELECTION_CONFLICT';
          if (!pictureCleanupSafe) {
            console.warn('Connect page picture retained after uncertain save');
          }
          throw error;
        }
      } finally {
        await unlockConnectSelection(id, owner);
      }
    } finally {
      // Delete only uploads whose save was never attempted or certainly rolled
      // back. Successful and uncertain saves may reference them after unlock.
      if (uploadedPicture && pictureCleanupSafe) {
        await this.removeUnusedConnectPicture(uploadedPicture);
      }
    }
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    forceRefresh = false
  ): Promise<AnalyticsData[]> {
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // toybaco_token_lifecycle_v2: 期限の経過だけでは、更新の仕組みを持たない provider を更新しない。
    if (
      forceRefresh ||
      toybacoTokenExpiryRequiresRefresh(getIntegration, Date.now())
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration,
        '',
        { expiryOnly: !forceRefresh }
      );
      if (!data) {
        if (getIntegration.providerIdentifier === 'gmb') {
          // A false refresh can also be a superseded credential CAS, not an auth rejection.
          const current = await this.getIntegrationById(org.id, integration);
          throw new ToybacoGmbLookupError(current?.refreshNeeded ? 'reauthenticate' : 'unavailable');
        }
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        if (getIntegration.providerIdentifier === 'gmb') throw new ToybacoGmbLookupError('reauthenticate');
        return [];
      }
    }

    // Old GBP errors were stored as []; a new key also lets genuine empty results remain cached.
    const analyticsCacheKey = `${getIntegration.providerIdentifier === 'gmb' ? 'integration-gmb-v2' : 'integration'}:${org.id}:${integration}:${date}`;
    const getIntegrationData = await ioRedis.get(analyticsCacheKey);
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    if (integrationProvider.analytics) {
      try {
        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          +date
        );
        await ioRedis.set(
          analyticsCacheKey,
          JSON.stringify(loadAnalytics),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 1
            : 3600
        );
        return loadAnalytics;
      } catch (e) {
        if (e instanceof ToybacoGmbLookupError) throw e;
        if (e instanceof RefreshToken) {
          return this.checkAnalytics(org, integration, date, true);
        }
      }
    }

    return [];
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = this._integrationManager
      .getInternalPlugs(getIntegration.providerIdentifier)
      .internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlug(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    const exisingData = await this._integrationRepository.loadExisingData(
      methodName,
      integrationId,
      id
    );
    const loadOnlyIds = exisingData.map((p) => p.value);
    return difference(id, loadOnlyIds);
  }

  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
