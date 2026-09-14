'use client';
import 'reflect-metadata';

import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';

const SaveSetModal: FC<{
  postData: any;
  initialValue?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}> = ({ postData, onSave, onCancel, initialValue }) => {
  const [name, setName] = useState(initialValue);
  const t = useT();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
    <form data-toybaco-settings-form="template" onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Input
          label="テンプレート名"
          aria-label="テンプレート名"
          translationKey="label_set_name"
          name="setName"
          removeError={true}
          value={name}
          disableForm={true}
          onChange={(e) => setName(e.target.value)}
          placeholder="テンプレート名を入力してください"
          autoFocus
        />
      </div>
      <div data-toybaco-settings-form-actions="" className="flex gap-2 justify-end">
        <Button type="button" secondary onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          {t('save', 'Save')}
        </Button>
      </div>
    </form>
  );
};

export const Sets: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();

  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('TOYBACO_CHANNELS_UNAVAILABLE');
    const value = await response.json();
    if (!Array.isArray(value?.integrations)) throw new Error('TOYBACO_CHANNELS_UNAVAILABLE');
    return value.integrations;
  }, [fetch]);

  const { isLoading, error: integrationError, data: integrations = [], mutate: reloadIntegrations } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
    shouldRetryOnError: false,
    errorRetryCount: 0,
  });

  const refreshChannels = useCallback(() => { void reloadIntegrations().catch(() => {}); }, [reloadIntegrations]);
  const addProvider = useAddProvider(refreshChannels);
  const canOpenTemplate = !isLoading && !integrationError && integrations.length > 0;

  const list = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, []);

  const { data, mutate } = useSWR('sets', list, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  const addSet = useCallback(
    (params?: { id?: string; name?: string; content?: string }) => () => {
      if (!canOpenTemplate) return;
      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <AddEditModal
            allIntegrations={integrations.map((p: any) => ({
              ...p,
            }))}
            {...(params?.id ? { set: JSON.parse(params.content) } : {})}
            addEditSets={(data) => {
              modal.openModal({
                title: 'テンプレートとして保存',
                toybacoSettingsDialog: true,
                children: (
                  <SaveSetModal
                    initialValue={params?.name || ''}
                    postData={data}
                    onSave={async (name: string) => {
                      try {
                        await fetch('/sets', {
                          method: 'POST',
                          body: JSON.stringify({
                            ...(params?.id ? { id: params.id } : {}),
                            name,
                            content: JSON.stringify(data),
                          }),
                        });
                        modal.closeAll();
                        mutate();
                        toaster.show('テンプレートを保存しました', 'success');
                      } catch (error) {
                        toaster.show('テンプレートを保存できませんでした', 'warning');
                      }
                    }}
                    onCancel={() => modal.closeAll()}
                  />
                ),
              });
            }}
            reopenModal={() => {}}
            mutate={() => {}}
            integrations={integrations}
            date={newDayjs()}
          />
        ),
        title: ``,
      });
    },
    [fetch, integrations, modal, mutate, toaster, canOpenTemplate]
  );

  const deleteSet = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(`テンプレート「${data.name}」を削除してもよろしいですか？`)
      ) {
        await fetch(`/sets/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show('テンプレートを削除しました', 'success');
      }
    },
    [fetch, mutate, toaster]
  );

  const t = useT();

  return (
    <div data-toybaco-settings-section="sets" className="flex flex-col">
      <h3 className="text-[20px]">投稿テンプレート（{data?.length || 0}）</h3>
      <div className="text-customColor18 mt-[4px]">
        投稿内容をテンプレートとして保存し、繰り返し利用できます。
      </div>
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div data-toybaco-settings-records="" role="list">
              {data.map((p: any) => (
                <div data-toybaco-settings-record="" role="listitem" key={p.id}>
                  <div data-toybaco-settings-record-content=""><strong>{p.name}</strong></div>
                  <div data-toybaco-settings-record-actions="">
                    <Button secondary data-toybaco-settings-action="edit" disabled={!canOpenTemplate} onClick={addSet(p)}>{t('edit', 'Edit')}</Button>
                    <Button secondary data-toybaco-settings-action="delete" onClick={deleteSet(p)}>{t('delete', 'Delete')}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            {!canOpenTemplate && <div data-toybaco-settings-notice="">
              <p role="status">{isLoading ? '投稿先の連携を確認しています。' : integrationError
                ? '投稿先を確認できませんでした。連携状態を再確認してください。'
                : 'テンプレートを作成するには、先に投稿先のチャンネルを連携してください。'}</p>
              {integrationError && !isLoading && <Button type="button" secondary onClick={refreshChannels}>連携状態を再確認</Button>}
              {!isLoading && !integrationError && <Button type="button" secondary onClick={addProvider}>チャンネルを追加</Button>}
            </div>}
            <Button data-toybaco-settings-action="add" disabled={!canOpenTemplate}
              onClick={addSet()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              テンプレートを追加
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
