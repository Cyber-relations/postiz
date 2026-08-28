// トイバコ: 上流の英語通知を日本語にする。
// ワークフロー側の文字列は Temporal の再生互換のため変更できないので、
// 実際に送る直前(activity 側)でここを通して置き換える。
function safePlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 300);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const allowedHosts = new Set([
      'post.toybaco.jp',
      'app.toybaco.jp',
      'instagram.com',
      'www.instagram.com',
      'threads.net',
      'www.threads.net',
    ]);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      return undefined;
    }
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function safeToybacoUrl(
  value: string,
  path: '/' | '/launches'
): string | undefined {
  const normalized = safeHttpUrl(value);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.origin !== 'https://post.toybaco.jp' || url.pathname !== path) {
    return undefined;
  }
  if (path === '/launches' && (url.search || url.hash)) return undefined;
  if (path === '/') {
    const org = url.searchParams.get('org');
    if (
      !org ||
      !/^[A-Za-z0-9._~-]{1,2048}$/.test(org) ||
      [...url.searchParams.keys()].some((key) => key !== 'org') ||
      url.hash
    ) {
      return undefined;
    }
  }
  return normalized;
}

function safePublishedPostUrl(
  value: string,
  provider: string
): string | undefined {
  const normalized = safeHttpUrl(value);
  if (!normalized) return undefined;
  const url = new URL(normalized);
  if (url.search || url.hash) return undefined;
  const hostname = url.hostname.toLowerCase();
  const key = provider.toLowerCase();
  if (
    (key === 'instagram' || key === 'instagram-standalone') &&
    (hostname === 'instagram.com' || hostname === 'www.instagram.com')
  ) {
    return normalized;
  }
  if (
    key === 'threads' &&
    (hostname === 'threads.net' || hostname === 'www.threads.net')
  ) {
    return normalized;
  }
  return undefined;
}

function safeLink(value: string, label: string): string {
  const url = safeHttpUrl(value);
  return url ? `<a href="${url}">${label}</a>` : label;
}

function sanitizeNotificationHtml(value: string): string {
  const allowedTag = /<br\s*\/?>|<a\s+href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  const escapeText = (text: string) =>
    escapeHtml(text.replace(/<[^>]*>/g, ''));

  while ((match = allowedTag.exec(value)) !== null) {
    output += escapeText(value.slice(cursor, match.index));
    if (/^<br/i.test(match[0])) {
      output += '<br />';
    } else {
      const url = safeHttpUrl(match[2]);
      const label = escapeHtml(match[3].replace(/<[^>]*>/g, ''));
      output += url
        ? `<a href="${escapeHtml(url)}">${label}</a>`
        : label;
    }
    cursor = match.index + match[0].length;
  }
  output += escapeText(value.slice(cursor));
  return output;
}

function genericJapaneseMessage(value: string): string {
  // 未知テンプレートのURLは、フィッシング先やtoken/PIIを含む可能性がある。
  // 文面だけで用途を判定せず、リンクを一切保持しない。
  return 'トイバコからのお知らせがあります。詳細はトイバコの画面でご確認ください。';
}

const knownProviderJa =
  '(?:Google ビジネスプロフィール|Instagram|Facebook|Threads|X|TikTok|YouTube|LinkedIn|Mastodon|Bluesky|Discord|Slack|Telegram|Pinterest|Reddit|Dribbble|Warpcast|Nostr|Vk|Lemmy|連携先)';

