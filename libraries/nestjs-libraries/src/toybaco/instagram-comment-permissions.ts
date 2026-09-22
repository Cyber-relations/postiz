import { createHash } from 'crypto';

export const REQUIRED_INSTAGRAM_SCOPES: readonly string[] = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];
export const INSTAGRAM_COMMENT_SCOPE = 'instagram_business_manage_comments';

type Identity = { appId: string; internalId: string; token: string };
type SnapshotInput = Identity & {
  appScopedUserId: string;
  permissions: string[];
  observedAt?: string;
};
type Snapshot = {
  version: 1;
  provider: 'instagram-standalone';
  appId: string;
  internalId: string;
  appScopedUserId: string;
  tokenFingerprint: string;
  permissions: string[];
  observedAt: string;
  source: 'oauth' | 'refresh_lineage';
  refreshedAt?: string;
};
export type InstagramCommentCapability = {
  state: 'granted' | 'absent' | 'unknown';
  source: 'oauth' | 'refresh_lineage' | 'unknown';
  observedAt?: string;
};

const unknownCapability = (): InstagramCommentCapability => ({
  state: 'unknown',
  source: 'unknown',
});
const invalidResponse = () => new Error('Instagram permission response is invalid');
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hasError = (value: Record<string, unknown>): boolean =>
  ['error', 'error_type', 'error_message', 'error_code', 'error_reason', 'error_description', 'code']
    .some((key) => key in value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]+$/.test(value);
const validToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;
const fingerprint = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

// The production API also emits numeric IDs. Recover their original JSON
// digits using the pinned Node 22 reviver context; String(number) can round
// account IDs and must never be used to establish identity.
export function parseInstagramResponseText(text: string) {
  try {
    return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }) => {
      if ((key === 'id' || key === 'user_id') && typeof value === 'number') {
        if (typeof context?.source !== 'string' || !/^[0-9]+$/.test(context.source)) {
          throw invalidResponse();
        }
        return context.source;
      }
      return value;
    });
  } catch {
    throw invalidResponse();
  }
}

// Never include provider values, identifiers, URLs, error text or credentials.
// This is diagnostic evidence only; it must not grant or normalize permissions.
export function instagramAuthDiagnostic(
  stage: string,
  response: unknown,
  status: unknown,
  expectedAppScopedId?: string
) {
  const knownStages = ['short_token_exchange', 'short_token_validation',
    'long_token_exchange', 'long_token_validation', 'identity_lookup',
    'identity_validation', 'permission_snapshot'];
  const kind = (value: unknown) => value === undefined ? 'missing' :
    value === null ? 'null' : Array.isArray(value) ? 'array' :
    typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' :
    typeof value === 'boolean' ? 'boolean' : 'object';
  const top = record(response) ? response : {};
  const envelope = 'data' in top ?
    (Array.isArray(top.data) && top.data.length === 1 && record(top.data[0]) ? 'single_data' : 'invalid_data') :
    (record(response) ? 'object' : 'invalid');
  const entry = envelope === 'single_data' ? (top.data as Record<string, unknown>[])[0] : top;
  const permissions = typeof entry.permissions === 'string' ? entry.permissions.split(',') :
    Array.isArray(entry.permissions) ? entry.permissions : [];
  const providerError = record(top.error) ? top.error : top;
  const code = providerError.code ?? providerError.error_code;
  return {
    event: 'toybaco_instagram_auth_failure',
    stage: knownStages.includes(stage) ? stage : 'unknown',
    httpStatus: Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599 ? Number(status) : null,
    envelope,
    providerError: hasError(top) || hasError(entry),
    providerErrorCode: Number.isSafeInteger(code) && Number(code) >= 0 && Number(code) <= 1000000 ? Number(code) : null,
    tokenPresent: validToken(entry.access_token),
    userIdType: kind(entry.user_id),
    idType: kind(entry.id),
    permissionsType: kind(entry.permissions),
    requiredScopesPresent: REQUIRED_INSTAGRAM_SCOPES.map(scope => permissions.includes(scope)),
    appScopedIdentityMatches: expectedAppScopedId === undefined ? null : entry.id === expectedAppScopedId,
  };
}
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

function scopes(value: unknown): string[] {
  // Meta documents comma-separated permissions; production also returns arrays.
  // Both representations undergo the same required-scope validation.
  const values = typeof value === 'string' ? value.split(',') : value;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some(
      (scope) => typeof scope !== 'string' || !/^[a-z][a-z0-9_]*$/.test(scope)
    )
  ) throw invalidResponse();
  const normalized = [...new Set(values as string[])].sort();
  if (REQUIRED_INSTAGRAM_SCOPES.some((scope) => !normalized.includes(scope))) {
    throw invalidResponse();
  }
  return normalized;
}

