'use client';

import { useEffect } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { toybacoAcceptPostingContext, toybacoBeginPosting, toybacoDenyPosting, toybacoPostingDocumentId, toybacoPostingSnapshot, toybacoSubscribePosting } from '@gitroom/frontend/components/layout/toybaco.posting.context';

// iframe の load はログイン画面やエラーページでも発火するため、Postiz の
// client mount 完了を明示的に親へ通知する。送信先はserverで検証済みの
// 受信箱originへ固定し、同じimageをstaging/productionで使えるようにする。
export function ToybacoEmbedReady({
  appOrigin,
}: {
  appOrigin: string;
}): null {
  const { genericOauth } = useVariables();
  useEffect(() => {
    let embedded = document.documentElement.dataset.toybacoEmbed === '1';
    // Sec-Fetch-Dest を送らない旧UAや、OAuth後にmarker queryが落ちた場合の補助。
    // 表示判定だけに使い、認証・権限判断には決して使わない。
    if (!embedded) {
      embedded = window.self !== window.top;
      if (embedded) document.documentElement.dataset.toybacoEmbed = '1';
    }
    let documentId: string;
    try { documentId = toybacoPostingDocumentId(); }
    catch { toybacoDenyPosting('context-unavailable'); return; }
    const needsContext = !!embedded && !!genericOauth && window.parent !== window;
    const releasePosting = toybacoBeginPosting(documentId, needsContext, appOrigin);
    if (!embedded || !appOrigin || window.parent === window) {
      if (needsContext) toybacoDenyPosting('context-unavailable');
      return releasePosting;
    }

    const applyTheme = (theme: string) => {
      document.documentElement.dataset.toybacoTheme = theme;
      document.body.classList.remove('dark', 'light');
      document.body.classList.add(theme);
      document.dispatchEvent(new CustomEvent('toybaco:theme-changed'));
    };
    applyTheme(document.documentElement.dataset.toybacoTheme === 'dark' ? 'dark' : 'light');

    // /user/self の取得後に投稿shellが描画される場合もある。認証画面や
    // エラー画面はREADYと誤認せず、shellが揃った時だけ1回通知する。
    let readySent = false;
    let routeBound = false;
    let routeDenied = false;
    let acceptedInitialRoute: { pathname: string; aiIntent: 'compose' | null } | null = null;
    // Read only the presentation intent, before the composer consumes tb_ai.
    // Never copy OAuth query values or the full URL into the parent protocol.
    const initialPathname = window.location.pathname;
    const initialAiIntent = new URLSearchParams(window.location.search).get('tb_ai') === 'compose' ? 'compose' : null;
    const denyInitialRoute = (data: { documentId: string; frameId: string; accountId: string }, reason: 'path-mismatch' | 'context-unavailable') => {
      if (routeDenied) return;
      routeDenied = true;
      toybacoDenyPosting('context-unavailable');
      window.parent.postMessage({ type: 'TOYBACO_POSTIZ_CONTEXT_DENIED',
        documentId: data.documentId, frameId: data.frameId, accountId: data.accountId, reason }, appOrigin);
    };
    const notifyParentIfReady = () => {
      if (readySent) return true;
      const posting = toybacoPostingSnapshot();
      // A cached legacy parent cannot answer INIT. It may reveal only this
      // neutral full-app recovery screen, never unbound business children.
      if (needsContext && !routeDenied && posting.phase === 'denied' && !posting.context &&
          document.querySelector('[data-toybaco-context-recovery]')) {
        window.parent.postMessage({ type: 'TOYBACO_POSTIZ_READY', theme: document.documentElement.dataset.toybacoTheme }, appOrigin);
        readySent = true;
        return true;
      }
      if (needsContext && (posting.phase !== 'ready' || !posting.context || !posting.owner)) return false;
      if (!document.querySelector('[data-toybaco-shell]')) return false;
      if (needsContext && (!routeBound || routeDenied)) return false;
      if (needsContext && acceptedInitialRoute && window.location.pathname !== acceptedInitialRoute.pathname) {
        denyInitialRoute(posting.context!, 'path-mismatch');
        return false;
      }
      window.parent.postMessage(
        { type: 'TOYBACO_POSTIZ_READY', theme: document.documentElement.dataset.toybacoTheme, initialRoute: acceptedInitialRoute,
          ...(posting.context ? { ...posting.context, organizationId: posting.owner?.orgId } : {}) },
        appOrigin
      );
      readySent = true;
      return true;
    };
    const observer = new MutationObserver(() => {
      if (!notifyParentIfReady()) return;
      observer.disconnect();
    });
    if (!notifyParentIfReady()) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    // iframeのキーイベントは親へ伝播しない。子の編集・確認・メニューを
    // 先に保護し、shellで消費されなかったEscapeだけを親へ通知する。
    const dialogSelector = '[data-toybaco-modal], [data-toybaco-composer], [role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-toybaco-channel-menu], .bg-popup';
    const hasOpenDialog = () => Array.from(document.querySelectorAll(dialogSelector))
      .some((element) => element.getClientRects().length > 0);
    let active = true;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      if ((event.target instanceof Element && event.target.closest(dialogSelector)) || hasOpenDialog()) return;
      // 次のtaskまで待つ。microtaskではnativeイベントのbubbleより先に動き得る。
      // capture時点のmodalを守り、子のbubble handlerによるpreventDefaultも尊重する。
      setTimeout(() => {
        if (!active || event.defaultPrevented || hasOpenDialog() || !document.querySelector('[data-toybaco-shell]')) return;
        window.parent.postMessage({ type: 'TOYBACO_POSTIZ_CLOSE' }, appOrigin);
      }, 0);
    };
    let closePending = false;
    const onMessage = (event: MessageEvent) => {
      if (event.origin === appOrigin && event.source === window.parent &&
          event.data && event.data.type === 'TOYBACO_POSTIZ_INIT') {
        if (!needsContext || event.data.documentId !== documentId || routeDenied) return;
        const data = event.data;
        if (typeof data.frameId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.frameId) ||
            typeof data.accountId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(data.accountId)) return;
        if (!routeBound) {
          const route = data.initialRoute;
          // null means the parent already accepted the first document for this
          // frame. A missing field is an old parent, requiring a full reopen.
          if (route !== null) {
            if (!route || typeof route !== 'object' || typeof route.pathname !== 'string' ||
                route.pathname.length > 2000 || !/^\/(launches|analytics|media|settings)(?:\/[A-Za-z0-9._~/-]*)?$/.test(route.pathname) ||
                route.pathname.split('/').some((segment: string) => segment === '.' || segment === '..') ||
                route.pathname === '/settings/templates' || route.pathname.startsWith('/settings/templates/') ||
                (route.aiIntent !== null && route.aiIntent !== 'compose')) {
              denyInitialRoute(data, 'context-unavailable');
              return;
            }
            if (route.pathname !== initialPathname || route.aiIntent !== initialAiIntent) {
              denyInitialRoute(data, 'path-mismatch');
              return;
            }
            acceptedInitialRoute = { pathname: route.pathname, aiIntent: route.aiIntent };
          }
          // Bind before notifying context subscribers; identity bootstrap may
          // resolve synchronously in a cached document.
          routeBound = true;
        }
        toybacoAcceptPostingContext(data);
        return;
      }
      // Parent theme is display-only. Never write the standalone mode cookie.
      if (event.origin === appOrigin && event.source === window.parent &&
          event.data && event.data.type === 'TOYBACO_POSTIZ_THEME' &&
          Number.isSafeInteger(event.data.requestId) && event.data.requestId > 0 &&
          (event.data.theme === 'light' || event.data.theme === 'dark')) {
        applyTheme(event.data.theme);
        window.parent.postMessage({ type: 'TOYBACO_POSTIZ_THEME_APPLIED', theme: event.data.theme, requestId: event.data.requestId }, appOrigin);
        return;
      }
      if (event.origin !== appOrigin || event.source !== window.parent ||
          !event.data || typeof event.data !== 'object' || event.data.type !== 'TOYBACO_POSTIZ_REQUEST_CLOSE' ||
          !Number.isSafeInteger(event.data.requestId) || event.data.requestId <= 0 || closePending) return;
      closePending = true;
      const requestId = event.data.requestId;
      let responded = false;
      const respond = (allowed: boolean) => {
        if (responded) return;
        responded = true;
        closePending = false;
        if (active) window.parent.postMessage({ type: 'TOYBACO_POSTIZ_CLOSE_RESULT', requestId, allowed }, appOrigin);
      };
      // composer自身に既存のaskCloseを委ねる。まだeffect未接続なら本文を残す。
      const request = new CustomEvent('toybaco:request-posting-close', { cancelable: true, detail: respond });
      document.dispatchEvent(request);
      if (!request.defaultPrevented) respond(!document.querySelector('[data-toybaco-composer]'));
      else if (!responded) window.parent.postMessage({ type: 'TOYBACO_POSTIZ_CLOSE_PENDING', requestId }, appOrigin);
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKeydown, true);
    let deniedSent = false;
    const unsubscribePosting = toybacoSubscribePosting(() => {
      const posting = toybacoPostingSnapshot();
      if (posting.documentId !== documentId) return;
      if (!deniedSent && !routeDenied && posting.context && ['blocked', 'denied'].includes(posting.phase)) {
        deniedSent = true;
        window.parent.postMessage({ type: 'TOYBACO_POSTIZ_CONTEXT_DENIED', ...posting.context,
          reason: posting.reason || 'context-unavailable' }, appOrigin);
      }
      notifyParentIfReady();
    });
    const contextTimeout = window.setTimeout(() => {
      const posting = toybacoPostingSnapshot();
      if (needsContext && posting.documentId === documentId && !posting.owner) toybacoDenyPosting('context-unavailable', posting);
    }, 20000);
    if (needsContext) window.parent.postMessage({ type: 'TOYBACO_POSTIZ_CONTEXT_REQUEST', documentId }, appOrigin);
    return () => {
      active = false;
      window.clearTimeout(contextTimeout);
      unsubscribePosting();
      releasePosting();
      observer.disconnect();
      document.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('message', onMessage);
    };
  }, [appOrigin, genericOauth]);

  return null;
}
