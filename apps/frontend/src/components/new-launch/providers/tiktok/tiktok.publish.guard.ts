export const TIKTOK_DISCLOSURE_REASON = '宣伝する対象として、自分のブランド、第三者のブランド、または両方を選択してください。';
export const TIKTOK_BRANDED_PRIVATE_REASON = '第三者のブランドを宣伝する投稿は「自分のみ」にできません。公開範囲を確認してください。';
export const TIKTOK_CONTEXT_CHANGED_REASON = 'TikTok の投稿画面が変更されました。投稿先と内容を確認して、この画面から操作し直してください。';
export const TIKTOK_PENDING_REASON = 'TikTok の投稿設定を確認しています。';

export type TikTokPublishGuards = Record<string, { lease: symbol; reason: string }>;

export function toybacoTikTokDisclosureReason(settings: {
  upload: boolean; privacy: string; disclose: boolean; organic: boolean; branded: boolean;
}): string {
  if (settings.upload) return '';
  if (settings.disclose && !settings.organic && !settings.branded) return TIKTOK_DISCLOSURE_REASON;
  if (settings.branded && settings.privacy === 'SELF_ONLY') return TIKTOK_BRANDED_PRIVATE_REASON;
  return '';
}

export function toybacoUpdateTikTokGuard(
  guards: TikTokPublishGuards, id: string, lease: symbol, reason: string | null
): TikTokPublishGuards {
  const existing = Object.prototype.hasOwnProperty.call(guards, id) ? guards[id] : undefined;
  if (reason === null) {
    if (existing?.lease !== lease) return guards;
    const next = { ...guards };
    delete next[id];
    return next;
  }
  if (existing?.lease === lease && existing.reason === reason) return guards;
  return { ...guards, [id]: { lease, reason } };
}

export function toybacoTikTokPublishReason(
  selected: { integration: { id: string; identifier: string } }[], guards: TikTokPublishGuards,
  expected?: TikTokPublishGuards
): string {
  for (const { integration } of selected) {
    if (integration.identifier !== 'tiktok') continue;
    const entry = Object.prototype.hasOwnProperty.call(guards, integration.id) ? guards[integration.id] : undefined;
    if (!entry) return TIKTOK_PENDING_REASON;
    if (entry.reason) return entry.reason;
    if (expected && expected[integration.id]?.lease !== entry.lease) return TIKTOK_CONTEXT_CHANGED_REASON;
  }
  return '';
}
