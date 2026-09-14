'use client';

import { useState, useSyncExternalStore } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { toybacoPostingServerSnapshot, toybacoPostingSnapshot, toybacoSubscribePosting, toybacoVerifyPostingIdentity } from '@gitroom/frontend/components/layout/toybaco.posting.context';

export function ToybacoPostingConnectionNotice({ placement = 'shell' }: { placement?: 'shell' | 'composer' }) {
  const { backendUrl } = useVariables();
  const posting = useSyncExternalStore(toybacoSubscribePosting, toybacoPostingSnapshot, toybacoPostingServerSnapshot);
  const [verifying, setVerifying] = useState(false);
  if (!posting.message) return null;
  return (
    <div data-toybaco-posting-notice={placement} role="alert"
      className="relative z-0 mx-3 mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-newTextColor/20 bg-newBgColorInner p-3 text-sm text-newTextColor"
      style={{ minWidth: 0, maxHeight: 'min(35dvh, 15rem)', overflowY: 'auto' }}>
      <p className="min-w-0 basis-full sm:basis-0 sm:flex-1">{posting.message}</p>
      {posting.appOrigin && posting.context && (
        <a href={`${posting.appOrigin}/app/accounts/${posting.context.accountId}/dashboard#/toybaco/posting?path=%2Flaunches`} target="_blank" rel="noopener noreferrer"
          className="flex min-h-[44px] items-center rounded-lg border border-newTextColor/20 px-4 py-2 font-semibold">別タブで再接続</a>
      )}
      <button type="button" disabled={verifying} className="min-h-[44px] rounded-lg border border-newTextColor/20 px-4 py-2 font-semibold disabled:opacity-50"
        onClick={async () => { setVerifying(true); try { await toybacoVerifyPostingIdentity(backendUrl); } finally { setVerifying(false); } }}>
        {verifying ? '確認中…' : '接続を確認'}
      </button>
    </div>
  );
}
