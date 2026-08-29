'use client';

import { useEffect } from 'react';

// iframe の load はログイン画面やエラーページでも発火するため、Postiz の
// client mount 完了を明示的に親へ通知する。送信先はserverで検証済みの
// 受信箱originへ固定し、同じimageをstaging/productionで使えるようにする。
export function ToybacoEmbedReady({
  appOrigin,
}: {
  appOrigin: string;
}): null {
  useEffect(() => {
    let embedded = document.documentElement.dataset.toybacoEmbed === '1';
    // Sec-Fetch-Dest を送らない旧UAや、OAuth後にmarker queryが落ちた場合の補助。
    // 表示判定だけに使い、認証・権限判断には決して使わない。
    if (!embedded) {
      embedded = window.self !== window.top;
      if (embedded) document.documentElement.dataset.toybacoEmbed = '1';
    }
    if (!embedded || !appOrigin || window.parent === window) return;

    // /user/self の取得後に投稿shellが描画される場合もある。認証画面や
    // エラー画面はREADYと誤認せず、shellが揃った時だけ1回通知する。
    const notifyParentIfReady = () => {
      if (!document.querySelector('[data-toybaco-shell]')) return false;
      window.parent.postMessage(
        { type: 'TOYBACO_POSTIZ_READY' },
        appOrigin
      );
      return true;
    };
    if (notifyParentIfReady()) return;

    const observer = new MutationObserver(() => {
      if (!notifyParentIfReady()) return;
      observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [appOrigin]);

  return null;
}
