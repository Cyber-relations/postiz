'use client';

import React, { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { CopilotTextarea } from '@copilotkit/react-textarea';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

type PostingTextCapability = { feature: 'posting_text'; status: 'configured' | 'disabled' | 'not_configured'; canStart: boolean; verification: 'not_run'; replyQuotaShared: false; reason?: 'posting_editor' };

export async function readPostingTextCapability(fetcher: (url: string, options?: RequestInit) => Promise<Response>): Promise<PostingTextCapability> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('capability_unavailable')); }, 10000);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetcher('/copilot/capabilities', { signal: controller.signal });
      if (!response.ok) throw new Error('capability_unavailable');
      const value = await response.json();
      if (!value || value.feature !== 'posting_text' || !['configured', 'disabled', 'not_configured'].includes(value.status) ||
        value.canStart !== (value.status === 'configured') || value.verification !== 'not_run' || value.replyQuotaShared !== false ||
        (value.reason !== undefined && (value.reason !== 'posting_editor' || value.status !== 'disabled'))) {
        throw new Error('capability_unavailable');
      }
      return value as PostingTextCapability;
    })(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function usePostingTextCapability() {
  const fetch = useFetch();
  const user = useUser();
  const key = user?.id && user?.orgId ? ['toybaco-posting-text-capability', user.id, user.orgId] : null;
  const load = useCallback(() => readPostingTextCapability(fetch), [fetch]);
  const { data, error, isLoading, isValidating, mutate } = useSWR(key, load, {
    revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false, errorRetryCount: 0,
  });
  const checking = !!isLoading || !!isValidating;
  const available = !error && !checking && data?.status === 'configured' && data?.canStart === true;
  return { available, checking, legacyBlocked: !error && !checking && data?.reason === 'posting_editor', error: !!error, capability: data, retry: () => { void mutate().catch(() => {}); } };
}

export const SettingsToggle = ({ value, onChange, label = '下書き作成', fill: _fill, disabled = false }: {
  value: 'on' | 'off'; onChange: (value: 'on' | 'off') => void; label?: string; fill?: boolean; disabled?: boolean;
}) => (
  <button type="button" role="switch" disabled={disabled} aria-label={label} aria-checked={value === 'on'}
    data-toybaco-settings-switch="" onClick={() => onChange(value === 'on' ? 'off' : 'on')}>
    <span aria-hidden="true"><span /></span>
  </button>
);

type AssistedProps = {
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  id?: string;
  'aria-label'?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  disableBranding?: boolean;
  autosuggestionsConfig: React.ComponentProps<typeof CopilotTextarea>['autosuggestionsConfig'];
};

export const ToybacoAssistedTextarea = ({ autosuggestionsConfig, disableBranding: _branding, ...props }: AssistedProps) => {
  const { available, checking, legacyBlocked, error, retry } = usePostingTextCapability();
  const [requested, setRequested] = useState(false);
  useEffect(() => { if (!available) setRequested(false); }, [available]);
  const active = requested && available && !props.disabled;
  return (
    <div data-toybaco-assisted-textarea="">
      {active ? <CopilotTextarea {...props} disableBranding={true} autosuggestionsConfig={autosuggestionsConfig} /> : <textarea {...props} />}
      {legacyBlocked ? <p role="status">AI文案は投稿作成で利用できます。</p> : <div data-toybaco-assistance-actions="">
        <button type="button" disabled={!available || props.disabled} aria-pressed={active}
          onClick={() => setRequested(!active)}>{active ? 'AI入力補助を終了' : 'AI入力補助を使う'}</button>
        <p role="status">{active ? '入力内容をもとに、AIが続きの候補を提案します。' : available
          ? '入力に合わせた候補を提案します。' : checking ? 'AI入力補助の設定を確認しています。'
          : error ? 'AIの利用状態を確認できません。通常の入力は利用できます。' : '現在AI入力補助を利用できません。通常の入力は利用できます。'}</p>
        {error && <button type="button" disabled={checking} onClick={retry}>再確認</button>}
      </div>}
    </div>
  );
};
