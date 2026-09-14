import { useCallback, useEffect, useRef } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';

type RefreshChannel = { identifier: string; internalId: string };
type RefreshDependencies = {
  browser: Window;
  fetch: (url: string, options?: RequestInit) => Promise<Response>;
  show: (message: string, type: 'success' | 'warning') => void;
  completed: () => void;
};

// OAuth must leave the iframe. Completion still uses the existing callback's
// same-origin, exact WindowProxy and finite outcome contract.
export function createChannelRefresh({ browser, fetch, show, completed }: RefreshDependencies) {
  const owner = browser as Window & { __toybacoConnectPopup?: Window | null };
  let popup: Window | null = null;
  let disposed = false;
  let pending = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let cancel: (() => void) | undefined;
  const finishRequest = () => { pending = false; };
  const release = (close: boolean) => {
    if (owner.__toybacoConnectPopup === popup) owner.__toybacoConnectPopup = null;
    if (close && popup && !popup.closed) popup.close();
    popup = null;
  };
  const onMessage = (event: MessageEvent) => {
    if (disposed || !popup || event.origin !== browser.location.origin ||
        event.source !== popup || owner.__toybacoConnectPopup !== popup) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'toybaco-connect' ||
        !['connected', 'review', 'precondition'].includes(data.outcome)) return;
    generation++;
    release(false);
    show(data.outcome === 'connected' ? 'チャンネルを再接続しました' :
      data.outcome === 'precondition' ? 'チャンネルを接続するための条件を満たしていません' :
      'チャンネルの接続結果を確認してください', data.outcome === 'connected' ? 'success' : 'warning');
    if (data.outcome === 'connected') completed();
  };
  browser.addEventListener('message', onMessage);
  return {
    async refresh(integration: RefreshChannel) {
      if (disposed || pending) return false;
      if (popup && !popup.closed) { popup.focus(); return false; }
      release(false);
      const embedded = !!browser.document.documentElement.dataset.toybacoEmbed;
      if (embedded) {
        // _blank gives this attempt its own WindowProxy; an old unmount must
        // never close a named window reused by another screen's newer flow.
        popup = browser.open('about:blank', '_blank', 'width=600,height=800');
        if (!popup) {
          show('チャンネル再接続用のポップアップを開けませんでした。ブラウザのポップアップを許可して、もう一度お試しください。', 'warning');
          return false;
        }
        owner.__toybacoConnectPopup = popup;
      }
      const attempt = ++generation;
      const activePopup = popup;
      pending = true;
      controller = new AbortController();
      try {
        const read = (async () => {
          const response = await fetch(`/integrations/social/${encodeURIComponent(integration.identifier)}?refresh=${encodeURIComponent(integration.internalId)}`,
            { method: 'GET', signal: controller!.signal });
          if (!response.ok) throw new Error('CHANNEL_REFRESH_UNAVAILABLE');
          return await response.json();
        })();
        const data = await Promise.race([read, new Promise<never>((_, reject) => {
          cancel = () => reject(new Error('CHANNEL_REFRESH_CANCELLED'));
          timer = setTimeout(() => { controller?.abort(); reject(new Error('CHANNEL_REFRESH_TIMEOUT')); }, 15000);
        })]);
        if (disposed || attempt !== generation) return false;
        if (data?.err || typeof data?.url !== 'string' || !data.url) throw new Error('CHANNEL_REFRESH_UNAVAILABLE');
        const url = new URL(data.url, browser.location.origin);
        if (url.username || url.password || (url.protocol !== 'https:' &&
            !(url.origin === browser.location.origin && url.protocol === 'http:'))) throw new Error('CHANNEL_REFRESH_UNAVAILABLE');
        if (embedded) {
          if (!activePopup || activePopup.closed || owner.__toybacoConnectPopup !== activePopup) throw new Error('CHANNEL_REFRESH_CLOSED');
          activePopup.location.href = url.href;
        } else {
          browser.location.href = url.href;
        }
        return true;
      } catch {
        if (!disposed && attempt === generation) {
          release(true);
          show('チャンネルを再接続できませんでした。もう一度お試しください。', 'warning');
        }
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        cancel = undefined;
        finishRequest();
      }
    },
    dispose() {
      disposed = true;
      generation++;
      controller?.abort();
      cancel?.();
      if (timer !== undefined) clearTimeout(timer);
      browser.removeEventListener('message', onMessage);
      release(true);
    },
  };
}

export function useChannelRefresh(onCompleted: () => void) {
  const fetch = useFetch();
  const { show } = useToaster();
  const completed = useRef(onCompleted);
  completed.current = onCompleted;
  const session = useRef<ReturnType<typeof createChannelRefresh> | null>(null);
  useEffect(() => {
    const owned = createChannelRefresh({ browser: window, fetch,
      show, completed: () => completed.current() });
    session.current = owned;
    return () => { if (session.current === owned) session.current = null; owned.dispose(); };
  }, [fetch, show]);
  return useCallback((integration: RefreshChannel) => session.current?.refresh(integration), []);
}
