// toybaco_token_lifecycle_v2: 接続 token の期限管理(PZ-1/2/3/7/8)。
// workflow の bundle からも読むため、外部 import と時計の直接参照を持たない純関数だけを置く。
// 値を変えると走行中の V2 workflow の再生結果が変わるため、変更時は V3 を別名で足す。

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const TOYBACO_MISSING_POST_WORKFLOW_V2 = 'toybacoMissingPostWorkflowV2';
export const TOYBACO_MISSING_POST_WORKFLOW_V2_ID = 'toybaco-missing-post-workflow-v2';
export const TOYBACO_LEGACY_MISSING_POST_WORKFLOW = 'missingPostWorkflow';
export const TOYBACO_LEGACY_MISSING_POST_WORKFLOW_ID = 'missing-post-workflow';
export const TOYBACO_REFRESH_TOKEN_WORKFLOW_V2 = 'toybacoRefreshTokenWorkflowV2';
export const TOYBACO_LEGACY_REFRESH_TOKEN_WORKFLOW = 'refreshTokenWorkflow';
export const TOYBACO_LEGACY_TERMINATE_REASON = 'toybaco_token_lifecycle_v2: replaced by V2';

// 1 run の掃除回数。1 回あたり約 15 event なので、1 run は 400 event 前後で閉じる。
export const TOYBACO_MISSING_POST_SWEEPS_PER_RUN = 24;
export const TOYBACO_MISSING_POST_SWEEP_INTERVAL_MS = HOUR_MS;
// refresh V2 は成功ごとに continueAsNew する。失敗の再試行が続いても履歴が伸び続けないよう、
// 1 run の手順数にも上限を置く。
export const TOYBACO_REFRESH_STEPS_PER_RUN = 60;

export function toybacoRefreshWorkflowId(integrationId: string) {
  // 上流の接続時 start と同じ ID。TERMINATE_EXISTING で旧版の run を置き換える。
  return `refresh_${integrationId}`;
}

// refreshToken() が空 token を返す(更新の仕組みを持たない)provider。
// Facebook のページ token と X の OAuth 1.0a token は期限で失効しない。
const STATIC_TOKEN_PROVIDERS = ['facebook', 'x'];

export function toybacoStaticTokenProvider(providerIdentifier: string | null | undefined) {
  return STATIC_TOKEN_PROVIDERS.includes(String(providerIdentifier || ''));
}

