'use client';

import React, { FC, Fragment, useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm } from 'react-hook-form';
import { array, boolean, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { ToybacoAssistedTextarea, usePostingTextCapability } from '@gitroom/frontend/components/settings/toybaco-settings-controls';
import { SettingsToggle as Slider } from '@gitroom/frontend/components/settings/toybaco-settings-controls';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { readSettings, writeSettings, settingsWriteMessage, settingsWriteUncertain } from '@gitroom/frontend/components/settings/toybaco-settings-request';

type RssRecord = { id: string; title: string; url: string; active: boolean; integrations: string; onSlot: boolean; syncLast: boolean; addPicture: boolean; generateContent: boolean; lastUrl: string; content: string | null };
const isRssList = (value: unknown): value is RssRecord[] => Array.isArray(value) && value.every(item => {
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.url !== 'string' || typeof item.active !== 'boolean' || typeof item.integrations !== 'string') return false;
  if (['onSlot', 'syncLast', 'addPicture', 'generateContent'].some(key => typeof item[key] !== 'boolean') || typeof item.lastUrl !== 'string' || (item.content !== null && typeof item.content !== 'string')) return false;
  try { const integrations = JSON.parse(item.integrations); return Array.isArray(integrations) && integrations.every(row => row && typeof row.id === 'string'); } catch { return false; }
});
export const Autopost: FC = () => {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fetch = useFetch();
  const t = useT();
  const modal = useModals();
  const toaster = useToaster();
  const list = useCallback(() => readSettings(fetch, '/autopost', isRssList), [fetch]);
  const { data, error, isLoading, isValidating, mutate } = useSWR('autopost', list, {
    revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false, errorRetryCount: 0,
  });
  const [operationError, setOperationError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const finishOperation = useCallback(() => { busyRef.current = false; if (alive.current) setBusy(false); }, []);
  const [needsReview, setNeedsReview] = useState(false);
  const reviewRequired = useRef(false);
  const markNeedsReview = useCallback((required: boolean) => { reviewRequired.current = required; setNeedsReview(required); }, []);
  const [readingList, setReadingList] = useState(false);
  const refreshList = useCallback(async () => {
    markNeedsReview(true);
    setReadingList(true);
    try {
      // mutate() alone may return stale cached rows after a failed revalidation.
      const records = await list();
      if (!alive.current) throw new Error('SETTINGS_VIEW_CLOSED');
      await mutate(records, false);
      if (!alive.current) return records;
      markNeedsReview(false);
      setOperationError('');
      return records;
    } catch (error) {
      if (alive.current) setOperationError('最新の一覧を確認できませんでした。前回の表示を残しています。一覧を再確認してください。');
      throw error;
    } finally { if (alive.current) setReadingList(false); }
  }, [list, mutate, markNeedsReview]);
  const retryList = () => { void refreshList().then(() => { if (alive.current) setOperationError(''); }).catch(() => { if (alive.current) setOperationError('最新の一覧を確認できませんでした。前回の表示を残しています。もう一度お試しください。'); }); };
  const refreshAfterWrite = useCallback(() => {
    if (!alive.current) return;
    markNeedsReview(true);
    void refreshList().catch(() => { if (alive.current) setOperationError('変更は保存されましたが、最新の一覧を確認できませんでした。前回の表示を残しています。一覧を再確認してください。'); });
  }, [refreshList, markNeedsReview]);
  const addWebhook = useCallback(
    (data?: any) => (event: React.MouseEvent<HTMLButtonElement>) => {
      modal.openModal({
        title: data ? 'RSSの下書き設定を編集' : 'RSSから下書きを作成',
        withCloseButton: true,
        toybacoSettingsDialog: true,
        id: `toybaco-rss-${data?.id || 'new'}`,
        toybacoReturnFocus: event.currentTarget,
        children: <AddOrEditWebhook data={data} reload={refreshList} onSaved={refreshAfterWrite} />,
      });
    },
    [modal, refreshList, refreshAfterWrite]
  );
  const deleteHook = useCallback(
    (record: RssRecord) => async () => {
      if (busyRef.current || reviewRequired.current || readingList || needsReview) return;
      busyRef.current = true;
      setBusy(true);
      try {
        if (!await deleteDialog(`RSS設定「${record.title}」を削除してもよろしいですか？`)) return;
        await writeSettings(fetch, `/autopost/${record.id}`, { method: 'DELETE' });
        if (!alive.current) return;
        setOperationError('');
        toaster.show('RSS設定を削除しました', 'success');
        refreshAfterWrite();
      } catch (error) { if (!alive.current) return; setOperationError(settingsWriteMessage(error, '削除')); markNeedsReview(settingsWriteUncertain(error)); }
      finally { finishOperation(); }
    }, [fetch, toaster, needsReview, readingList, refreshAfterWrite, markNeedsReview, finishOperation]
  );
  const changeActive = useCallback(
    (record: RssRecord) => async (active: 'on' | 'off') => {
      if (busyRef.current || reviewRequired.current || readingList || needsReview) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await writeSettings(fetch, `/autopost/${record.id}/active`, { method: 'POST', body: JSON.stringify({ active: active === 'on' }) });
        if (!alive.current) return;
        setOperationError('');
        refreshAfterWrite();
      } catch (error) { if (!alive.current) return; setOperationError(settingsWriteMessage(error)); markNeedsReview(settingsWriteUncertain(error)); }
      finally { finishOperation(); }
    }, [fetch, needsReview, readingList, refreshAfterWrite, markNeedsReview, finishOperation]
  );
  return (
    <div data-toybaco-settings-section="autopost" className="flex flex-col">
      <h3 className="text-[20px]">RSSから下書きを作成</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'autopost_can_automatically_posts_your_rss_new_items_to_social_media',
          'Autopost can automatically posts your RSS new items to social media'
        )}
      </div>
      {(error || operationError) && <div role="alert" data-toybaco-settings-notice=""><p>{operationError || (data ? '最新のRSS設定を確認できませんでした。前回の一覧を表示しています。' : 'RSS設定の一覧を確認できませんでした。')}</p><Button type="button" secondary disabled={isValidating || readingList} onClick={retryList}>一覧を再確認</Button></div>}
      {isLoading && !data && <p role="status">RSS設定の一覧を確認しています。</p>}
      {!error && data?.length === 0 && <p>保存済みのRSS設定はありません。</p>}
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div data-toybaco-settings-records="" role="list">
              {data.map((p: any) => (
                <div data-toybaco-settings-record="" role="listitem" key={p.id}>
                  <div data-toybaco-settings-record-content=""><strong>{p.title}</strong><p>{p.url}</p></div>
                  <div data-toybaco-settings-record-actions="">
                    <Button secondary data-toybaco-settings-action="edit" disabled={busy || readingList || needsReview || !!error} onClick={addWebhook(p)}>{t('edit', 'Edit')}</Button>
                    <Button secondary data-toybaco-settings-action="delete" disabled={busy || readingList || needsReview || !!error} onClick={deleteHook(p)}>{t('delete', 'Delete')}</Button>
                    <div data-toybaco-settings-active=""><span>下書き作成</span><Slider disabled={busy || readingList || needsReview || !!error} value={p.active ? 'on' : 'off'} onChange={changeActive(p)} fill={true} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button data-toybaco-settings-action="add" disabled={!data || busy || readingList || needsReview || !!error}
              onClick={addWebhook()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              RSSを追加
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
const details = object().shape({
  title: string().required(),
  content: string(),
  onSlot: boolean().required(),
  syncLast: boolean().required(),
  url: string().url().required(),
  active: boolean().required(),
  addPicture: boolean().required(),
  generateContent: boolean().required(),
  integrations: array().of(
    object().shape({
      id: string().required(),
    })
  ),
});
const getOptions = (t: (key: string, fallback: string) => string) => [
  {
    label: t('all_integrations', 'All integrations'),
    value: 'all',
  },
  {
    label: t('specific_integrations', 'Specific integrations'),
    value: 'specific',
  },
];
const getOptionsChoose = (t: (key: string, fallback: string) => string) => [
  {
    label: t('yes', 'Yes'),
    value: true,
  },
  {
    label: t('no', 'No'),
    value: false,
  },
];
const getPostImmediately = (t: (key: string, fallback: string) => string) => [
  {
    label: t('post_on_next_available_slot', 'Post on the next available slot'),
    value: true,
  },
  {
    label: t('post_immediately', 'Post Immediately'),
    value: false,
  },
];
export const AddOrEditWebhook: FC<{
  data?: any;
  reload: () => Promise<RssRecord[]>;
  onSaved: () => void;
}> = (props) => {
  const { data, reload, onSaved } = props;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pending = useRef(false);
  const finishSave = useCallback(() => { pending.current = false; }, []);
  const previewPending = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [savedRecords, setSavedRecords] = useState<RssRecord[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const finishPreview = useCallback(() => { previewPending.current = false; if (alive.current) setPreviewing(false); }, []);
  const fetch = useFetch();
  const t = useT();
  const options = getOptions(t);
  const optionsChoose = getOptionsChoose(t);
  const postImmediately = getPostImmediately(t);
  const [allIntegrations, setAllIntegrations] = useState(
    (JSON.parse(data?.integrations || '[]')?.length || 0) > 0
      ? options[1]
      : options[0]
  );
  const modal = useModals();
  const toast = useToaster();
  const [valid, setValid] = useState(data?.url || '');
  const { available: aiAvailable, checking: aiChecking, error: aiError, retry: retryAi } = usePostingTextCapability();
  const [lastUrl, setLastUrl] = useState(data?.lastUrl || '');
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      title: data?.title || '',
      content: data?.content || '',
      onSlot: data?.onSlot || false,
      syncLast: data?.syncLast || false,
      url: data?.url || '',
      // eslint-disable-next-line no-prototype-builtins
      active: data?.hasOwnProperty?.('active') ? data?.active : true,
      addPicture: data?.addPicture || false,
      // eslint-disable-next-line no-prototype-builtins
      generateContent: data?.hasOwnProperty?.('generateContent')
        ? data?.generateContent
        : false,
      integrations: JSON.parse(data?.integrations || '[]') || [],
    },
  });
  const generateContent = form.watch('generateContent');
  const content = form.watch('content');
  const url = form.watch('url');
  const syncLast = form.watch('syncLast');
  const integrations = form.watch('integrations');
  const integration = useCallback(() => readSettings(fetch, '/integrations/list', (value): value is { integrations: any[] } => {
    const result = value as { integrations?: unknown } | null;
    return !!result && Array.isArray(result.integrations) && result.integrations.every(item => item && typeof item.id === 'string');
  }), [fetch]);
  const changeIntegration = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const findValue = options.find(
        (option) => option.value === e.target.value
      )!;
      setAllIntegrations(findValue);
      if (findValue.value === 'all') {
        form.setValue('integrations', []);
      }
    },
    [form, options]
  );
  const { data: dataList, isLoading, error: integrationError, mutate: retryIntegrations } = useSWR('integrations', integration, {
    shouldRetryOnError: false, errorRetryCount: 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const callBack = useCallback(
    async (values: any) => {
      if (pending.current || uncertain || previewPending.current) return;
      if (values.generateContent && !aiAvailable) {
        toast.show('AIを利用できません。AIを使わない設定を選ぶか、保存せず閉じてください。', 'warning');
        return;
      }
      pending.current = true;
      setSaveError('');
      try {
      await writeSettings(fetch, data?.id ? `/autopost/${data?.id}` : '/autopost', {
        method: data?.id ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...(data?.id
            ? {
                id: data.id,
              }
            : {}),
          ...values,
          ...(!syncLast
            ? {
                lastUrl,
              }
            : {
                lastUrl: '',
              }),
        }),
      });
      } catch (error) {
        if (!alive.current) return;
        setSaveError(settingsWriteMessage(error)); setUncertain(settingsWriteUncertain(error)); setSavedRecords(null);
        return;
      } finally { finishSave(); }
      if (!alive.current) return;
      toast.show(data?.id ? 'RSS設定を更新しました' : 'RSS設定を追加しました', 'success');
      modal.closeCurrent();
      onSaved();
    },
    [data, lastUrl, syncLast, aiAvailable, toast, fetch, modal, onSaved, uncertain, finishSave]
  );
  const sendTest = useCallback(async () => {
    if (previewPending.current || pending.current) return;
    previewPending.current = true;
    setPreviewing(true);
    setPreviewError('');
    const requestedUrl = form.getValues('url');
    try {
      const result = await readSettings(fetch, `/autopost/send?url=${encodeURIComponent(requestedUrl)}`, (value): value is { success: boolean; url?: string } => {
        const result = value as { success?: unknown; url?: unknown } | null;
        return !!result && typeof result.success === 'boolean' && (!result.success || typeof result.url === 'string');
      }, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!alive.current || form.getValues('url') !== requestedUrl) return;
      if (!result.success) { setValid(''); setPreviewError('RSSフィードを確認できませんでした。URLを確認して、もう一度お試しください。'); return; }
      setValid(requestedUrl);
      setLastUrl(result.url!);
      toast.show('RSSフィードを確認しました', 'success');
    } catch {
      if (alive.current && form.getValues('url') === requestedUrl) { setValid(''); setPreviewError('RSSフィードの取得結果を確認できませんでした。URLを確認して、もう一度お試しください。'); }
    } finally { finishPreview(); }
  }, [fetch, form, toast, finishPreview]);
  const checkSaved = async () => {
    if (checking) return;
    setChecking(true);
    try { const records = await reload(); if (alive.current) setSavedRecords(records); }
    catch { if (alive.current) setSaveError('保存済みの一覧を確認できませんでした。入力を残しています。時間をおいて再確認してください。'); }
    finally { if (alive.current) setChecking(false); }
  };

  return (
    <FormProvider {...form}>
      <form data-toybaco-settings-form="rss" onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px] border border-customColor6 pt-0">
          <div>
            <p data-toybaco-settings-notice="">RSSの新着記事から下書きを作成します。自動では公開しません。内容を確認し、投稿カレンダーから公開してください。</p>
            <Input
              label="設定名"
              aria-label="設定名"
              translationKey="toybaco_rss_label_title"
              disabled={form.formState.isSubmitting}
              removeError={!form.formState.errors.title}
              {...form.register('title')}
            />
            <Input
              label="RSSフィードのURL"
              aria-label="RSSフィードのURL"
              translationKey="toybaco_rss_label_url"
              disabled={form.formState.isSubmitting || previewing}
              removeError={!form.formState.errors.url}
              {...form.register('url')}
            />
            <Select
              label="現在の最新記事も取り込む"
              disabled={form.formState.isSubmitting}
              aria-label="現在の最新記事も取り込む"
              translationKey="toybaco_rss_label_should_sync_last_post"
              hideErrors={!form.formState.errors.syncLast}
              {...form.register('syncLast', {
                setValueAs: (value) => {
                  return value === 'true' || value === true;
                },
              })}
            >
              {optionsChoose.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              label="AIで下書き本文を作成"
              disabled={form.formState.isSubmitting}
              aria-label="AIで下書き本文を作成"
              translationKey="toybaco_rss_label_autogenerate_content"
              hideErrors={!form.formState.errors.generateContent}
              {...form.register('generateContent', {
                setValueAs: (value) => value === 'true' || value === true,
              })}
            >
              {optionsChoose.map((option) => (
                <option key={String(option.value)} value={String(option.value)} disabled={option.value === true && !aiAvailable}>
                  {option.label}
                </option>
              ))}
            </Select>
            {!aiAvailable && <div data-toybaco-settings-notice=""><p role="status">{aiChecking ? 'AIの利用状態を確認しています。' : aiError ? 'AIの利用状態を確認できません。AIを使わない下書きは作成できます。' : '現在AIを利用できません。AIを使わない下書きは作成できます。'} 既存のAI設定を変更せず残す場合は、保存せず閉じてください。</p>{aiError && <Button type="button" secondary disabled={aiChecking} onClick={retryAi}>再確認</Button>}</div>}
            {!generateContent && (
              <>
                <div className={`text-[14px] mb-[6px]`}>
                  {t('post_content', 'Post content')}
                </div>
                <ToybacoAssistedTextarea
                  disableBranding={true}
                  aria-label="下書き本文"
                  className={clsx(
                    '!min-h-40 !max-h-80 p-2 overflow-x-hidden scrollbar scrollbar-thumb-[#612AD5] bg-customColor2 outline-none mb-[16px] border-fifth border rounded-[4px]'
                  )}
                  value={content}
                  disabled={form.formState.isSubmitting}
                  onChange={(e) => {
                    form.setValue('content', e.target.value);
                  }}
                  placeholder={t('write_your_post_placeholder', 'Write your post...')}
                  autosuggestionsConfig={{
                    textareaPurpose: `Assist me in writing social media post`,
                    chatApiConfigs: {},
                  }}
                />
              </>
            )}

            <Select
              value={allIntegrations.value}
              name="integrations"
              hideErrors={true}
              label="下書きの作成先"
              disabled={form.formState.isSubmitting}
              aria-label="下書きの作成先"
              translationKey="toybaco_rss_label_integrations"
              disableForm={true}
              onChange={changeIntegration}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {allIntegrations.value === 'specific' && dataList && !isLoading && (
              <PickPlatforms
                integrations={dataList.integrations}
                selectedIntegrations={integrations as any[]}
                onChange={(e) => { if (!pending.current) form.setValue('integrations', e); }}
                singleSelect={false}
                toolTip={true}
                isMain={true}
              />
            )}
            {integrationError && allIntegrations.value === 'specific' && <div role="alert" data-toybaco-settings-notice=""><p>投稿先を確認できませんでした。選択内容は残しています。</p><Button type="button" secondary disabled={isLoading} onClick={() => { void retryIntegrations().catch(() => {}); }}>投稿先を再確認</Button></div>}
            {previewError && <p role="alert" data-toybaco-settings-notice="">{previewError}</p>}
            {saveError && <div role="alert" data-toybaco-settings-notice=""><p>{saveError} 入力内容は残しています。</p>
              {uncertain && <Button type="button" secondary disabled={checking} onClick={checkSaved}>保存済みの一覧を確認</Button>}
              {savedRecords && <div><p>保存済みのRSS設定を確認してください。同じ内容がある場合は再度保存しないでください。</p>
                <ul style={{ maxHeight: 200, overflowY: 'auto', overflowWrap: 'anywhere', minWidth: 0 }}>{savedRecords.map(record => <li key={record.id}>{record.title} — {record.url}</li>)}</ul>
                {!savedRecords.length && <p>保存済みのRSS設定はありません。</p>}
                <Button type="button" secondary onClick={() => { setUncertain(false); setSavedRecords(null); setSaveError('一覧を確認しました。未保存の場合だけ、もう一度保存してください。'); }}>一覧を確認しました</Button>
              </div>}
            </div>}
            <p data-toybaco-settings-notice="">「RSSを確認」はフィードの取得確認だけを行います。下書きの保存やSNSへの送信は行いません。</p>
            <div data-toybaco-settings-form-actions="" className="flex gap-[10px]">
              <Button type="button" secondary disabled={form.formState.isSubmitting} onClick={() => modal.closeCurrent()}>キャンセル</Button>
              {valid === url && (syncLast || !!lastUrl) && (
                <Button
                  type="submit"
                  className="mt-[24px]"
                  disabled={
                    uncertain || previewing || (allIntegrations.value === 'specific' && (!!integrationError || isLoading)) ||
                    (generateContent && !aiAvailable) || form.formState.isSubmitting ||
                    valid !== url ||
                    !form.formState.isValid ||
                    (allIntegrations.value === 'specific' &&
                      !integrations?.length)
                  }
                >
                  {data?.id ? '設定を保存' : '保存して下書き作成を開始'}
                </Button>
              )}
              <Button
                type="button"
                className="mt-[24px]"
                onClick={sendTest}
                disabled={
                  previewing || form.formState.isSubmitting || !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                RSSを確認
              </Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};
