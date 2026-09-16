import { NextResponse } from 'next/server';
import { toybacoAppOrigin } from '@gitroom/frontend/helpers/toybaco.app.origin';
import type { NextRequest } from 'next/server';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import acceptLanguage from 'accept-language';
import {
  cookieName,
  headerName,
  languages,
} from '@gitroom/react/translation/i18n.config';
acceptLanguage.languages(languages);

const TOYBACO_BLOCKED_UI_PREFIXES = Object.freeze([
  '/admin',
  '/agents',
  '/affiliate',
  '/auth/activate',
  '/auth/forgot',
  '/auth/register',
  '/billing',
  '/marketplace',
  '/messages',
  '/oauth',
  '/plugs',
  '/provider',
  '/third-party',
]);

function toybacoCanonicalUiPath(rawPath: unknown) {
  let value = String(rawPath || '/').split(/[?#]/, 1)[0] || '/';
  for (let round = 0; round < 4; round++) {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }
    if (decoded === value) break;
    value = decoded;
  }
  if (
    /%[0-9a-f]{2}/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  value = value.replace(/\\/g, '/');
  const segments = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return ('/' + segments.join('/')).replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase()
  );
}

function toybacoUiBlocked(rawPath: unknown) {
  const pathname = toybacoCanonicalUiPath(rawPath);
  // 解釈不能なpathは通常画面へ通さず、安全な投稿一覧へ戻す。
  if (pathname === null) return true;
  return TOYBACO_BLOCKED_UI_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// toybaco_identity_boundary_v1: OIDC往復後の戻り先も4画面に閉じる。
const TOYBACO_RETURN_PATHS = ['/launches', '/analytics', '/media', '/settings'];
const TOYBACO_LOGOUT_COOKIES = [
  'auth',
  'showorg',
  'impersonate',
  'oauth_state',
  'toybaco_return',
  'toybaco_embed',
];

function toybacoCallbackParameters(params: URLSearchParams) {
  const state = params.get('state');
  const code = params.get('code');
  const error = params.get('error');
  if (params.getAll('state').length !== 1 || !state || !/^toybaco-[A-Za-z0-9_-]{43}$/.test(state) ||
      params.getAll('code').length > 1 || params.getAll('error').length > 1 ||
      params.getAll('provider').length > 1 || params.has('id_token') ||
      Boolean(code) === Boolean(error) || (code !== null && (!code || code.length > 2048)) ||
      (error !== null && (!error || error.length > 200))) return null;
  return { state, code, error, cookieName: '__Host-toybaco_oidc_' + state.slice('toybaco-'.length) };
}

function toybacoAuthUiRequiresInbox(
  rawPath: unknown,
  searchParams: URLSearchParams,
  hasFlowCookie: boolean
) {
  const pathname = toybacoCanonicalUiPath(rawPath);
  const isGenericOidcReturn =
    pathname === '/auth' &&
    searchParams.get('provider')?.toUpperCase() === 'GENERIC' &&
    toybacoCallbackParameters(searchParams) !== null &&
    hasFlowCookie;
  return (
    pathname !== null &&
    (pathname === '/auth' || pathname.startsWith('/auth/')) &&
    pathname !== '/auth/logout' &&
    !isGenericOidcReturn
  );
}

// Embedded authentication failure is a presentation-only recovery document.
// Never navigate the iframe into the parent application or relax OIDC validation.
function toybacoEmbeddedAuthRecovery(appOrigin: string, theme: string | null) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const initialTheme = theme === 'dark' ? 'dark' : 'light';
  const originJson = JSON.stringify(appOrigin).replace(/</g, '\\u003c');
  const originHref = appOrigin.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const client = `(() => {
    const origin = ${originJson};
    const parent = window.parent;
    if (parent === window) return;
    const documentId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    window.addEventListener('message', (event) => {
      if (event.origin !== origin || event.source !== parent || !event.data) return;
      const data = event.data;
      if (data.type === 'TOYBACO_POSTIZ_INIT' && uuid.test(documentId) &&
          data.documentId === documentId && typeof data.frameId === 'string' && uuid.test(data.frameId) &&
          typeof data.accountId === 'string' && /^[1-9][0-9]{0,18}$/.test(data.accountId)) {
        parent.postMessage({ type: 'TOYBACO_POSTIZ_CONTEXT_DENIED', documentId,
          frameId: data.frameId, accountId: data.accountId, reason: 'context-unavailable' }, origin);
      }
      if (data.type === 'TOYBACO_POSTIZ_THEME' && Number.isSafeInteger(data.requestId) && data.requestId > 0 &&
          (data.theme === 'light' || data.theme === 'dark')) {
        document.documentElement.dataset.theme = data.theme;
        parent.postMessage({ type: 'TOYBACO_POSTIZ_THEME_APPLIED', theme: data.theme, requestId: data.requestId }, origin);
      }
    });
    if (uuid.test(documentId)) parent.postMessage({ type: 'TOYBACO_POSTIZ_CONTEXT_REQUEST', documentId }, origin);
    // Cached parents may reveal this neutral document only; no business UI exists.
    parent.postMessage({ type: 'TOYBACO_POSTIZ_READY', theme: document.documentElement.dataset.theme }, origin);
  })();`;
  return new NextResponse(`<!doctype html><html lang="ja" data-theme="${initialTheme}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>接続の確認 | トイバコ</title><style nonce="${nonce}">
:root{color-scheme:light;--surface:#F8F4EE;--ink:#1F3A5F;--line:#DED6CA}
:root[data-theme=dark]{color-scheme:dark;--surface:#181A1F;--ink:#F2EEE7;--line:#45464D}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.65 system-ui,sans-serif}
main{min-height:240px;max-width:520px;margin:auto;padding:32px 24px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
h1{font-size:18px;line-height:1.5;margin:0}p{margin:0}a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:12px;padding:10px 20px;color:inherit;text-decoration:none;font-weight:600}
a:focus-visible{outline:2px solid currentColor;outline-offset:3px}
</style></head><body><main data-toybaco-auth-recovery role="status"><h1>投稿への接続を確認できません</h1>
<p>トイバコを開き直してから、もう一度投稿画面を開いてください。</p>
<a href="${originHref}" target="_top">トイバコを開き直す</a></main><script nonce="${nonce}">${client}</script></body></html>`, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'self' ${appOrigin}; base-uri 'none'; form-action 'none'`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function toybacoSafeReturnPath(rawValue: string | undefined) {
  if (typeof rawValue !== 'string' || rawValue.length > 4096) return null;
  let value: string;
  try {
    // Express cookie encoderの1回分だけ戻す。残ったpercentは多重解釈を避けて拒否。
    value = decodeURIComponent(rawValue);
  } catch {
    return null;
  }
  if (
    value.length < 1 ||
    value.length > 2000 ||
    value.includes('%') ||
    value.includes('\\') ||
    value.includes('#') ||
    !/^\/[A-Za-z0-9._~/?=&-]*$/.test(value)
  ) {
    return null;
  }
  const rawPath = value.split('?', 1)[0];
  if (rawPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  let parsed: URL;
  try { parsed = new URL(value, 'https://post.toybaco.invalid'); } catch { return null; }
  if (
    parsed.origin !== 'https://post.toybaco.invalid' ||
    [...parsed.searchParams.keys()].some((key) =>
      ['code', 'state', 'error', 'id_token', 'error_description', 'access_token'].includes(key.toLowerCase())
    ) ||
    !TOYBACO_RETURN_PATHS.some(
      (prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }
  return parsed.pathname + parsed.search;
}

function expireToybacoProxyCookie(
  response: NextResponse,
  name: string,
  domain?: string
) {
  response.headers.append(
    'Set-Cookie',
    [
      `${name}=`,
      'Path=/',
      'Max-Age=0',
      ...(domain ? [`Domain=${domain}`] : []),
      'Secure',
      'HttpOnly',
      'SameSite=Lax',
    ].join('; ')
  );
}

// This function can be marked `async` if using `await` inside
export async function proxy(request: NextRequest) {
  const nextUrl = request.nextUrl;
  const authCookie =
    request.cookies.get('auth') ||
    request.headers.get('auth') ||
    nextUrl.searchParams.get('loggedAuth');
  const lng = request.cookies.has(cookieName)
    ? acceptLanguage.get(request.cookies.get(cookieName).value)
    : acceptLanguage.get(
        request.headers.get('Accept-Language') ||
          request.headers.get('accept-language')
      );

  const requestHeaders = new Headers(request.headers);
  // Sec-Fetch-Dest を送らない旧UAだけ、受信箱が付ける固定markerで補う。
  // 外部から同名headerを送られても、ここで必ず削除または上書きする。
  const toybacoEmbed =
    request.headers.get('sec-fetch-dest') === 'iframe' ||
    nextUrl.searchParams.get('tb_embed') === '1';
  // Presentation only. Do not trust an incoming internal header or widen the
  // existing OIDC return-path/identity boundary to carry this enum.
  requestHeaders.delete('x-toybaco-theme');
  const toybacoTheme = nextUrl.searchParams.get('tb_theme');
  if (toybacoEmbed && (toybacoTheme === 'light' || toybacoTheme === 'dark')) {
    requestHeaders.set('x-toybaco-theme', toybacoTheme);
  }
  if (toybacoEmbed) {
    requestHeaders.set('x-toybaco-embed', '1');
  } else {
    requestHeaders.delete('x-toybaco-embed');
  }
  if (lng) {
    requestHeaders.set(headerName, lng);
  }

  const appOrigin = toybacoAppOrigin();
  if (!appOrigin) {
    return new NextResponse('トイバコの接続先設定を確認できませんでした', {
      status: 503,
      headers: {
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    });
  }

  const topResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  topResponse.headers.set(
    'Content-Security-Policy',
    `frame-ancestors 'self' ${appOrigin}`
  );

  if (lng) {
    topResponse.headers.set(cookieName, lng);
  }

  // A callback always validates its own flow, even while another tab has a session.
  const callbackPath = nextUrl.pathname === '/settings' &&
    ['code', 'state', 'error', 'id_token'].some((key) => nextUrl.searchParams.has(key));
  const genericAuthPath = nextUrl.pathname === '/auth' &&
    nextUrl.searchParams.get('provider')?.toUpperCase() === 'GENERIC';
  if (callbackPath || genericAuthPath) {
    const callback = toybacoCallbackParameters(nextUrl.searchParams);
    if (request.method !== 'GET' || !callback || !request.cookies.has(callback.cookieName)) {
      return toybacoEmbed
        ? toybacoEmbeddedAuthRecovery(appOrigin, toybacoTheme)
        : NextResponse.redirect(new URL('/', appOrigin));
    }
    if (callbackPath) {
      const target = new URL('/auth', nextUrl.href);
      target.searchParams.set('provider', 'GENERIC');
      target.searchParams.set('state', callback.state);
      if (callback.code) target.searchParams.set('code', callback.code);
      if (callback.error) target.searchParams.set('error', callback.error);
      if (toybacoEmbed) target.searchParams.set('tb_embed', '1');
      const response = NextResponse.redirect(target);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    topResponse.headers.set('Cache-Control', 'no-store');
    topResponse.headers.set('Referrer-Policy', 'no-referrer');
    return topResponse;
  }

  // Postiz固有のlogin/register画面は描画せず、常に統一Chatwoot入口へ戻す。
  // logoutだけは下のcookie失効処理へ通すため例外にする。
  if (
    toybacoAuthUiRequiresInbox(
      nextUrl.pathname,
      nextUrl.searchParams,
      false // Valid GENERIC callbacks have already been handled above.
    )
  ) {
    if (request.method === 'GET' && toybacoEmbed) {
      return toybacoEmbeddedAuthRecovery(appOrigin, toybacoTheme);
    }
    return NextResponse.redirect(new URL('/', appOrigin));
  }

  // toybaco_product_ui_boundary_v2: upstreamの早期returnより先に判定する。
  if (toybacoUiBlocked(nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/launches', nextUrl.href));
  }

  if (nextUrl.pathname.startsWith('/modal/') && !authCookie) {
    return NextResponse.redirect(new URL(`/auth/login-required`, nextUrl.href));
  }

  if (
    nextUrl.pathname.startsWith('/uploads/') ||
    nextUrl.pathname.startsWith('/p/') ||
    nextUrl.pathname.startsWith('/provider/') ||
    nextUrl.pathname.startsWith('/icons/')
  ) {
    return topResponse;
  }

  if (
    nextUrl.pathname.startsWith('/integrations/social/') &&
    nextUrl.href.indexOf('state=login') === -1
  ) {
    return topResponse;
  }

  // トイバコ統合: ブラウザの画面遷移だけを受信箱の統合ビューへ送る。
  // 統合先が未設定なら何もしないため、Postiz と受信箱を段階的に投入できる。
  const toybacoUnified = process.env.TOYBACO_UNIFIED_URL;
  if (toybacoUnified) {
    const dest = request.headers.get('sec-fetch-dest');
    const urlMarker = nextUrl.searchParams.get('tb_embed') === '1';
    // cookie での抑止は「ヘッダを送らない古い UA」のためだけに使う。
    // 新しいブラウザの top-level(dest==='document')は cookie が残っていても必ず転送する。
    // ここを混ぜると、一度埋め込みを使った人のメールリンクが二度と統合ビューへ着地しなくなる。
    const cookieMarker =
      request.cookies.get('toybaco_embed')?.value === '1';
    const allow = new Set([
      '/',
      '/launches',
      '/analytics',
      '/media',
      '/settings',
    ]);
    // 「/launches/」のような末尾スラッシュ違いで許可リストから外れないようにする
    const normalizedPath =
      nextUrl.pathname.length > 1 && nextUrl.pathname.endsWith('/')
        ? nextUrl.pathname.slice(0, -1)
        : nextUrl.pathname;
    // トイバコID からの帰り道。code と state が揃うとは限らない
    // (拒否時は error と state だけで戻る)。どれか1つでもあれば転送しない。
    // ここを取りこぼすと、認可の帰りが受信箱へ飛ばされてログインが完了しない。
    const isOidcReturn =
      nextUrl.pathname === '/settings' &&
      (nextUrl.searchParams.has('code') ||
        nextUrl.searchParams.has('state') ||
        nextUrl.searchParams.has('error') ||
        nextUrl.searchParams.has('id_token'));
    if (
      request.method === 'GET' &&
      !urlMarker &&
      allow.has(normalizedPath) &&
      !isOidcReturn &&
      // iframe(dest==='iframe')はここで自然に除外される。
      // 'empty'(fetch/RSC)や HEAD も転送しない。画面遷移だけを対象にする。
      (dest === 'document' || (dest === null && !cookieMarker))
    ) {
      const target = new URL(toybacoUnified);
      // 「/」のままだと投稿画面側が /launches へ内部転送し、その際に
      // 埋め込みの目印(tb_embed)が落ちる。先に行き先を確定させておく。
      const landingPath =
        normalizedPath === '/'
          ? process.env.IS_GENERAL
            ? '/launches'
            : '/analytics'
          : normalizedPath;
      target.hash =
        '/toybaco/posting?path=' +
        encodeURIComponent(landingPath + nextUrl.search);
      return NextResponse.redirect(target, 302);
    }
    if (nextUrl.searchParams.get('tb_embed') === '1') {
      // 古い UA が iframe 内で再読み込みしても転送しないよう、応答にも目印を残す。
      topResponse.cookies.set('toybaco_embed', '1', {
        path: '/',
        secure: true,
        sameSite: 'lax',
      });
    }
  }

  // 埋め込みsessionの期限切れ時もChatwootをiframe内へ描画せず、
  // 既存の専用entryからトイバコIDへ再束縛する。
  if (
    request.method === 'GET' &&
    toybacoEmbed &&
    !authCookie &&
    !['code', 'state', 'error', 'id_token'].some((key) => nextUrl.searchParams.has(key)) &&
    (nextUrl.pathname === '/' || toybacoSafeReturnPath(nextUrl.pathname + nextUrl.search))
  ) {
    const returnUrl = new URL(nextUrl.pathname === '/' ? '/launches' : nextUrl.pathname, nextUrl.href);
    returnUrl.search = nextUrl.search;
    returnUrl.searchParams.set('tb_embed', '1');
    const safeReturn = toybacoSafeReturnPath(returnUrl.pathname + returnUrl.search);
    if (!safeReturn) return toybacoEmbeddedAuthRecovery(appOrigin, toybacoTheme);
    const entry = new URL('/toybaco/entry', nextUrl.href);
    entry.searchParams.set('return', safeReturn);
    entry.searchParams.set('tb_embed', '1');
    return NextResponse.redirect(entry);
  }

  // Chatwoot logoutのfront-channel。host-only JWTと旧domain cookieを消し、
  // Postizのlogin画面を見せず統一Chatwoot入口へ戻す。
  if (nextUrl.pathname === '/auth/logout') {
    const response = NextResponse.redirect(new URL('/', appOrigin));
    const legacyDomain = getCookieUrlFromDomain(process.env.FRONTEND_URL!);
    for (const name of TOYBACO_LOGOUT_COOKIES) {
      expireToybacoProxyCookie(response, name);
      expireToybacoProxyCookie(response, name, legacyDomain);
    }
    for (const { name } of request.cookies.getAll()) {
      if (/^__Host-toybaco_oidc_[A-Za-z0-9_-]{43}$/.test(name)) {
        expireToybacoProxyCookie(response, name);
      }
    }
    return response;
  }

  if (
    nextUrl.pathname.startsWith('/auth/register') &&
    process.env.DISABLE_REGISTRATION === 'true'
  ) {
    return NextResponse.redirect(new URL('/auth/login', nextUrl.href));
  }

  const org = nextUrl.searchParams.get('org');
  const url = new URL(nextUrl).search;
  if (!nextUrl.pathname.startsWith('/auth') && !authCookie) {
    const providers = ['google', 'settings'];
    const findIndex = providers.find((p) => nextUrl.href.indexOf(p) > -1);
    const additional = !findIndex
      ? ''
      : (url.indexOf('?') > -1 ? '&' : '?') +
        `provider=${(findIndex === 'settings'
          ? process.env.POSTIZ_GENERIC_OAUTH
            ? 'generic'
            : 'github'
          : findIndex
        ).toUpperCase()}`;
    return NextResponse.redirect(
      new URL(`/auth${url}${additional}`, nextUrl.href)
    );
  }

  // If the url is /auth and the cookie exists, redirect to the unified entry.
  // GENERIC callbacks already returned above; shared return cookies are never consumed.
  if (nextUrl.pathname.startsWith('/auth') && authCookie) {
    return NextResponse.redirect(new URL('/', appOrigin));
  }
  if (nextUrl.pathname.startsWith('/auth') && !authCookie) {
    if (org) {
      const redirect = NextResponse.redirect(new URL(`/`, nextUrl.href));
      redirect.cookies.set('org', org, {
        ...(!process.env.NOT_SECURED
          ? {
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: false,
              domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
            }
          : {}),
        expires: new Date(Date.now() + 15 * 60 * 1000),
      });
      return redirect;
    }
    return topResponse;
  }
  try {
    if (org) {
      const { id } = await (
        await internalFetch('/user/join-org', {
          body: JSON.stringify({
            org,
          }),
          method: 'POST',
        })
      ).json();
      const redirect = NextResponse.redirect(
        new URL(`/?added=true`, nextUrl.href)
      );
      if (id) {
        redirect.cookies.set('showorg', id, {
          ...(!process.env.NOT_SECURED
            ? {
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: false,
                domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
              }
            : {}),
          expires: new Date(Date.now() + 15 * 60 * 1000),
        });
      }
      return redirect;
    }
    if (nextUrl.pathname === '/') {
      return NextResponse.redirect(
        new URL(
          !!process.env.IS_GENERAL ? '/launches' : `/analytics`,
          nextUrl.href
        )
      );
    }

    return topResponse;
  } catch (err) {
    console.log('err', err);
    return NextResponse.redirect(new URL('/auth/logout', nextUrl.href));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
};