// activity -> email activity のように変換済み通知がもう一度ここを通る。
// 「日本語を含む」だけでは外部エラーとの混在文も通すため、この変換器が作る
// 既知テンプレートだけを明示的に再通過させる。
function isKnownJapaneseSubject(value: string): boolean {
  const patterns = [
    /^トイバコ: 新しいお知らせ$/,
    /^トイバコのログイン用メールアドレスが変更されました$/,
    new RegExp(`^.{1,120}への投稿ができませんでした\\(${knownProviderJa}\\)$`),
    new RegExp(`^${knownProviderJa}への投稿の公開を確認できませんでした$`),
    new RegExp(`^.{1,120}へのコメント投稿でエラーが発生しました\\(${knownProviderJa}\\)$`),
    new RegExp(`^.{1,120}への投稿でエラーが発生しました\\(${knownProviderJa}\\)$`),
    new RegExp(`^${knownProviderJa}に投稿を公開しました$`),
    new RegExp(`^${knownProviderJa}の接続を更新できませんでした$`),
    /^.{1,80}さんが「.{1,80}」に招待しています$/,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function isKnownJapaneseMessage(value: string): boolean {
  const patterns = [
    /^トイバコからのお知らせがあります。詳細はトイバコの画面でご確認ください。$/,
    new RegExp(`^.{1,120}\\(${knownProviderJa}\\)への投稿ができませんでした。接続の有効期限が切れています。お手数ですが接続し直してください。$`),
    new RegExp(`^.{1,120}\\(${knownProviderJa}\\)への投稿ができませんでした。この連携先が無効になっています。有効にしてから、もう一度お試しください。$`),
    new RegExp(`^${knownProviderJa}へ送信しましたが、公開されたかどうかを確認できませんでした。お手数ですが${knownProviderJa}の画面でご確認ください。$`),
    new RegExp(`^${knownProviderJa}へのコメント投稿でエラーが発生しました。時間をおいて再度お試しください。$`),
    new RegExp(`^${knownProviderJa}への投稿でエラーが発生しました。時間をおいて再度お試しください。$`),
    /^管理者がトイバコのログイン用メールアドレスを変更しました。現在は[^<>\s]{1,254}でログインできます。契約とプランは変更されていません。解約する場合は、設定画面で別途お手続きください。$/,
  ];
  if (patterns.some((pattern) => pattern.test(value))) return true;

  let match = value.match(
    new RegExp(`^(${knownProviderJa})に投稿を公開しました。<br \\/><a href="([^"]+)">投稿を見る<\\/a>$`)
  );
  if (match && safePublishedPostUrl(match[2], match[1])) return true;
  match = value.match(
    new RegExp(`^${knownProviderJa}の接続が切れました。お手数ですが接続し直してください。<br \\/><a href="([^"]+)">接続画面を開く<\\/a>$`)
  );
  if (match && safeToybacoUrl(match[1], '/launches')) return true;
  match = value.match(
    /^.{1,120}さんが「.{1,120}」チームに招待しています。<br \/><a href="([^"]+)">招待を承諾する<\/a>と参加できます。<br \/>このリンクの有効期限は2日間です。$/
  );
  return Boolean(match && safeToybacoUrl(match[1], '/'));
}

export function toybacoProviderName(id: string): string {
  const key = id.toLowerCase();
  switch (key) {
    case 'gmb':
      return 'Google ビジネスプロフィール';
    case 'instagram':
    case 'instagram-standalone':
      return 'Instagram';
    case 'facebook':
      return 'Facebook';
    case 'threads':
      return 'Threads';
    case 'x':
      return 'X';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    case 'linkedin':
    case 'linkedin-page':
      return 'LinkedIn';
    case 'mastodon':
      return 'Mastodon';
    case 'bluesky':
      return 'Bluesky';
    case 'discord':
    case 'slack':
    case 'telegram':
    case 'pinterest':
    case 'reddit':
    case 'dribbble':
    case 'warpcast':
    case 'nostr':
    case 'vk':
    case 'lemmy':
      return key.charAt(0).toUpperCase() + key.slice(1);
    default:
      // 未知の識別子は外部エラーやHTMLを含み得るため顧客へ露出しない。
      return '連携先';
  }
}

