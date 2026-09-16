'use client';
import 'reflect-metadata';

import React, { FC, Fragment, useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
import { readSettings, writeSettings, settingsWriteMessage, settingsWriteUncertain } from '@gitroom/frontend/components/settings/toybaco-settings-request';

type SetRecord = { id: string; name: string; content: string };
const isSets = (value: unknown): value is SetRecord[] => Array.isArray(value) && value.every(item =>
  item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.content === 'string');

const SaveSetModal: FC<{
  postData: any;
  initialValue?: string;
  onSave: (name: string) => Promise<void>;
  onSaved: () => void;
  readSaved: () => Promise<SetRecord[]>;
}> = ({ postData, onSave, onSaved, initialValue, readSaved }) => {
  const [name, setName] = useState(initialValue || '');
  const modal = useModals();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const finishSave = () => { pending.current = false; if (alive.current) setSaving(false); };
  const [saveError, setSaveError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [savedRecords, setSavedRecords] = useState<SetRecord[] | null>(null);
  const [checking, setChecking] = useState(false);
  const t = useT();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || pending.current || uncertain) return;
    pending.current = true;
    setSaving(true);
    setSaveError('');
    try { await onSave(name.trim()); if (alive.current) onSaved(); }
    catch (error) { if (!alive.current) return; setSaveError(settingsWriteMessage(error)); setUncertain(settingsWriteUncertain(error)); setSavedRecords(null); }
    finally { finishSave(); }
  };
  const checkSaved = async () => {
    if (checking) return;
    setChecking(true);
    try { const records = await readSaved(); if (alive.current) setSavedRecords(records); }
    catch { if (alive.current) setSaveError('保存済みの一覧を確認できませんでした。入力を残しています。時間をおいて再確認してください。'); }
    finally { if (alive.current) setChecking(false); }
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
          disabled={saving}
          disableForm={true}
          onChange={(e) => setName(e.target.value)}
          placeholder="テンプレート名を入力してください"
          autoFocus
        />
      </div>
      {saveError && <div role="alert" data-toybaco-settings-notice=""><p>{saveError} 入力内容は残しています。</p>
        {uncertain && <Button type="button" secondary disabled={checking} onClick={checkSaved}>保存済みの一覧を確認</Button>}
        {savedRecords && <div><p>保存済みのテンプレートを確認してください。同じ内容がある場合は再度保存しないでください。</p>
          <ul style={{ maxHeight: 200, overflowY: 'auto', overflowWrap: 'anywhere', minWidth: 0 }}>{savedRecords.map(record => <li key={record.id}>{record.name}</li>)}</ul>
          {!savedRecords.length && <p>保存済みのテンプレートはありません。</p>}
          <Button type="button" secondary onClick={() => { setUncertain(false); setSavedRecords(null); setSaveError('一覧を確認しました。未保存の場合だけ、もう一度保存してください。'); }}>一覧を確認しました</Button>
        </div>}
      </div>}
      <div data-toybaco-settings-form-actions="" className="flex gap-2 justify-end">
        <Button type="button" secondary disabled={saving} onClick={() => modal.closeCurrent()}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!name.trim() || saving || uncertain}>
          {t('save', 'Save')}
        </Button>
      </div>
    </form>
  );
};

