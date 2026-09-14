import { instagramCommentCapability, INSTAGRAM_COMMENT_SCOPE } from './instagram-comment-permissions';

export const INSTAGRAM_COMMENT_PERMISSION_CODE = 'TOYBACO_INSTAGRAM_COMMENT_PERMISSION_REQUIRED';
export const INSTAGRAM_COMMENT_PERMISSION_MESSAGE = 'このInstagram接続にはコメント権限がありません。投稿文への追記に移すかコメントを除いて公開してください。コメントを含む下書きは保存できます。';
export const INSTAGRAM_COMMENT_PROVIDER_DENIED_CODE = 'TOYBACO_INSTAGRAM_COMMENT_PERMISSION_DENIED';
export const INSTAGRAM_COMMENT_PROVIDER_DENIED_MESSAGE = 'Instagramがコメント権限を確認できず、コメントを受け付けませんでした。Instagramの権限と公開済み投稿を確認してください。';

type Connection = {
  providerIdentifier: string;
  internalId: string;
  token: string;
  toybacoInstagramPermissions?: string | null;
};

export function instagramCommentPublicationError(
  integration: Connection, count: number, appId = process.env.INSTAGRAM_APP_ID || ''
): string | null {
  if (integration.providerIdentifier !== 'instagram-standalone' || count < 2) return null;
  // Legacy/unconfirmed evidence preserves the existing provider-enforced path.
  return instagramCommentCapability(integration.toybacoInstagramPermissions, {
    appId, internalId: integration.internalId, token: integration.token,
  }).state === 'absent' ? INSTAGRAM_COMMENT_PERMISSION_CODE : null;
}

export function instagramCommentProviderDenied(body: string, status?: number): boolean {
  if (status !== undefined && status !== 400 && status !== 403) return false;
  try {
    const error = JSON.parse(body)?.error;
    return (error?.code === 10 || error?.code === 200) &&
      typeof error?.message === 'string' && error.message.includes(INSTAGRAM_COMMENT_SCOPE);
  } catch { return false; }
}

// Integration models are also returned by mutation endpoints. Strip this one
// server-owned field at JSON serialization, including nested model results.
export function instagramPermissionJsonReplacer(key: string, value: unknown): unknown {
  return key === 'toybacoInstagramPermissions' ? undefined : value;
}
