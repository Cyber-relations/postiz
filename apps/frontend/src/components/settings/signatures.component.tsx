import React, { FC, Fragment, useCallback, useRef, useState, useEffect } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import clsx from 'clsx';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import { array, boolean, object, string } from 'yup';
import { FormProvider, useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { ToybacoAssistedTextarea } from '@gitroom/frontend/components/settings/toybaco-settings-controls';
import { Select } from '@gitroom/react/form/select';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { readSettings, writeSettings, settingsWriteMessage, settingsWriteUncertain } from '@gitroom/frontend/components/settings/toybaco-settings-request';

type SignatureRecord = { id: string; content: string; autoAdd: boolean };
const isSignatures = (value: unknown): value is SignatureRecord[] => Array.isArray(value) && value.every(item =>
  item && typeof item.id === 'string' && typeof item.content === 'string' && typeof item.autoAdd === 'boolean');
export const SignaturesComponent: FC<{
  appendSignature?: (value: string) => void;
}> = (props) => {
  const { appendSignature } = props;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const load = useCallback(() => readSettings(fetch, '/signatures', isSignatures), [fetch]);
  const { data, error, isLoading, isValidating, mutate } = useSWR('signatures', load, {
    revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false, errorRetryCount: 0,
  });
  const [operationError, setOperationError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const finishDelete = useCallback(() => { deletingRef.current = false; if (alive.current) setDeleting(false); }, []);
  const [needsReview, setNeedsReview] = useState(false);
  const reviewRequired = useRef(false);
  const markNeedsReview = useCallback((required: boolean) => { reviewRequired.current = required; setNeedsReview(required); }, []);
  const [readingList, setReadingList] = useState(false);
  const refreshList = useCallback(async () => {
    markNeedsReview(true);
    setReadingList(true);
    try {
      // mutate() alone may return stale cached rows after a failed revalidation.
      const records = await load();
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
  }, [load, mutate, markNeedsReview]);
  const retryList = () => { void refreshList().then(() => { if (alive.current) setOperationError(''); }).catch(() => { if (alive.current) setOperationError('最新の一覧を確認できませんでした。前回の表示を残しています。もう一度お試しください。'); }); };
  const refreshAfterWrite = useCallback(() => {
    if (!alive.current) return;
    markNeedsReview(true);
    void refreshList().catch(() => { if (alive.current) setOperationError('変更は保存されましたが、最新の一覧を確認できませんでした。前回の表示を残しています。一覧を再確認してください。'); });
  }, [refreshList, markNeedsReview]);
  const addSignature = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data ? '署名を編集' : '署名を追加',
        withCloseButton: true,
        toybacoSettingsDialog: true,
        children: <AddOrRemoveSignature data={data} reload={refreshList} onSaved={refreshAfterWrite} />,
      });
    },
    [modal, refreshList, refreshAfterWrite]
  );

  const deleteSignature = useCallback(
    (data: any) => async () => {
      if (deletingRef.current || reviewRequired.current || readingList || needsReview) return;
      deletingRef.current = true;
      setDeleting(true);
      try {
        if (!await deleteDialog(`署名「${data.content.slice(0, 15)}…」を削除してもよろしいですか？`)) return;
        await writeSettings(fetch, `/signatures/${data.id}`, { method: 'DELETE' });
        if (!alive.current) return;
        setOperationError('');
        toaster.show('署名を削除しました', 'success');
        refreshAfterWrite();
      } catch (error) { if (!alive.current) return; setOperationError(settingsWriteMessage(error, '削除')); markNeedsReview(settingsWriteUncertain(error)); }
      finally { finishDelete(); }
    },
    [fetch, toaster, needsReview, readingList, refreshAfterWrite, markNeedsReview, finishDelete]
  );

  const t = useT();

  return (
    <div data-toybaco-settings-section="signatures" className="flex flex-col">
      <h3 className="text-[20px]">{t('signatures', 'Signatures')}</h3>
      <div className="text-customColor18 mt-[4px]">
        {t(
          'you_can_add_signatures_to_your_account_to_be_used_in_your_posts',
          'You can add signatures to your account to be used in your posts.'
        )}
      </div>
      {(error || operationError) && <div role="alert" data-toybaco-settings-notice=""><p>{operationError || (data ? '最新の署名一覧を確認できませんでした。前回の一覧を表示しています。' : '署名一覧を確認できませんでした。')}</p><Button type="button" secondary disabled={isValidating || readingList} onClick={retryList}>一覧を再確認</Button></div>}
      {isLoading && !data && <p role="status">署名一覧を確認しています。</p>}
      {!error && data?.length === 0 && <p>保存済みの署名はありません。</p>}
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div data-toybaco-settings-records="" role="list">
              {data.map((p: any) => (
                <div data-toybaco-settings-record="" role="listitem" key={p.id}>
                  <div data-toybaco-settings-record-content=""><p title={p.content}>{p.content}</p><span>自動追加: {p.autoAdd ? t('yes', 'はい') : t('no', 'いいえ')}</span></div>
                  <div data-toybaco-settings-record-actions="">
                    {!!appendSignature && <Button onClick={() => appendSignature(p.content)}>{t('use_signature', 'Use Signature')}</Button>}
                    <Button secondary data-toybaco-settings-action="edit" disabled={deleting || readingList || needsReview || !!error} onClick={addSignature(p)}>{t('edit', 'Edit')}</Button>
                    <Button secondary data-toybaco-settings-action="delete" disabled={deleting || readingList || needsReview || !!error} onClick={deleteSignature(p)}>{t('delete', 'Delete')}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button data-toybaco-settings-action="add" disabled={!data || deleting || readingList || needsReview || !!error}
              onClick={addSignature()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              {t('add_a_signature', 'Add a signature')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
const details = object().shape({
  content: string().required(),
  autoAdd: boolean().required(),
});
const AddOrRemoveSignature: FC<{
  data?: any;
  reload: () => Promise<SignatureRecord[]>;
  onSaved: () => void;
}> = (props) => {
  const { data, reload, onSaved } = props;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pending = useRef(false);
  const finishSave = useCallback(() => { pending.current = false; }, []);
  const [saveError, setSaveError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [savedRecords, setSavedRecords] = useState<SignatureRecord[] | null>(null);
  const [checking, setChecking] = useState(false);
  const toast = useToaster();
  const fetch = useFetch();
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      content: data?.content || '',
      autoAdd: data?.autoAdd || false,
    },
  });
  const text = form.watch('content');
  const contentId = React.useId();
  const autoAdd = form.watch('autoAdd');
  const modal = useModals();
  const callBack = useCallback(
    async (values: any) => {
      if (pending.current || uncertain) return;
      pending.current = true;
      setSaveError('');
      try {
        await writeSettings(fetch, data?.id ? `/signatures/${data.id}` : '/signatures', {
          method: data?.id ? 'PUT' : 'POST', body: JSON.stringify(values),
        });
      } catch (error) {
        if (!alive.current) return;
        setSaveError(settingsWriteMessage(error)); setUncertain(settingsWriteUncertain(error)); setSavedRecords(null);
        return;
      } finally { finishSave(); }
      if (!alive.current) return;
      toast.show(data?.id ? '署名を更新しました' : '署名を追加しました', 'success');
      modal.closeCurrent();
      onSaved();
    },
    [data, fetch, modal, onSaved, toast, uncertain, finishSave]
  );

  const checkSaved = async () => {
    if (checking) return;
    setChecking(true);
    try { const records = await reload(); if (alive.current) setSavedRecords(records); }
    catch { if (alive.current) setSaveError('保存済みの一覧を確認できませんでした。入力を残しています。時間をおいて再確認してください。'); }
    finally { if (alive.current) setChecking(false); }
  };

  const t = useT();

  return (
    <FormProvider {...form}>
      <form data-toybaco-settings-form="signature" onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px] pt-0">
          <p data-toybaco-settings-notice="">投稿の末尾に添える定型文を保存できます。例：店舗名・営業時間・お問い合わせ先。</p>
          <div data-toybaco-settings-field=""><label htmlFor={contentId}>署名の本文</label>
          <div className="relative bg-customColor2">
            <ToybacoAssistedTextarea
              disableBranding={true}
              id={contentId}
              aria-label="署名の本文"
              className={clsx(
                '!min-h-40 !max-h-80 p-2 overflow-x-hidden scrollbar scrollbar-thumb-[#612AD5] bg-bigStrip outline-none'
              )}
              value={text}
              disabled={form.formState.isSubmitting}
              onChange={(e) => {
                form.setValue('content', e.target.value, { shouldValidate: true });
              }}
              placeholder="署名を入力してください..."
              autosuggestionsConfig={{
                textareaPurpose: `Assist me in writing social media signature`,
                chatApiConfigs: {},
              }}
            />
          </div></div>

          <Select
            label="署名を自動追加しますか？"
            disabled={form.formState.isSubmitting}
            aria-label="署名を自動追加しますか？"
            translationKey="label_auto_add_signature"
            hideErrors={!form.formState.errors.autoAdd}
            {...form.register('autoAdd', {
              setValueAs: (value) => value === 'true',
            })}
          >
            <option value="false">
              {t('no', 'No')}
            </option>
            <option value="true">
              {t('yes', 'Yes')}
            </option>
          </Select>

          <p data-toybaco-settings-notice="">「はい」にすると、投稿を作成する際にこの署名を自動で追加します。</p>
          {saveError && <div role="alert" data-toybaco-settings-notice=""><p>{saveError} 入力内容は残しています。</p>
            {uncertain && <Button type="button" secondary disabled={checking} onClick={checkSaved}>保存済みの一覧を確認</Button>}
            {savedRecords && <div><p>保存済みの署名を確認してください。同じ内容がある場合は再度保存しないでください。</p>
              <ul style={{ maxHeight: 200, overflowY: 'auto', overflowWrap: 'anywhere', minWidth: 0 }}>{savedRecords.map(record => <li key={record.id}>{record.content}</li>)}</ul>
              {!savedRecords.length && <p>保存済みの署名はありません。</p>}
              <Button type="button" secondary onClick={() => { setUncertain(false); setSavedRecords(null); setSaveError('一覧を確認しました。未保存の場合だけ、もう一度保存してください。'); }}>一覧を確認しました</Button>
            </div>}
          </div>}
          <div data-toybaco-settings-form-actions="">
            <Button type="button" secondary disabled={form.formState.isSubmitting} onClick={() => modal.closeCurrent()}>キャンセル</Button>
            <Button type="submit" disabled={!text?.trim() || form.formState.isSubmitting || uncertain}>署名を保存</Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};