export function toybacoNotificationJa(
  subject: string,
  message: string
): { subject: string; message: string } {
  let jaSubject = subject;
  let jaMessage = message;
  let match: RegExpMatchArray | null;
  let subjectMatched = false;
  let messageMatched = false;

  match = subject.match(/^We couldn't post to (.+?) for (.+)$/);
  if (match) {
    subjectMatched = true;
    jaSubject = `${match[2]}への投稿ができませんでした(${toybacoProviderName(match[1])})`;
  } else if ((match = subject.match(/^We couldn't confirm your post on (.+)$/))) {
    subjectMatched = true;
    jaSubject = `${toybacoProviderName(match[1])}への投稿の公開を確認できませんでした`;
  } else if ((match = subject.match(/^Error posting comments on (.+?) for (.+)$/))) {
    subjectMatched = true;
    jaSubject = `${match[2]}へのコメント投稿でエラーが発生しました(${toybacoProviderName(match[1])})`;
  } else if ((match = subject.match(/^Error posting on (.+?) for (.+)$/))) {
    subjectMatched = true;
    jaSubject = `${match[2]}への投稿でエラーが発生しました(${toybacoProviderName(match[1])})`;
  } else if ((match = subject.match(/^Your post has been published on (.+)$/))) {
    subjectMatched = true;
    jaSubject = `${toybacoProviderName(match[1])}に投稿を公開しました`;
  } else if ((match = subject.match(/^Could not refresh your (.+?) channel(?: .*)?$/))) {
    subjectMatched = true;
    jaSubject = `${toybacoProviderName(match[1])}の接続を更新できませんでした`;
  } else if (subject === '[Postiz] Your latest notifications') {
    subjectMatched = true;
    jaSubject = 'トイバコ: 新しいお知らせ';
  } else if ((match = subject.match(/^(.+?) invited you to join "(.+)"$/))) {
    subjectMatched = true;
    jaSubject = `${match[1]}さんが「${match[2]}」に招待しています`;
  } else if (subject === 'Your Postiz login was changed') {
    subjectMatched = true;
    jaSubject = 'トイバコのログイン用メールアドレスが変更されました';
  }

  // reconnect は後半の英文が上流で増減しても、原因が同じなら安全に定型化する。
  match = message.match(
    /^We couldn't post to (.+?) for (.+?) because you need to reconnect it\.(?:[\s\S]*)$/
  );
  if (match) {
    messageMatched = true;
    jaMessage = `${match[2]}(${toybacoProviderName(match[1])})への投稿ができませんでした。接続の有効期限が切れています。お手数ですが接続し直してください。`;
  } else if (
    (match = message.match(
      /^We couldn't post to (.+?) for (.+?) because it's disabled\. Please enable it and try again\.?$/
    ))
  ) {
    messageMatched = true;
    jaMessage = `${match[2]}(${toybacoProviderName(match[1])})への投稿ができませんでした。この連携先が無効になっています。有効にしてから、もう一度お試しください。`;
  } else if (
    (match = message.match(
      /^Your post was sent to (.+?), but we couldn't confirm it was published\. Please check your [\s\S]+$/
    ))
  ) {
    messageMatched = true;
    const provider = toybacoProviderName(match[1]);
    jaMessage = `${provider}へ送信しましたが、公開されたかどうかを確認できませんでした。お手数ですが${provider}の画面でご確認ください。`;
  } else if (
    (match = message.match(
      /^An error occurred while posting comments on (.+?)(?:: ([\s\S]*))?$/
    ))
  ) {
    messageMatched = true;
    jaMessage = `${toybacoProviderName(match[1])}へのコメント投稿でエラーが発生しました。時間をおいて再度お試しください。`;
  } else if (
    (match = message.match(
      /^An error occurred while posting on (.+?)(?:: ([\s\S]*))?$/
    ))
  ) {
    messageMatched = true;
    jaMessage = `${toybacoProviderName(match[1])}への投稿でエラーが発生しました。時間をおいて再度お試しください。`;
  } else if (
    (match = message.match(
      /^Your post has been published on (.+?) at (https?:\/\/\S+)$/
    ))
  ) {
    messageMatched = true;
    const provider = toybacoProviderName(match[1]);
    const url = safePublishedPostUrl(match[2], match[1]);
    jaMessage = `${provider}に投稿を公開しました。${url ? `<br />${safeLink(url, '投稿を見る')}` : ''}`;
  } else if (
    (match = message.match(
      /^Could not refresh your (.+?) channel[\s\S]*?\. Please go back to the system and connect it again (https?:\/\/\S+)$/
    ))
  ) {
    messageMatched = true;
    const url = safeToybacoUrl(match[2], '/launches');
    jaMessage = `${toybacoProviderName(match[1])}の接続が切れました。お手数ですが接続し直してください。${url ? `<br />${safeLink(url, '接続画面を開く')}` : ''}`;
  } else if (
    (match = message.match(
      /^(.+?) has invited you to join the "(.+?)" team\.<br \/><a href="([^"]+)">Accept the invitation<\/a> to get started\.<br \/>The link will expire in 2 days\.$/
    ))
  ) {
    messageMatched = true;
    const url = safeToybacoUrl(match[3], '/');
    jaMessage = `${match[1]}さんが「${match[2]}」チームに招待しています。${url ? `<br />${safeLink(url, '招待を承諾する')}と参加できます。` : ''}<br />このリンクの有効期限は2日間です。`;
  } else if (
    (match = message.match(
      /^An administrator changed the login for your Postiz account\. You can now sign in using (.+?)\. Your subscription and plan were not changed by this switch [—-] if you intended to cancel a subscription, please do that separately from your billing settings\.$/
    ))
  ) {
    messageMatched = true;
    jaMessage = `管理者がトイバコのログイン用メールアドレスを変更しました。現在は${match[1]}でログインできます。契約とプランは変更されていません。解約する場合は、設定画面で別途お手続きください。`;
  }

  // 既知の変換済みテンプレートだけを冪等に保持する。未知文・日本語との混在文は
  // 内部エラー、secret、PIIを含み得るため安全な定型文へ閉じる。
  if (!subjectMatched) {
    jaSubject = isKnownJapaneseSubject(subject)
      ? subject
      : 'トイバコからのお知らせ';
  }
  if (!messageMatched) {
    jaMessage = isKnownJapaneseMessage(message)
      ? message
      : genericJapaneseMessage(message);
  }

  return {
    subject: safePlainText(jaSubject) || 'トイバコからのお知らせ',
    message: sanitizeNotificationHtml(jaMessage),
  };
}