export const Sets: FC = () => {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();

  const load = useCallback(async (path: string) => {
    const value = await readSettings(fetch, path, (value): value is { integrations: any[] } => {
      const result = value as { integrations?: unknown } | null;
      return !!result && Array.isArray(result.integrations) && result.integrations.every(item => item && typeof item.id === 'string');
    });
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

  const list = useCallback(() => readSettings(fetch, '/sets', isSets), [fetch]);
  const [operationError, setOperationError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const finishDelete = useCallback(() => { deletingRef.current = false; if (alive.current) setDeleting(false); }, []);
  const [needsReview, setNeedsReview] = useState(false);
  const reviewRequired = useRef(false);
  const markNeedsReview = useCallback((required: boolean) => { reviewRequired.current = required; setNeedsReview(required); }, []);
  const { data, error: listError, isLoading: listLoading, isValidating, mutate } = useSWR('sets', list, {
    shouldRetryOnError: false, errorRetryCount: 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

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

  const addSet = useCallback(
    (params?: { id?: string; name?: string; content?: string }) => () => {
      if (!canOpenTemplate || !data || listError || deleting || readingList || reviewRequired.current || needsReview) return;
      let savedContent: object | undefined;
      if (params?.id) {
        try {
          savedContent = JSON.parse(params.content || '');
          if (!savedContent || typeof savedContent !== 'object') throw new Error('SET_CONTENT_INVALID');
        } catch { setOperationError('このテンプレートの内容を読み取れませんでした。一覧を再確認するか、管理者にご確認ください。'); return; }
      }
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
            {...(params?.id ? { set: savedContent } : {})}
            addEditSets={(data) => {
              modal.openModal({
                title: 'テンプレートとして保存',
                toybacoSettingsDialog: true,
                id: `toybaco-template-name-${params?.id || 'new'}`,
                toybacoReturnFocus: document.activeElement as HTMLElement,
                children: (
                  <SaveSetModal
                    initialValue={params?.name || ''}
                    postData={data}
                    readSaved={refreshList}
                    onSave={async (name: string) => {
                      await writeSettings(fetch, '/sets', {
                        method: 'POST',
                        body: JSON.stringify({
                          ...(params?.id ? { id: params.id } : {}), name, content: JSON.stringify(data),
                        }),
                      });
                    }}
                    onSaved={() => {
                      modal.closeAll();
                      toaster.show('テンプレートを保存しました', 'success');
                      refreshAfterWrite();
                    }}
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
    [fetch, integrations, modal, toaster, canOpenTemplate, data, listError, deleting, readingList, needsReview, refreshList, refreshAfterWrite]
  );

  const deleteSet = useCallback(
    (data: any) => async () => {
      if (deletingRef.current || reviewRequired.current || readingList || needsReview) return;
      deletingRef.current = true;
      setDeleting(true);
      try {
        if (!await deleteDialog(`テンプレート「${data.name}」を削除してもよろしいですか？`)) return;
        await writeSettings(fetch, `/sets/${data.id}`, { method: 'DELETE' });
        if (!alive.current) return;
        setOperationError('');
        toaster.show('テンプレートを削除しました', 'success');
        refreshAfterWrite();
      } catch (error) { if (!alive.current) return; setOperationError(settingsWriteMessage(error, '削除')); markNeedsReview(settingsWriteUncertain(error)); }
      finally { finishDelete(); }
    },
    [fetch, toaster, needsReview, readingList, refreshAfterWrite, markNeedsReview, finishDelete]
  );

  const t = useT();

  return (
    <div data-toybaco-settings-section="sets" className="flex flex-col">
      <h3 className="text-[20px]">投稿テンプレート（{data ? data.length : '—'}）</h3>
      <div className="text-customColor18 mt-[4px]">
        投稿内容をテンプレートとして保存し、繰り返し利用できます。
      </div>
      {(listError || operationError) && <div role="alert" data-toybaco-settings-notice=""><p>{operationError || (data ? '最新のテンプレート一覧を確認できませんでした。前回の一覧を表示しています。' : 'テンプレート一覧を確認できませんでした。')}</p><Button type="button" secondary disabled={isValidating || readingList} onClick={retryList}>一覧を再確認</Button></div>}
      {listLoading && !data && <p role="status">テンプレート一覧を確認しています。</p>}
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div data-toybaco-settings-records="" role="list">
              {data.map((p: any) => (
                <div data-toybaco-settings-record="" role="listitem" key={p.id}>
                  <div data-toybaco-settings-record-content=""><strong>{p.name}</strong></div>
                  <div data-toybaco-settings-record-actions="">
                    <Button secondary data-toybaco-settings-action="edit" disabled={!canOpenTemplate || !data || !!listError || deleting || readingList || needsReview} onClick={addSet(p)}>{t('edit', 'Edit')}</Button>
                    <Button secondary data-toybaco-settings-action="delete" disabled={deleting || readingList || needsReview || !!listError} onClick={deleteSet(p)}>{t('delete', 'Delete')}</Button>
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
            <Button data-toybaco-settings-action="add" disabled={!canOpenTemplate || !data || !!listError || deleting || readingList || needsReview}
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
