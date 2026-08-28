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
    // 認証画面やエラー画面のmountをREADYと誤認しない。実際の投稿shellが
    // DOMに揃った時だけ受信箱へ準備完了を返す。
    if (
      !embedded ||
      !appOrigin ||
      window.parent === window ||
      !document.querySelector('[data-toybaco-shell]')
    ) {
      return;
    }
    window.parent.postMessage(
      { type: 'TOYBACO_POSTIZ_READY' },
      appOrigin
    );
  }, [appOrigin]);

  return null;
}
