// Only finite codes cross the popup boundary; provider messages and metadata stay server-side.
export type ConnectionReason = 'access-not-ready' | 'rate-limited' | 'reauthenticate' | 'permission-denied' | 'unavailable' | 'interrupted' | 'popup-blocked';
export type ChannelConnectionResult = { outcome: 'connected' | 'setup-pending' | 'review' | 'precondition' | 'failed'; reason?: ConnectionReason; channel?: { identifier: string; internalId: string } };
const reasons: ConnectionReason[] = ['access-not-ready', 'rate-limited', 'reauthenticate', 'permission-denied', 'unavailable', 'interrupted', 'popup-blocked'];
export function connectionReason(value: unknown): ConnectionReason {
  return typeof value === 'string' && reasons.includes(value as ConnectionReason) ? value as ConnectionReason : 'unavailable';
}
export function readConnectionResult(value: unknown): ChannelConnectionResult | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.type !== 'toybaco-connect' || (typeof data.outcome !== 'string' || !['connected', 'setup-pending', 'review', 'precondition', 'failed'].includes(data.outcome))) return null;
  return { outcome: data.outcome as ChannelConnectionResult['outcome'], ...(data.outcome === 'failed' ? { reason: connectionReason(data.reason) } : {}) };
}
export function connectionMessage(result: ChannelConnectionResult): string {
  if (result.outcome === 'connected') return 'チャンネルを接続しました。';
  if (result.outcome === 'setup-pending') return 'Google アカウントとの連携を保存しました。チャンネルの「店舗を選ぶ」から設定を続けられます。';
  if (result.outcome === 'review') return 'チャンネルの接続を完了できませんでした。接続先の条件を確認して、もう一度お試しください。';
  if (result.outcome === 'precondition') return 'チャンネルを接続するための条件を満たしていません。利用条件を確認してください。';
  const messages: Record<ConnectionReason, string> = {
    'access-not-ready': 'Google側の接続準備が完了していません。トイバコのサポートにお問い合わせください。',
    'rate-limited': 'Google ビジネスプロフィールの取得回数の上限に達しました。時間をおいて、もう一度お試しください。',
    'reauthenticate': 'Googleの認証を確認できませんでした。チャンネルを再接続してください。',
    'permission-denied': 'このGoogleアカウントでは店舗情報を取得できません。店舗の管理権限を確認してください。',
    'unavailable': '接続を完了できませんでした。もう一度お試しください。',
    'interrupted': '接続の完了を確認できないまま画面が閉じられました。もう一度お試しください。',
    'popup-blocked': '再接続用の画面を開けませんでした。ブラウザのポップアップを許可して、もう一度お試しください。',
  };
  return messages[connectionReason(result.reason)];
}
export function lookupFailure(body: unknown): ConnectionReason {
  const data = body as { error?: unknown; reason?: unknown } | null;
  return data?.error === 'TOYBACO_GBP_LOOKUP_FAILED' ? connectionReason(data.reason) : 'unavailable';
}
