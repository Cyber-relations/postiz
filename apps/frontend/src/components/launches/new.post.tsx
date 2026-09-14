import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import dayjs from 'dayjs';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SetSelectionModal } from '@gitroom/frontend/components/launches/calendar';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { ModalWrapperComponent } from '@gitroom/frontend/components/new-launch/modal.wrapper.component';

export const NewPost = () => {
  const fetch = useFetch();
  const modal = useModals();
  const { integrations, reloadCalendarView, sets } = useCalendar();
  const t = useT();
  const alive = useRef(true), creating = useRef(false), requestedAi = useRef(false);
  const [entryNotice, setEntryNotice] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const createAPost = useCallback(async (aiIntent = false) => {
    if (!alive.current || creating.current || !integrations.length) return;
    creating.current = true;
    const releaseCreation = () => { creating.current = false; };
    try {
    const response = await fetch('/posts/find-slot');
    if (!response.ok) throw new Error('TOYBACO_COMPOSER_UNAVAILABLE');
    const date = (await response.json()).date;
    if (!alive.current) return;
    if (typeof date !== 'string' || !dayjs(date).isValid()) throw new Error('TOYBACO_COMPOSER_UNAVAILABLE');

    const set: any = !sets.length
      ? undefined
      : await new Promise((resolve) => {
          modal.openModal({
            title: t('select_set', 'Select a Set'),
            closeOnClickOutside: true,
            closeOnEscape: true,
            withCloseButton: false,
            onClose: () => resolve('exit'),
            classNames: {
              modal: 'text-textColor',
            },
            children: (
              <SetSelectionModal
                sets={sets}
                onSelect={(selectedSet) => {
                  resolve(selectedSet);
                  modal.closeAll();
                }}
                onContinueWithoutSet={() => {
                  resolve(undefined);
                  modal.closeAll();
                }}
              />
            ),
          });
        });

    if (set === 'exit') { requestedAi.current = false; return; }
    if (!alive.current) return;

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
          toybacoAiIntent={aiIntent === true}
          allIntegrations={integrations.map((p) => ({
            ...p,
          }))}
          {...(set?.content ? { set: JSON.parse(set.content) } : {})}
          reopenModal={createAPost}
          mutate={reloadCalendarView}
          integrations={integrations}
          date={dayjs.utc(date).local()}
        />
      ),
      size: '80%',
      title: ``,
    });
    requestedAi.current = false;
    setEntryNotice('');
    } catch {
      if (alive.current) setEntryNotice('投稿作成を開けませんでした。入力や保存は行っていません。もう一度「投稿を作成」を押してください。');
    } finally { releaseCreation(); }
  }, [fetch, integrations, modal, reloadCalendarView, sets, t]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tb_ai') !== 'compose') return;
    url.searchParams.delete('tb_ai');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    requestedAi.current = true;
    if (!integrations.length) setEntryNotice('AIで文案を作るには、先に「チャンネルを追加」で投稿先を連携してください。');
    else void createAPost(true);
  }, [createAPost, integrations.length]);
  if (!integrations.length) return entryNotice ? <p role="status" className="text-[12px] leading-[1.6]">{entryNotice}</p> : null;
  return (
    <>
    {entryNotice && <p role="status" className="text-[12px] leading-[1.6]">{entryNotice}</p>}
    <button
      data-toybaco-create-post=""
      aria-label="新しい投稿を作成"
      onClick={() => createAPost(requestedAi.current)}
      className="text-white flex-1 pt-[12px] pb-[14px] ps-[16px] pe-[20px] group-[.sidebar]:p-0 min-h-[44px] max-h-[44px] rounded-[8px] bg-btnPrimary flex justify-center items-center gap-[5px] outline-none"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="21"
        height="20"
        viewBox="0 0 21 20"
        fill="none"
        className="min-w-[21px] min-h-[20px]"
      >
        <path
          d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex-1 text-start text-[14px] group-[.sidebar]:hidden">
        {t('create_new_post', 'Create Post')}
      </div>
    </button>
    </>
  );
};
