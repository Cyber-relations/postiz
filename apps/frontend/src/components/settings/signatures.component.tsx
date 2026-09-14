import React, { FC, Fragment, useCallback } from 'react';
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
export const SignaturesComponent: FC<{
  appendSignature?: (value: string) => void;
}> = (props) => {
  const { appendSignature } = props;
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const load = useCallback(async () => {
    return (await fetch('/signatures')).json();
  }, []);
  const { data, mutate } = useSWR('signatures', load);
  const addSignature = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data ? '署名を編集' : '署名を追加',
        withCloseButton: true,
        toybacoSettingsDialog: true,
        children: <AddOrRemoveSignature data={data} reload={mutate} />,
      });
    },
    [mutate]
  );

  const deleteSignature = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          `署名「${data.content.slice(0, 15)}…」を削除してもよろしいですか？`
        )
      ) {
        await fetch(`/signatures/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show('署名を削除しました', 'success');
      }
    },
    [fetch, mutate, toaster]
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
      <div data-toybaco-settings-card="" className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div data-toybaco-settings-records="" role="list">
              {data.map((p: any) => (
                <div data-toybaco-settings-record="" role="listitem" key={p.id}>
                  <div data-toybaco-settings-record-content=""><p title={p.content}>{p.content}</p><span>自動追加: {p.autoAdd ? t('yes', 'はい') : t('no', 'いいえ')}</span></div>
                  <div data-toybaco-settings-record-actions="">
                    {!!appendSignature && <Button onClick={() => appendSignature(p.content)}>{t('use_signature', 'Use Signature')}</Button>}
                    <Button secondary data-toybaco-settings-action="edit" onClick={addSignature(p)}>{t('edit', 'Edit')}</Button>
                    <Button secondary data-toybaco-settings-action="delete" onClick={deleteSignature(p)}>{t('delete', 'Delete')}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button data-toybaco-settings-action="add"
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
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
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
      await fetch(data?.id ? `/signatures/${data.id}` : '/signatures', {
        method: data?.id ? 'PUT' : 'POST',
        body: JSON.stringify(values),
      });
      toast.show(
        data?.id
          ? '署名を更新しました'
          : '署名を追加しました',
        'success'
      );
      modal.closeCurrent();
      reload();
    },
    [data, fetch, modal, reload, toast]
  );

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
          <div data-toybaco-settings-form-actions="">
            <Button type="button" secondary onClick={() => modal.closeCurrent()}>キャンセル</Button>
            <Button type="submit" disabled={!text?.trim() || form.formState.isSubmitting}>署名を保存</Button>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};