export function toybacoTimeMs(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

// tokenExpiration の経過だけを理由に refresh するかどうか。認証エラーでの refresh は対象外。
export function toybacoTokenExpiryRequiresRefresh(
  integration:
    | { providerIdentifier?: string | null; tokenExpiration?: Date | string | null }
    | null
    | undefined,
  nowMs: number
) {
  if (!integration || toybacoStaticTokenProvider(integration.providerIdentifier)) {
    return false;
  }
  const expiresAt = toybacoTimeMs(integration.tokenExpiration);
  return expiresAt !== null && expiresAt < nowMs;
}

export type ToybacoTokenLifecyclePolicy =
  | {
      kind: 'meta';
      // Postiz が接続・更新時に保存する残り期間(Meta の実期限 60 日より短い)。
      storedLifetimeMs: number;
      // 長期 token の実際の寿命(final が一時的な障害でも再接続へ渡してよい境)。
      actualLifetimeMs: number;
      refreshEveryMs: number;
      minTokenAgeMs: number;
      finalRemainingMs: number;
    }
  | {
      kind: 'google';
      accessLifetimeMs: number;
      refreshEveryMs: number;
      finalIdleMs: number;
      // refresh token が実際に失効する未使用の期間(final が一時的な障害でも再接続へ渡してよい境)。
      expiredIdleMs: number;
    };

const META_POLICY: ToybacoTokenLifecyclePolicy = {
  kind: 'meta',
  storedLifetimeMs: 58 * DAY_MS,
  // Instagram(standalone)と Threads の provider は接続・更新のたびに 58 日で期限を保存するが、
  // Meta の長期 token の寿命は 60 日。保存した期限の 2 日後が実際の失効になる。
  actualLifetimeMs: 60 * DAY_MS,
  refreshEveryMs: 7 * DAY_MS,
  minTokenAgeMs: DAY_MS,
  finalRemainingMs: 7 * DAY_MS,
};

const POLICIES: Record<string, ToybacoTokenLifecyclePolicy> = {
  'instagram-standalone': META_POLICY,
  threads: META_POLICY,
  // Google の refresh token は 6 か月使わないと失効する。月 1 回使い、5 か月使えなければ再接続へ。
  gmb: {
    kind: 'google',
    accessLifetimeMs: HOUR_MS,
    refreshEveryMs: 30 * DAY_MS,
    finalIdleMs: 150 * DAY_MS,
    // 6 か月は暦で最長 184 日。
    expiredIdleMs: 184 * DAY_MS,
  },
  // TikTok は対象にしない(2026-10-29 の D の裁定)。上流のまま(期限で更新が失敗すれば refreshNeeded と
  // 再接続の通知)にし、更新 token の期限は DB に持つ設計で別に扱う。
};

export const TOYBACO_TOKEN_LIFECYCLE_PROVIDERS = Object.keys(POLICIES);

export function toybacoTokenLifecyclePolicy(providerIdentifier: string | null | undefined) {
  return POLICIES[String(providerIdentifier || '')];
}

// 一時的な失敗の再試行間隔。4 回目以降は 1 日ごと。
const RETRY_DELAYS_MS = [HOUR_MS, 6 * HOUR_MS, DAY_MS];

export function toybacoRetryDelayMs(failures: number) {
  const index = Math.max(1, Math.floor(failures)) - 1;
  return RETRY_DELAYS_MS[Math.min(index, RETRY_DELAYS_MS.length - 1)];
}

// activity が workflow へ返す値。token や refresh token は含めない。
export type ToybacoTokenLifecycleStatus = {
  active: boolean;
  reason: string;
  providerIdentifier: string;
  tokenExpirationMs: number | null;
};

export type ToybacoTokenRefreshResult = {
  status: 'refreshed' | 'failed' | 'stale' | 'inactive' | 'refresh-needed';
};

// 接続の世代: DB にもとからある秘密でない印(access token の期限 tokenExpiration)。V2 は、各段の始めに読んだ
// 世代を activity に渡す。activity は今の接続の世代と照らし、違えば資格情報に触らず stale を返す(再接続の後に
// 残った旧い V2 が、新しい接続を更新・切断しないため)。毎段読み直すので、別の経路の更新とずれるのは、その段の
// 読みと activity の間だけで、V2 は次の段で読み直して計画し直す。Meta と Google の final は、その段で読んだ
// tokenExpiration だけで判定し、前の段で覚えた値を世代と組にしない。
export type ToybacoTokenGeneration = {
  generationMs?: number | null;
};

export function toybacoGenerationMismatch(
  expected: ToybacoTokenGeneration | null | undefined,
  currentGenerationMs: number | null
) {
  return (
    !!expected &&
    expected.generationMs !== undefined &&
    (expected.generationMs ?? null) !== currentGenerationMs
  );
}

export function toybacoTokenLifecycleStatusOf(
  integration:
    | {
        providerIdentifier?: string | null;
        type?: string | null;
        deletedAt?: Date | string | null;
        inBetweenSteps?: boolean | null;
        refreshNeeded?: boolean | null;
        tokenExpiration?: Date | string | null;
      }
    | null
    | undefined
): ToybacoTokenLifecycleStatus {
  const providerIdentifier = String(integration?.providerIdentifier || '');
  const tokenExpirationMs = toybacoTimeMs(integration?.tokenExpiration);
  const reason = !integration
    ? 'missing'
    : integration.deletedAt
    ? 'deleted'
    : integration.type && integration.type !== 'social'
    ? 'not-social'
    : !toybacoTokenLifecyclePolicy(providerIdentifier)
    ? 'unsupported-provider'
    : integration.inBetweenSteps
    ? 'in-between-steps'
    : integration.refreshNeeded
    ? 'refresh-needed'
    : 'active';
  return { active: reason === 'active', reason, providerIdentifier, tokenExpirationMs };
}

export type ToybacoTokenLifecycleState = {
  nowMs: number;
  tokenExpirationMs: number | null;
  failures: number;
};

export type ToybacoTokenLifecyclePlan =
  | { type: 'wait'; untilMs: number }
  | { type: 'refresh' }
  | { type: 'final' };

// 次の一手を決める。refresh は状態を変えない更新、final は最後の段の更新。final の失敗を
// refreshNeeded と再接続の通知へ渡すかは toybacoFinalMayDisconnect が決める。
export function toybacoPlanTokenLifecycle(
  policy: ToybacoTokenLifecyclePolicy,
  state: ToybacoTokenLifecycleState
): ToybacoTokenLifecyclePlan {
  const { nowMs, tokenExpirationMs, failures } = state;
  if (policy.kind === 'meta') {
    if (tokenExpirationMs === null) {
      return { type: 'wait', untilMs: nowMs + policy.refreshEveryMs };
    }
    if (failures > 0 && tokenExpirationMs - nowMs <= policy.finalRemainingMs) {
      return { type: 'final' };
    }
    const issuedAt = tokenExpirationMs - policy.storedLifetimeMs;
    const dueAt = issuedAt + Math.max(policy.refreshEveryMs, policy.minTokenAgeMs);
    return nowMs < dueAt ? { type: 'wait', untilMs: dueAt } : { type: 'refresh' };
  }
  if (tokenExpirationMs === null) {
    return { type: 'wait', untilMs: nowMs + policy.refreshEveryMs };
  }
  const lastRefreshAt = tokenExpirationMs - policy.accessLifetimeMs;
  if (failures > 0 && nowMs - lastRefreshAt >= policy.finalIdleMs) {
    return { type: 'final' };
  }
  const dueAt = lastRefreshAt + policy.refreshEveryMs;
  return nowMs < dueAt ? { type: 'wait', untilMs: dueAt } : { type: 'refresh' };
}

// final の失敗を、上流の破壊的な経路(refreshNeeded と再接続の通知)へ渡してよいか。渡すのは、
// provider が資格情報の失効を確かめた時か、実際に期限を過ぎた時だけ。期限の前の通信の失敗・
// 429・5xx は、V2 の状態を保ったまま間を置いて再試行する。
export function toybacoFinalMayDisconnect(
  policy: ToybacoTokenLifecyclePolicy,
  state: { nowMs: number; tokenExpirationMs: number | null; rejected: boolean }
) {
  if (state.rejected) {
    return true;
  }
  const { nowMs, tokenExpirationMs } = state;
  if (policy.kind === 'meta') {
    return (
      tokenExpirationMs !== null &&
      tokenExpirationMs - policy.storedLifetimeMs + policy.actualLifetimeMs <= nowMs
    );
  }
  return (
    tokenExpirationMs !== null &&
    nowMs - (tokenExpirationMs - policy.accessLifetimeMs) >= policy.expiredIdleMs
  );
}

// 更新の失敗のうち、provider が資格情報の失効を確かめたもの。provider ごとの判定はここに置く。
// 通信の失敗・429・5xx と、区別できない失敗は false にする。
export function toybacoRefreshRejected(
  providerIdentifier: string | null | undefined,
  err: unknown
) {
  const error = err as
    | { details?: unknown; response?: { data?: { error?: unknown } } }
    | null
    | undefined;
  const kind = toybacoTokenLifecyclePolicy(providerIdentifier)?.kind;
  if (kind === 'meta') {
    // SocialAbstract.fetch の RefreshToken / BadBody は Graph の応答本文を details[].json に持つ。
    // 190 は access token の失効(OAuthException)。Instagram(standalone)の refreshToken は
    // 応答本文を捨てた Error を投げるので区別できず、期限まで再試行する。
    const details = error?.details;
    return (Array.isArray(details) ? details : []).some((detail) =>
      /"code"\s*:\s*190(?!\d)/.test(String((detail as { json?: unknown } | null)?.json ?? ''))
    );
  }
  if (kind === 'google') {
    // google-auth-library(gaxios)の error は token endpoint の応答本文を response.data に持つ。
    return error?.response?.data?.error === 'invalid_grant';
  }
  return false;
}

// toybaco_token_lifecycle_v2 が足した利用者へのメール(final の再接続の通知)は、owner の明示の
// 了承まで送らない。秘密でない env TOYBACO_CHANNEL_NOTICE_EMAILS が
// 'on' の時だけ送る(受信箱側と同じ名前・同じ意味)。画面の中の通知は env に関わらず作る。
export const TOYBACO_CHANNEL_NOTICE_EMAILS_ENV = 'TOYBACO_CHANNEL_NOTICE_EMAILS';

export function toybacoChannelNoticeEmailsEnabled(env: Record<string, string | undefined>) {
  return env[TOYBACO_CHANNEL_NOTICE_EMAILS_ENV] === 'on';
}