export function parseInstagramOAuthResponse(value: unknown): {
  accessToken: string;
  appScopedUserId: string;
  permissions: string[];
} {
  if (!record(value) || hasError(value)) {
    throw invalidResponse();
  }
  let entry = value;
  if ('data' in value) {
    // Documented response: { data: [{ access_token, user_id, permissions }] }.
    // Never choose between competing envelopes or multiple account entries.
    if (
      !Array.isArray(value.data) || value.data.length !== 1 ||
      ['access_token', 'user_id', 'permissions'].some((key) => key in value) ||
      !record(value.data[0])
    ) throw invalidResponse();
    entry = value.data[0];
  }
  // A top-level object is retained as explicit legacy provider compatibility;
  // it is not the documented canonical response envelope.
  if (
    hasError(entry) || 'data' in entry ||
    !validToken(entry.access_token) || !identifier(entry.user_id)
  ) throw invalidResponse();
  return {
    accessToken: entry.access_token,
    appScopedUserId: entry.user_id,
    permissions: scopes(entry.permissions),
  };
}

export function createInstagramPermissionSnapshot(input: SnapshotInput): string {
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (
    !identifier(input.appId) || !identifier(input.internalId) ||
    !identifier(input.appScopedUserId) || !validToken(input.token) ||
    !timestamp(observedAt)
  ) throw invalidResponse();
  const snapshot: Snapshot = {
    version: 1,
    provider: 'instagram-standalone',
    appId: input.appId,
    // internalId is /me.user_id (professional account ID). OAuth.user_id and
    // /me.id are app-scoped IDs; those belong in appScopedUserId, separately.
    internalId: input.internalId,
    appScopedUserId: input.appScopedUserId,
    tokenFingerprint: fingerprint(input.token),
    permissions: scopes(input.permissions),
    observedAt,
    source: 'oauth',
  };
  return JSON.stringify(snapshot);
}

function boundSnapshot(raw: unknown, identity: Identity): Snapshot | null {
  try {
    if (
      typeof raw !== 'string' || raw.length > 16384 ||
      !identifier(identity.appId) || !identifier(identity.internalId) ||
      !validToken(identity.token)
    ) return null;
    const value: unknown = JSON.parse(raw);
    if (!record(value)) return null;
    const allowedKeys = [
      'version', 'provider', 'appId', 'internalId', 'appScopedUserId',
      'tokenFingerprint', 'permissions', 'observedAt', 'source', 'refreshedAt',
    ];
    if (
      Object.keys(value).some((key) => !allowedKeys.includes(key)) ||
      value.version !== 1 || value.provider !== 'instagram-standalone' ||
      value.appId !== identity.appId || value.internalId !== identity.internalId ||
      !identifier(value.appScopedUserId) ||
      value.tokenFingerprint !== fingerprint(identity.token) ||
      !Array.isArray(value.permissions) || !timestamp(value.observedAt) ||
      (value.source !== 'oauth' && value.source !== 'refresh_lineage') ||
      (value.source === 'oauth' && 'refreshedAt' in value) ||
      (value.source === 'refresh_lineage' &&
        (!timestamp(value.refreshedAt) || value.refreshedAt < value.observedAt))
    ) return null;
    const permissions = scopes(value.permissions);
    if (JSON.stringify(value.permissions) !== JSON.stringify(permissions)) return null;
    return value as Snapshot;
  } catch {
    return null;
  }
}

// This JSON must come from the server-owned integration field, never client
// settings. SHA-256 binds it to a token revision; it is not a signature and
// cannot authenticate arbitrary client-supplied permission claims.
export function instagramCommentCapability(
  raw: unknown,
  identity: Identity
): InstagramCommentCapability {
  const snapshot = boundSnapshot(raw, identity);
  if (!snapshot) return unknownCapability();
  return {
    state: snapshot.permissions.includes(INSTAGRAM_COMMENT_SCOPE) ? 'granted' : 'absent',
    source: snapshot.source,
    observedAt: snapshot.observedAt,
  };
}

export function refreshInstagramPermissionSnapshot(
  raw: unknown,
  previous: Identity,
  next: Identity & { appScopedUserId: string; refreshedAt?: string }
): string | null {
  const snapshot = boundSnapshot(raw, previous);
  const refreshedAt = next.refreshedAt ?? new Date().toISOString();
  if (
    !snapshot || next.appId !== snapshot.appId ||
    next.internalId !== snapshot.internalId ||
    next.appScopedUserId !== snapshot.appScopedUserId ||
    !validToken(next.token) || !timestamp(refreshedAt) ||
    refreshedAt < (snapshot.refreshedAt ?? snapshot.observedAt)
  ) return null;
  // Refresh proves token continuity, not a fresh remote grant inspection.
  return JSON.stringify({
    ...snapshot,
    tokenFingerprint: fingerprint(next.token),
    source: 'refresh_lineage',
    refreshedAt,
  });
}
