'use client';

import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
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
export const Autopost: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const modal = useModals();
  const toaster = useToaster();
  const list = useCallback(async () => {
    return (await fetch('/autopost')).json();
  }, []);
  const { data, mutate } = useSWR('autopost', list);
  const addWebhook = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data ? 'RSSの下書き設定を編集' : 'RSSから下書きを作成',
        withCloseButton: true,
        toybacoSettingsDialog: true,
        children: <AddOrEditWebhook data={data} reload={mutate} />,
      });
    },
    [modal, mutate]
  );
  const deleteHook = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete',
            `Are you sure you want to delete ${data.name}?`,
            { name: data.name }
          )
        )
      ) {
        await fetch(`/autopost/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(t('webhook_deleted_successfully', 'Webhook deleted successfully'), 'success');
      }
    },
    []
  );
  const changeActive = useCallback(
    (data: any) => async (ac: 'on' | 'off') => {
      await fetch(`/autopost/${data.id}/active`, {
        body: JSON.stringify({
          active: ac === 'on',
        }),
        method: 'POST',
      });
      mutate();
    },
    [mutate]
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
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div data-toybaco-settings-records="" role="list">
              {data.map((p: any) => (
                <div data-toybaco-settings-record="" role="listitem" key={p.id}>
                  <div data-toybaco-settings-record-content=""><strong>{p.title}</strong><p>{p.url}</p></div>
                  <div data-toybaco-settings-record-actions="">
                    <Button secondary data-toybaco-settings-action="edit" onClick={addWebhook(p)}>{t('edit', 'Edit')}</Button>
                    <Button secondary data-toybaco-settings-action="delete" onClick={deleteHook(p)}>{t('delete', 'Delete')}</Button>
                    <div data-toybaco-settings-active=""><span>下書き作成</span><Slider value={p.active ? 'on' : 'off'} onChange={changeActive(p)} fill={true} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button data-toybaco-settings-action="add"
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
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
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
  const integration = useCallback(async () => {
    return (await fetch('/integrations/list')).json();
  }, []);
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
    []
  );
  const { data: dataList, isLoading } = useSWR('integrations', integration, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const callBack = useCallback(
    async (values: any) => {
      if (values.generateContent && !aiAvailable) {
        toast.show('AIを利用できません。AIを使わない設定を選ぶか、保存せず閉じてください。', 'warning');
        return;
      }
      await fetch(data?.id ? `/autopost/${data?.id}` : '/autopost', {
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
      toast.show(
        data?.id
          ? t('autopost_updated_successfully', 'Autopost updated successfully')
          : t('autopost_added_successfully', 'Autopost added successfully'),
        'success'
      );
      modal.closeAll();
      reload();
    },
    [data, lastUrl, syncLast, aiAvailable, toast, fetch, modal, reload, t]
  );
  const sendTest = useCallback(async () => {
    const url = form.getValues('url');
    try {
      const { success, url: newUrl } = await (
        await fetch(`/autopost/send?url=${encodeURIComponent(url)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      ).json();
      if (!success) {
        setValid('');
        toast.show(t('could_not_use_rss_feed', 'Could not use this RSS feed'), 'warning');
        return;
      }
      toast.show(t('rss_valid', 'RSS valid!'), 'success');
      setValid(url);
      setLastUrl(newUrl);
    } catch (e: any) {
      /** empty **/
    }
  }, []);

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
              removeError={!form.formState.errors.title}
              {...form.register('title')}
            />
            <Input
              label="RSSフィードのURL"
              aria-label="RSSフィードのURL"
              translationKey="toybaco_rss_label_url"
              removeError={!form.formState.errors.url}
              {...form.register('url')}
            />
            <Select
              label="現在の最新記事も取り込む"
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
                onChange={(e) => form.setValue('integrations', e)}
                singleSelect={false}
                toolTip={true}
                isMain={true}
              />
            )}
            <p data-toybaco-settings-notice="">「RSSを確認」はフィードの取得確認だけを行います。下書きの保存やSNSへの送信は行いません。</p>
            <div data-toybaco-settings-form-actions="" className="flex gap-[10px]">
              <Button type="button" secondary onClick={() => modal.closeCurrent()}>キャンセル</Button>
              {valid === url && (syncLast || !!lastUrl) && (
                <Button
                  type="submit"
                  className="mt-[24px]"
                  disabled={
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
                  !form.formState.isValid ||
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
