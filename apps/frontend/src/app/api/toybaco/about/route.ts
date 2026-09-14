import { toybacoAppOrigin } from '@gitroom/frontend/helpers/toybaco.app.origin';

export function GET() {
  // The existing helper accepts only configured, canonical Toybaco app origins.
  const appOrigin = toybacoAppOrigin();
  const inboxSource = appOrigin
    ? `<a href="${appOrigin}/toybaco/source" target="_blank" rel="noopener noreferrer">問い合わせ対応のソース</a>`
    : '<p>問い合わせ対応の対応ソースを確認できません。</p>';
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>トイバコについて</title>
<style>body{margin:0;background:#faf7f2;color:#24303f;font:16px/1.7 system-ui,sans-serif}main{max-width:640px;margin:auto;padding:32px 20px}h1{font-size:24px}h2{font-size:18px}a,summary{display:block;min-height:44px;box-sizing:border-box;padding:10px 0;color:inherit}details{margin-top:24px;border-top:1px solid #dce2e8}summary{cursor:pointer}p{margin:12px 0}@media(prefers-color-scheme:dark){body{background:#142132;color:#d6e4f2}}</style></head><body><main>
<h1>トイバコについて</h1><p>問い合わせ対応と投稿管理を、ひとつのワークスペースで。</p>
<a href="mailto:support@toybaco.jp">サポートに問い合わせる</a>
<details><summary>ライセンス情報</summary><p>トイバコは以下のオープンソースソフトウェアを利用しています。各ソフトウェアと第三者の権利表示・ライセンスは、それぞれのソースに含まれます。</p>
<h2>問い合わせ対応</h2><p>Chatwoot（MIT。第三者コンポーネントなどの個別条件はライセンス本文を参照）</p>${inboxSource}
<a href="https://github.com/chatwoot/chatwoot/blob/b354a9550e1fb59fa537a9c384232cb076213e72/LICENSE" target="_blank" rel="noopener noreferrer">ライセンスを読む</a>
<h2>投稿管理</h2><p>Postiz 改変版（AGPL-3.0）</p><a href="/api/toybaco/source" target="_blank" rel="noopener noreferrer">稼働中の版の対応ソースを開く</a>
</details></main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
}
