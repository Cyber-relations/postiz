'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import Spinner from '@gitroom/frontend/components/layout/loading';
import { SettingsToggle as Slider } from '@gitroom/frontend/components/settings/toybaco-settings-controls';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { readSettings, writeSettings, SettingsRequestError, settingsWriteUncertain } from './toybaco-settings-request';

interface EmailNotifications {
  sendSuccessEmails: boolean;
  sendFailureEmails: boolean;
  sendStreakEmails: boolean;
}

const isEmailNotifications = (value: unknown): value is EmailNotifications => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return Object.keys(settings).length === 3 &&
    ['sendSuccessEmails', 'sendFailureEmails', 'sendStreakEmails'].every(
      (key) => typeof settings[key] === 'boolean'
    );
};

export const useEmailNotifications = () => {
  const fetch = useFetch();

  const load = useCallback(
    () => readSettings(fetch, '/user/email-notifications', isEmailNotifications),
    [fetch]
  );

  return useSWR<EmailNotifications>('email-notifications', load, {
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

const EmailNotificationsComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, error, isLoading, isValidating, mutate } = useEmailNotifications();
  const localSettings = isEmailNotifications(data) ? data : undefined;
  const settingsRef = useRef(localSettings);
  settingsRef.current = localSettings;
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
  const commitConfirmed = useCallback((value: EmailNotifications) => {
    settingsRef.current = value;
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
      const current = await readSettings(fetch, '/user/email-notifications', isEmailNotifications);
      if (!mounted.current) return;
      commitConfirmed(current);
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

  const updateSetting = useCallback(
    async (key: keyof EmailNotifications, value: boolean) => {
      const currentSettings = settingsRef.current;
      if (pending.current || needsRefresh.current || error || isValidating || !currentSettings || currentSettings[key] === value) return;
      pending.current = true;
      setBusy(true);
      const newData = {
        ...currentSettings,
        [key]: value,
      };

      try {
        await writeSettings(fetch, '/user/email-notifications', {
          method: 'POST',
          body: JSON.stringify(newData),
        });
        if (!mounted.current) return;
        commitConfirmed(newData);
        await mutate(newData, { revalidate: false });
        if (mounted.current) toaster.show(t('settings_updated', 'Settings updated'), 'success');
      } catch (failure) {
        markNeedsRefresh(true);
        if (mounted.current) setSaveError(failure);
      } finally {
        finishRequest();
      }
    },
    [commitConfirmed, error, fetch, finishRequest, isValidating, markNeedsRefresh, mutate, t, toaster]
  );

  const handleSuccessEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendSuccessEmails', value === 'on');
    },
    [updateSetting]
  );

  const handleFailureEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendFailureEmails', value === 'on');
    },
    [updateSetting]
  );

  const handleStreakEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendStreakEmails', value === 'on');
    },
    [updateSetting]
  );

  const disabled = busy || !!isValidating || !!error || !!saveError || !!readError;
  const failure = readError || saveError || error;
  const forbidden = failure instanceof SettingsRequestError && failure.status === 403;
  const uncertain = !!saveError && settingsWriteUncertain(saveError);

  if (!localSettings && (isLoading || isValidating) && !failure) {
    return (
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px]">
        <Spinner label="設定を読み込んでいます" />
      </div>
    );
  }

  return (
    <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">
        {t('email_notifications', 'Email Notifications')}
      </div>
      {!!failure && <div data-toybaco-settings-notice="" role="alert">
        <p>{forbidden ? 'この設定を操作する権限がありません。管理者に確認してください。'
          : readError ? '通知設定を再確認できませんでした。最後に確認できた設定がある場合は、そのまま表示しています。もう一度再確認してください。'
          : uncertain ? '保存結果を確認できません。最後に確認できた設定を表示しています。設定を再確認してから変更してください。'
          : saveError && localSettings ? '設定を保存できませんでした。最後に確認できた設定を表示しています。再確認してからもう一度変更してください。'
          : '通知設定を読み込めませんでした。設定を再確認してください。'}</p>
        <button type="button" className="min-h-[44px] px-[16px] border rounded-[8px]" disabled={busy || isValidating} onClick={retry}>設定を再確認</button>
      </div>}
      {busy && <p role="status">設定を確認しています…</p>}
      {localSettings && <>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('success_emails', 'Success Emails')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'success_emails_description',
              'Receive email notifications when posts are published successfully'
            )}
          </div>
        </div>
        <Slider label="公開成功の通知"
          disabled={disabled}
          value={localSettings.sendSuccessEmails ? 'on' : 'off'}
          onChange={handleSuccessEmailsChange}
          fill={true}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('failure_emails', 'Failure Emails')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'failure_emails_description',
              'Receive email notifications when posts fail to publish'
            )}
          </div>
        </div>
        <Slider label="公開失敗の通知"
          disabled={disabled}
          value={localSettings.sendFailureEmails ? 'on' : 'off'}
          onChange={handleFailureEmailsChange}
          fill={true}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('streak_emails', 'Streak Reminder Emails')}
          </div>
          <div className="text-[12px] text-customColor18">
            {t(
              'streak_emails_description',
              'Receive email reminders when your posting streak is about to end'
            )}
          </div>
        </div>
        <Slider label="継続利用の通知"
          disabled={disabled}
          value={localSettings.sendStreakEmails ? 'on' : 'off'}
          onChange={handleStreakEmailsChange}
          fill={true}
        />
      </div>
      </>}
    </div>
  );
};

export default EmailNotificationsComponent;
