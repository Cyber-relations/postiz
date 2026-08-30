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

function toybacoAuthUiRequiresInbox(
  rawPath: unknown,
  searchParams: URLSearchParams,
  hasReturnCookie: boolean
) {
  const pathname = toybacoCanonicalUiPath(rawPath);
  const isGenericOidcReturn =
    pathname === '/auth' &&
    searchParams.get('provider')?.toUpperCase() === 'GENERIC' &&
    Boolean(searchParams.get('code')) &&
    Boolean(searchParams.get('state')) &&
    hasReturnCookie;
  return (
    pathname !== null &&
    (pathname === '/auth' || pathname.startsWith('/auth/')) &&
    pathname !== '/auth/logout' &&
    !isGenericOidcReturn
  );
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
  const parsed = new URL(value, 'https://post.toybaco.invalid');
  if (
    parsed.origin !== 'https://post.toybaco.invalid' ||
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

  // Postiz固有のlogin/register画面は描画せず、常に統一Chatwoot入口へ戻す。
  // logoutだけは下のcookie失効処理へ通すため例外にする。
  if (
    toybacoAuthUiRequiresInbox(
      nextUrl.pathname,
      nextUrl.searchParams,
      request.cookies.has('toybaco_return')
    )
  ) {
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
    nextUrl.pathname === '/'
  ) {
    const entry = new URL('/api/auth/toybaco-entry', nextUrl.href);
    entry.searchParams.set('return', '/launches?tb_embed=1');
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

  // If the url is /auth and the cookie exists, redirect to the bound return.
  if (nextUrl.pathname.startsWith('/auth') && authCookie) {
    const returnCookie = request.cookies.get('toybaco_return')?.value;
    const safeReturn = request.cookies.get('auth')?.value
      ? toybacoSafeReturnPath(returnCookie)
      : null;
    const response = NextResponse.redirect(
      new URL(safeReturn || `/${url}`, nextUrl.href)
    );
    if (returnCookie !== undefined) {
      const legacyDomain = getCookieUrlFromDomain(process.env.FRONTEND_URL!);
      for (const name of ['toybaco_return', 'oauth_state']) {
        expireToybacoProxyCookie(response, name);
        expireToybacoProxyCookie(response, name, legacyDomain);
      }
    }
    return response;
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
