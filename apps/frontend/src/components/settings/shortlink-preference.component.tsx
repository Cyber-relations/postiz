'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import Spinner from '@gitroom/frontend/components/layout/loading';
import { Select } from '@gitroom/react/form/select';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { readSettings, writeSettings, SettingsRequestError, settingsWriteUncertain } from './toybaco-settings-request';

type ShortLinkPreference = 'ASK' | 'YES' | 'NO';

interface ShortlinkPreferenceResponse {
  shortlink: ShortLinkPreference;
}

const isShortlinkPreference = (value: unknown): value is ShortlinkPreferenceResponse => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const preference = value as Record<string, unknown>;
  return Object.keys(preference).length === 1 &&
    ['ASK', 'YES', 'NO'].includes(preference.shortlink as string);
};

export const useShortlinkPreference = () => {
  const fetch = useFetch();

  const load = useCallback(
    () => readSettings(fetch, '/settings/shortlink', isShortlinkPreference),
    [fetch]
  );

  return useSWR<ShortlinkPreferenceResponse>('shortlink-preference', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    shouldRetryOnError: false,
    errorRetryCount: 0,
  });
};

const ShortlinkPreferenceComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, error, isLoading, isValidating, mutate } = useShortlinkPreference();
  const localValue = isShortlinkPreference(data) ? data.shortlink : undefined;
  const valueRef = useRef(localValue);
  valueRef.current = localValue;
  const pending = useRef(false);
  const needsRefresh = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [readError, setReadError] = useState<unknown>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const commitConfirmed = useCallback((value: ShortLinkPreference) => {
    valueRef.current = value;
  }, []);
  const markNeedsRefresh = useCallback((required: boolean) => {
    needsRefresh.current = required;
  }, []);
  const finishRequest = useCallback(() => {
    pending.current = false;
    if (mounted.current) setBusy(false);
  }, []);
  const retry = useCallback(async () => {
    if (pending.current || isValidating) return;
    pending.current = true;
    setBusy(true);
    try {
      const current = await readSettings(fetch, '/settings/shortlink', isShortlinkPreference);
      if (!mounted.current) return;
      commitConfirmed(current.shortlink);
      await mutate(current, { revalidate: false });
      if (!mounted.current) return;
      markNeedsRefresh(false);
      setSaveError(null);
      setReadError(null);
    } catch (failure) {
      markNeedsRefresh(true);
      if (mounted.current) setReadError(failure);
    } finally {
      finishRequest();
    }
  }, [commitConfirmed, fetch, finishRequest, isValidating, markNeedsRefresh, mutate]);

  const handleChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = event.target.value as ShortLinkPreference;
      if (pending.current || needsRefresh.current || error || isValidating || !valueRef.current ||
        !['ASK', 'YES', 'NO'].includes(newValue) || newValue === valueRef.current) return;
      pending.current = true;
      setBusy(true);
      try {
        await writeSettings(fetch, '/settings/shortlink', {
          method: 'POST',
          body: JSON.stringify({ shortlink: newValue }),
        });
        if (!mounted.current) return;
        commitConfirmed(newValue);
        await mutate({ shortlink: newValue }, { revalidate: false });
        if (mounted.current) toaster.show(t('settings_updated', 'Settings updated'), 'success');
      } catch (failure) {
        markNeedsRefresh(true);
        if (mounted.current) setSaveError(failure);
      } finally {
        finishRequest();
      }
    },
    [commitConfirmed, error, fetch, finishRequest, isValidating, markNeedsRefresh, mutate, toaster, t]
  );

  const failure = readError || saveError || error;
  const forbidden = failure instanceof SettingsRequestError && failure.status === 403;
  const uncertain = !!saveError && settingsWriteUncertain(saveError);

  if (!localValue && (isLoading || isValidating) && !failure) {
    return (
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px]">
        <Spinner label="設定を読み込んでいます" />
      </div>
    );
  }

  return (
    <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">
        {t('shortlink_settings', 'Shortlink Settings')}
      </div>
      {!!failure && <div data-toybaco-settings-notice="" role="alert">
        <p>{forbidden ? 'この設定を変更する権限がありません。管理者に確認してください。'
          : readError ? '短縮リンク設定を再確認できませんでした。最後に確認できた設定がある場合は、そのまま表示しています。もう一度再確認してください。'
          : uncertain ? '保存結果を確認できません。最後に確認できた設定を表示しています。設定を再確認してから変更してください。'
          : saveError && localValue ? '設定を保存できませんでした。最後に確認できた設定を表示しています。再確認してからもう一度変更してください。'
          : '短縮リンク設定を読み込めませんでした。設定を再確認してください。'}</p>
        <button type="button" className="min-h-[44px] px-[16px] border rounded-[8px]" disabled={busy || isValidating} onClick={retry}>設定を再確認</button>
      </div>}
      {busy && <p role="status">設定を確認しています…</p>}
      {localValue &&
      <div data-toybaco-shortlink-preference="" className="flex items-center justify-between gap-[24px]">
        <div className="flex flex-col flex-1">
          <div className="text-[14px]">
            {t('shortlink_preference', 'Shortlink Preference')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'shortlink_preference_description',
              'Control how URLs in your posts are handled. Shortlinks provide click statistics.'
            )}
          </div>
        </div>
        <div className="w-[200px]">
          <Select
            name="shortlink"
            aria-label="短縮リンクの扱い"
            label=""
            disableForm={true}
            hideErrors={true}
            value={localValue}
            disabled={busy || isValidating || !!failure}
            onChange={handleChange}
          >
            <option value="ASK">
              {t('shortlink_ask', 'Ask every time')}
            </option>
            <option value="YES">
              {t('shortlink_yes', 'Always shortlink')}
            </option>
            <option value="NO">
              {t('shortlink_no', 'Never shortlink')}
            </option>
          </Select>
        </div>
      </div>
      }
    </div>
  );
};

export default ShortlinkPreferenceComponent;
