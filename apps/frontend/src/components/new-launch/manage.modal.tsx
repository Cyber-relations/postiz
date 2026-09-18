'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { ToybacoPostingConnectionNotice } from '@gitroom/frontend/components/layout/toybaco.posting.connection.notice';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PicksSocialsComponent } from '@gitroom/frontend/components/new-launch/picks.socials.component';
import { EditorWrapper } from '@gitroom/frontend/components/new-launch/editor';
import { SelectCurrent } from '@gitroom/frontend/components/new-launch/select.current';
import { ShowAllProviders } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { ToybacoPostingFailureNotice, useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useShallow } from 'zustand/react/shallow';
import { RepeatComponent } from '@gitroom/frontend/components/launches/repeat.component';
import { TagsComponent } from '@gitroom/frontend/components/launches/tags.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { CopilotPopup, useChatContext } from '@copilotkit/react-ui';
import { AssistantMessage, AssistantMessageProps, ErrorMessageProps } from '@copilotkit/react-ui';
import { useCopilotChat } from '@copilotkit/react-core';
import { PostComment } from '@gitroom/frontend/components/new-launch/providers/post-comment.enum';
import { DummyCodeComponent } from '@gitroom/frontend/components/new-launch/dummy.code.component';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';
import {
  SettingsIcon,
  ChevronDownIcon,
  CloseIcon,
  TrashIcon,
  DropdownArrowSmallIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useHasScroll } from '@gitroom/frontend/components/ui/is.scroll.hook';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { toybacoRegisterComposer } from '@gitroom/frontend/components/layout/layout.context';
import { useShortlinkPreference } from '@gitroom/frontend/components/settings/shortlink-preference.component';
import dayjs from 'dayjs';
import { Button } from '@gitroom/react/form/button';

const TOYBACO_VALIDATION_MESSAGES = Object.freeze({
  TOYBACO_INSTAGRAM_COMMENT_PERMISSION_REQUIRED: 'このInstagram接続にはコメント権限がありません。投稿文への追記に移すかコメントを除いて公開してください。コメントを含む下書きは保存できます。',
  TOYBACO_POST_CONTENT_REQUIRED:
    '投稿内容または画像を1件以上入力してください。',
  TOYBACO_POST_SETTINGS_INVALID: '投稿設定を確認してください。',
  TOYBACO_POST_MEDIA_INVALID:
    '投稿に利用できないメディアが含まれています。',
  TOYBACO_POST_TOO_LONG: '投稿文が長すぎます。短くしてから保存してください。',
});

function toybacoValidationMessage(code: unknown): string {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(TOYBACO_VALIDATION_MESSAGES, code)
    ? TOYBACO_VALIDATION_MESSAGES[
        code as keyof typeof TOYBACO_VALIDATION_MESSAGES
      ]
    : '投稿内容を確認してください。';
}

function toybacoProviderLabel(identifier: unknown): string {
  return identifier === 'instagram-standalone' || identifier === 'instagram'
    ? 'Instagram'
    : identifier === 'threads'
    ? 'Threads'
    : identifier === 'gmb'
    ? 'Google ビジネスプロフィール'
    : '連携先';
}

const ToybacoPostingAiIntent = React.createContext(false);

const TOYBACO_POSTING_AI_REASONS = Object.freeze({
  checking: '投稿文AIの設定を確認しています。',
  configured: '作りたい文案を依頼できます。公開前に内容をご確認ください。',
  disabled: '投稿文AIは現在提供を停止しています。入力した投稿はそのまま編集・保存できます。',
  not_configured: '投稿文AIの接続設定が完了していません。共通メニューの「AIアシスタント → 投稿文作成」からサポートへお問い合わせください。',
  unknown: '投稿文AIの利用可否を確認できません。入力内容は残しています。設定確認を再試行してください。',
});
type ToybacoPostingAiStatus = keyof typeof TOYBACO_POSTING_AI_REASONS;

async function toybacoReadPostingAi(request: ReturnType<typeof useFetch>, signal: AbortSignal): Promise<ToybacoPostingAiStatus> {
  const response = await request('/copilot/capabilities', { signal });
  if (!response.ok) throw new Error('TOYBACO_AI_CAPABILITY_UNKNOWN');
  const value = await response.json();
  if (value?.feature !== 'posting_text' || value?.verification !== 'not_run' || value?.replyQuotaShared !== false ||
      !['configured', 'disabled', 'not_configured'].includes(value?.status) || value?.canStart !== (value.status === 'configured')) {
    throw new Error('TOYBACO_AI_CAPABILITY_UNKNOWN');
  }
  return value.status;
}

// Wait for the open/close commit, without overriding a later user or child-dialog focus.
function useToybacoComposerFocus() {
  const { isTopModal } = useModals();
  const topModal = useRef(isTopModal);
  topModal.current = isTopModal;
  const pending = useRef<number | null>(null);
  useEffect(() => () => {
    if (pending.current !== null) cancelAnimationFrame(pending.current);
  }, []);
  return useCallback((source: HTMLElement, target: () => HTMLElement | null, initial = false) => {
    if (pending.current !== null) cancelAnimationFrame(pending.current);
    const composer = source.closest<HTMLElement>('[data-toybaco-composer]');
    const wrapper = composer?.closest<HTMLElement>('[data-toybaco-modal="add-edit-modal"]');
    const previous = document.activeElement;
    pending.current = requestAnimationFrame(() => {
      pending.current = null;
      if (!source.isConnected || !composer?.isConnected || !wrapper || !topModal.current('add-edit-modal')) return;
      const active = document.activeElement;
      const unowned = active === document.body || active === wrapper;
      if (initial ? !unowned : !unowned && active !== previous && active !== composer) return;
      const next = target();
      if (!next?.isConnected || !composer.contains(next) || next.closest('[inert]') ||
          next.matches(':disabled') || !next.getClientRects().length) return;
      next.focus({ preventScroll: true });
    });
  }, []);
}

function ToybacoCopilotButton() {
  const { open, setOpen, icons } = useChatContext();
  const request = useFetch();
  const requestedAi = React.useContext(ToybacoPostingAiIntent);
  const intentConsumed = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusAfterCommit = useToybacoComposerFocus();
  const statusId = React.useId();
  const [status, setStatus] = useState<ToybacoPostingAiStatus>('checking');
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef(request);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setStatus('checking');
    const timeout = setTimeout(() => { controller.abort(); if (current) setStatus('unknown'); }, 10000);
    toybacoReadPostingAi(requestRef.current, controller.signal)
      .then(value => { if (current && !controller.signal.aborted) setStatus(value); })
      .catch(() => { if (current) setStatus('unknown'); })
      .finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  const openChat = useCallback((source: HTMLButtonElement) => {
    const popup = source.closest('.copilotKitPopup');
    focusAfterCommit(source, () => popup?.querySelector<HTMLTextAreaElement>('.copilotKitInput textarea') || null);
    setOpen(true);
  }, [focusAfterCommit, setOpen]);
  useEffect(() => {
    if (requestedAi && status === 'configured' && !intentConsumed.current) {
      intentConsumed.current = true;
      const button = buttonRef.current;
      const active = document.activeElement;
      // A delayed capability response must not take focus from an editor or another dialog.
      if (button && (active === document.body || active === button ||
          active === button.closest('[data-toybaco-composer]') ||
          active === button.closest('[data-toybaco-modal="add-edit-modal"]'))) openChat(button);
      else setOpen(true);
    }
  }, [requestedAi, status, setOpen, openChat]);
  return (
    <div data-toybaco-composer-ai-entry="" hidden={open} className={open ? 'hidden' : 'flex flex-wrap items-center gap-x-[12px] gap-y-[4px]'}>
      <button
        type="button"
        data-toybaco-composer-ai=""
        ref={buttonRef}
        disabled={status !== 'configured'}
        onClick={(event) => { if (status === 'configured') openChat(event.currentTarget); }}
        className="inline-flex min-h-[44px] shrink-0 items-center gap-[6px] whitespace-nowrap rounded-[8px] border border-newBorder px-[12px] text-[12px] font-[600] text-textColor hover:bg-newBgColorInner disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="投稿文をAIで作る"
        aria-expanded={open}
        aria-describedby={statusId}
      >
        <span aria-hidden="true" className="flex h-[20px] w-[20px] items-center justify-center [&_svg]:h-full [&_svg]:w-full">{icons.openIcon}</span>
        投稿文をAIで作る
      </button>
      <span id={statusId} role="status" className="flex-1 min-w-[180px] text-[11px] leading-[1.5] font-normal text-textColor/70">{TOYBACO_POSTING_AI_REASONS[status]}</span>
      {status === 'unknown' && <button type="button" onClick={() => setAttempt(value => value + 1)} className="min-h-[44px] text-[12px] underline">設定確認を再試行</button>}
    </div>
  );
}

function ToybacoCopilotHeader() {
  const { setOpen, icons, labels } = useChatContext();
  const focusAfterCommit = useToybacoComposerFocus();
  return (
    <div className="copilotKitHeader">
      <div>{labels.title}</div>
      <div className="copilotKitHeaderControls">
        <button
          type="button"
          onClick={(event) => {
            const source = event.currentTarget;
            const popup = source.closest('.copilotKitPopup');
            focusAfterCommit(source, () => popup?.querySelector<HTMLButtonElement>('[data-toybaco-composer-ai]') || null);
            setOpen(false);
          }}
          aria-label="AIチャットを閉じる"
          className="copilotKitHeaderCloseButton"
        >
          {icons.headerCloseIcon}
        </button>
      </div>
    </div>
  );
}

const TOYBACO_POSTING_AI_HELP = '紹介したい商品やお知らせ、雰囲気、文字数を教えてください。文案は投稿欄で編集できます。下書き保存・公開は、ご自身で内容と投稿先を確認して操作してください。問い合わせ返信の月間利用枠とは別の文章支援です。';

function ToybacoCopilotAssistantMessage(props: AssistantMessageProps) {
  // CopilotKit assigns labels.initial itself as the synthetic welcome ID.
  if (props.message?.id === TOYBACO_POSTING_AI_HELP && props.message.content === TOYBACO_POSTING_AI_HELP) {
    return <p data-toybaco-ai-help="" className="copilotKitMessage copilotKitAssistantMessage text-[14px] leading-[1.7] font-normal">{TOYBACO_POSTING_AI_HELP}</p>;
  }
  return <AssistantMessage {...props} />;
}

function ToybacoCopilotErrorMessage({ error }: ErrorMessageProps) {
  const { isLoading } = useCopilotChat();
  const wasLoading = useRef(isLoading);
  const [dismissed, setDismissed] = useState<ErrorMessageProps['error'] | null>(null);
  const focusAfterCommit = useToybacoComposerFocus();
  useEffect(() => {
    if (isLoading && !wasLoading.current) setDismissed(error);
    wasLoading.current = isLoading;
  }, [isLoading, error]);
  if (isLoading || dismissed === error) return null;
  return (
    <div data-toybaco-ai-error="" role="alert" className="rounded-[8px] border border-[var(--toybaco-hairline)] bg-[var(--toybaco-offwhite)] p-[12px] text-[14px] leading-[1.7] text-[var(--toybaco-ink)]">
      <p>文案を作成できませんでした。送信した内容と投稿欄の入力は残っています。時間をおいて、もう一度お試しください。繰り返し失敗する場合はサポートへお問い合わせください。</p>
      <button type="button" className="mt-[8px] min-h-[44px] underline" onClick={(event) => {
        const popup = event.currentTarget.closest<HTMLElement>('.copilotKitPopup');
        setDismissed(error);
        if (popup) focusAfterCommit(popup, () => popup.querySelector<HTMLTextAreaElement>('.copilotKitInput textarea'));
      }}>入力に戻る</button>
    </div>
  );
}

function toybacoEmptyNewDraft(state: ReturnType<typeof useLaunchStore.getState>): string | null {
  const row = state.global?.[0];
  if (state.global?.length !== 1 || !row || typeof row.id !== 'string' || !row.id ||
      !['', '<p></p>'].includes(row.content) || !Array.isArray(row.media) || row.media.length ||
      (row.delay !== undefined && row.delay !== 0) ||
      !Array.isArray(state.internal) || state.internal.length ||
      !Array.isArray(state.selectedIntegrations) || state.selectedIntegrations.length ||
      !Array.isArray(state.tags) || state.tags.length || state.repeater != null ||
      state.current !== 'global' || state.editor !== 'normal' || state.loaded !== true ||
      state.totalChars !== 0 || state.postComment !== PostComment.ALL || state.comments !== true ||
      state.dummy !== false || state.isCreateSet !== false || state.locked !== false ||
      state.activateExitButton !== true || !dayjs.isDayjs(state.date) || !state.date.isValid()) return null;
  return JSON.stringify([row.id, state.date.valueOf()]);
}

function toybacoIsNewComposer(props: AddEditModalProps, existing: ReturnType<typeof useExistingData>): boolean {
  return !props.dummy && !props.addEditSets && props.set == null && props.onlyValues === undefined &&
    !props.focusedChannel && (props.selectedChannels === undefined || (Array.isArray(props.selectedChannels) && props.selectedChannels.length === 0)) &&
    existing?.integration === '' && existing.group === undefined && Array.isArray(existing.posts) && existing.posts.length === 0 &&
    !!existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings) && Object.keys(existing.settings).length === 0;
}

// toybaco_posting_result_guard: HTTP拒否と応答不明を成功に見せない。
async function toybacoCheckedPostRequest(
  request: (url: string, options: RequestInit) => Promise<Response>,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      request(url, { ...options, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('TOYBACO_POST_RESULT_UNKNOWN'));
        }, 30000);
      }),
    ]);
    if (!response.ok || response.headers?.get('logout')) {
      if (url === '/posts' && options.method === 'POST' && !response.headers?.get('logout') && (response.status === 400 || response.status === 409)) {
        const body = await response.clone?.().json().catch(() => null);
        if ((response.status === 409 && (
          body?.code === 'TOYBACO_POST_SAVE_ALREADY_COMMITTED' ||
          body?.code === 'TOYBACO_POST_SAVE_REQUEST_CHANGED'
        )) || (response.status === 400 && body?.code === 'TOYBACO_POST_SAVE_RELOAD_REQUIRED')) {
          throw new Error(body.code);
        }
      }
      throw new Error(response.status === 401 || response.status === 403 || response.headers?.get('logout')
        ? 'TOYBACO_POST_NOT_ALLOWED'
        : response.status >= 500
        ? 'TOYBACO_POST_RESULT_UNKNOWN'
        : 'TOYBACO_POST_REJECTED');
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export const ManageModal: FC<AddEditModalProps> = (props) => {
  const t = useT();
  const uncheckedFetch = useFetch();
  const fetch = useCallback(
    (url: string, options: RequestInit = {}) => toybacoCheckedPostRequest(uncheckedFetch, url, options),
    [uncheckedFetch]
  );
  const user = useUser();
  const toybacoCanPublish = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const toybacoSaving = useRef(false);
  const toybacoSaveRequestId = useRef('');
  const toybacoComposerGroup = useRef(makeId(10));
  const [toybacoSavedResult, setToybacoSavedResult] = useState(false);
  const [toybacoSaveError, setToybacoSaveError] = useState('');
  const [toybacoSessionOwner] = useState(() => user && ({ id: user.id, orgId: user.orgId, role: user.role, providerName: user.providerName }));
  const [toybacoConnectionError, setToybacoConnectionError] = useState('');
  const [toybacoCheckingConnection, setToybacoCheckingConnection] = useState(false);
  const toybacoReconnecting = useRef(false);
  const toybacoSession = useRef<ReturnType<typeof toybacoRegisterComposer> | undefined>(undefined);
  useEffect(() => {
    const session = toybacoRegisterComposer(toybacoSessionOwner, setToybacoConnectionError);
    toybacoSession.current = session;
    return () => {
      session.dispose();
      if (toybacoSession.current === session) toybacoSession.current = undefined;
    };
  }, [toybacoSessionOwner]);
  const toybacoReleaseReconnect = useCallback(() => {
    toybacoReconnecting.current = false;
  }, []);
  const toybacoReconnect = useCallback(async () => {
    if (toybacoReconnecting.current) return;
    const session = toybacoSession.current;
    toybacoReconnecting.current = true;
    setToybacoCheckingConnection(true);
    try {
      const response = await toybacoCheckedPostRequest(uncheckedFetch, '/user/self', { method: 'GET' });
      if (session && toybacoSession.current === session && session.verify(await response.json())) {
        setToybacoSaveError('');
      }
    } catch {
      if (toybacoSession.current === session) setToybacoConnectionError('接続を確認できません。入力は残しています。別タブで再接続してから、もう一度確認してください。');
    } finally {
      toybacoReleaseReconnect();
      if (toybacoSession.current === session) setToybacoCheckingConnection(false);
    }
  }, [uncheckedFetch, toybacoReleaseReconnect]);
  const ref = useRef(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useToybacoComposerFocus();
  useEffect(() => {
    const composer = composerRef.current;
    if (composer) focusAfterCommit(composer, () => composer, true);
  }, [focusAfterCommit]);
  const existingData = useExistingData();
  const { visibleMessages: toybacoAiMessages, isLoading: toybacoAiLoading } = useCopilotChat();
  const toybacoTouched = useRef(false);
  const [toybacoInitialDraft] = useState(() => toybacoIsNewComposer(props, existingData)
    ? toybacoEmptyNewDraft(useLaunchStore.getState()) : null);
  const toybacoMarkTouched = useCallback(() => { toybacoTouched.current = true; }, []);
  const toybacoAiProgress = useCallback((inProgress: boolean) => {
    if (inProgress) toybacoMarkTouched();
  }, [toybacoMarkTouched]);
  useEffect(() => {
    // Any model change stays dirty even when the user later removes it.
    const check = () => {
      if (toybacoEmptyNewDraft(useLaunchStore.getState()) !== toybacoInitialDraft) toybacoMarkTouched();
    };
    check();
    return useLaunchStore.subscribe(check);
  }, [toybacoInitialDraft, toybacoMarkTouched]);
  useEffect(() => {
    if (toybacoAiLoading !== false || !Array.isArray(toybacoAiMessages) || toybacoAiMessages.length) toybacoMarkTouched();
  }, [toybacoAiLoading, toybacoAiMessages, toybacoMarkTouched]);
  const toybacoCanEditDraft = !!user && (toybacoCanPublish || !existingData.integration || existingData?.posts?.[0]?.state === 'DRAFT');
  const [loading, setLoading] = useState(false);
  // 同期取得した保存ロックの解放を一か所にし、失敗・取消でも操作へ戻す。
  const toybacoFinishSaving = useCallback(() => {
    toybacoSaving.current = false;
    setLoading(false);
  }, []);
  const toaster = useToaster();
  const modal = useModals();
  const [showSettings, setShowSettings] = useState(false);
  const { data: shortlinkPreferenceData } = useShortlinkPreference();

  const { addEditSets, mutate, customClose, dummy } = props;

  const {
    selectedIntegrations,
    hide,
    date,
    setDate,
    repeater,
    setRepeater,
    tags,
    setTags,
    integrations,
    setSelectedIntegrations,
    locked,
    current,
    activateExitButton,
    setHide,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      current: state.current,
      repeater: state.repeater,
      setRepeater: state.setRepeater,
      tags: state.tags,
      setTags: state.setTags,
      selectedIntegrations: state.selectedIntegrations,
      integrations: state.integrations,
      setSelectedIntegrations: state.setSelectedIntegrations,
      locked: state.locked,
      activateExitButton: state.activateExitButton,
    }))
  );

  useEffect(() => {
    if (hide) {
      setHide(false);
    }
  }, [hide]);

  const currentIntegrationText = useMemo(() => {
    if (current === 'global') {
      return (
        <div className="flex items-center gap-[10px]">
          <div className="relative">
            <SettingsIcon size={15} className="text-white" />
          </div>
          <div>設定</div>
        </div>
      );
    }

    const currentIntegration = integrations.find((p) => p.id === current)!;

    return (
      <div className="flex items-center gap-[10px]">
        <div className="relative">
          <img
            src={`/icons/platforms/${currentIntegration.identifier}.png`}
            className="w-[20px] h-[20px] rounded-[4px]"
            alt={currentIntegration.identifier}
          />
          <SettingsIcon
            size={15}
            className="text-white absolute -end-[5px] -bottom-[5px]"
          />
        </div>
        <div>
          {currentIntegration.name} {t('channel_settings', 'Settings')}
        </div>
      </div>
    );
  }, [current]);

  const changeCustomer = useCallback(
    (customer: string) => {
      const neededIntegrations = integrations.filter(
        (p) => p?.customer?.id === customer
      );
      setSelectedIntegrations(
        neededIntegrations.map((p) => ({
          settings: {},
          selectedIntegrations: p,
        }))
      );
    },
    [integrations]
  );

  const askClose = useCallback(async () => {
    if (!activateExitButton || dummy || toybacoSaving.current) {
      return false;
    }

    const pristine = modal.isTopModal('add-edit-modal') && toybacoInitialDraft !== null && !toybacoTouched.current &&
      toybacoIsNewComposer(props, existingData) && toybacoEmptyNewDraft(useLaunchStore.getState()) === toybacoInitialDraft &&
      toybacoAiLoading === false && Array.isArray(toybacoAiMessages) && toybacoAiMessages.length === 0 &&
      !toybacoSaveRequestId.current && !toybacoSavedResult && !toybacoSaveError && !toybacoConnectionError && !toybacoCheckingConnection;
    if (pristine ||
      await deleteDialog(
        t('composer_discard_description', '保存していない変更がある場合は破棄されます。保存済みの投稿は残ります。'),
        t('composer_discard_confirm', '保存せずに閉じる'),
        t('composer_discard_title', 'この画面を閉じますか？'),
        t('composer_discard_cancel', '編集を続ける')
      )
    ) {
      if (customClose) customClose();
      else modal.closeAll();
      return true;
    }
    return false;
  }, [activateExitButton, dummy, customClose, modal, t, toybacoInitialDraft, props, existingData, toybacoAiLoading, toybacoAiMessages, toybacoSavedResult, toybacoSaveError, toybacoConnectionError, toybacoCheckingConnection]);

  useEffect(() => {
    const onRequestClose = (event: Event) => {
      event.preventDefault();
      const respond = (event as CustomEvent<(allowed: boolean) => void>).detail;
      void askClose().then(respond, () => respond(false));
    };
    document.addEventListener('toybaco:request-posting-close', onRequestClose);
    return () => document.removeEventListener('toybaco:request-posting-close', onRequestClose);
  }, [askClose]);

  const deletePost = useCallback(async () => {
    if (toybacoSaving.current || !toybacoCanEditDraft || toybacoConnectionError) return;
    toybacoSaving.current = true;
    setLoading(true);
    setToybacoSaveError('');
    try {
    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_delete_post',
          'Are you sure you want to delete this post?'
        ),
        t('yes_delete_it', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }
    await fetch(`/posts/${existingData.group}`, {
      method: 'DELETE',
    });
    mutate();
    modal.closeAll();
    } catch {
      setToybacoSaveError('削除結果を確認できません。カレンダーを確認してから再操作してください。');
    } finally {
      toybacoFinishSaving();
    }
  }, [existingData, mutate, modal, fetch, t, toybacoCanEditDraft, toybacoFinishSaving, toybacoConnectionError]);

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      if (toybacoSaving.current) return;
      if (toybacoConnectionError) return;
      if (toybacoSavedResult) return;
      if (!toybacoCanEditDraft || (!dummy && !addEditSets && type !== 'draft' && !toybacoCanPublish)) {
        setToybacoSaveError('予約・公開済みの投稿の変更と公開は管理者が行います。');
        return;
      }
      toybacoSaving.current = true;
      setLoading(true);
      setToybacoSaveError('');
      try {
      let republish = false;
      if (
        (type === 'now' || type === 'schedule') &&
        (existingData?.posts?.[0]?.state === 'PUBLISHED' ||
          (existingData?.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(date.utc())))
      ) {
        const channels = selectedIntegrations
          .map((p) => p.integration.name)
          .join(', ');
        const isRecurring =
          !!repeater || !!existingData?.posts?.[0]?.intervalInDays;

        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            title: t('what_do_you_want_to_do', 'What do you want to do?'),
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  {t(
                    'post_already_published_republish_warning',
                    'This post was already published. Republishing will publish it again to'
                  )}{' '}
                  {channels} {t('republish_at', 'at')}{' '}
                  {date.format('DD/MM/YYYY HH:mm')}.
                  {isRecurring && (
                    <div className="mt-[10px]">
                      {t(
                        'republish_recurring_note',
                        'This is a recurring post: your changes apply to all future recurrences starting now.'
                      )}
                    </div>
                  )}
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('update')}
                    >
                      {t(
                        'just_update_post_details',
                        'Just update the post details'
                      )}
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('republish')}
                    >
                      {t('republish_the_post', 'Republish the post')}
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (whatToDo === 'update') {
          type = 'update';
        }

        if (whatToDo === 'republish') {
          republish = true;
        }
      }

      setLoading(true);

      // Pull the local values to build the payload, but rely on the server
      // (`/posts/valid`) for the actual validation — checkValidity now lives
      // server-side so it can't be bypassed.
      const allValues = await ref.current.getAllValues();

      const integrationById = (id: string) =>
        selectedIntegrations.find((p) => p.integration.id === id);

      const group = existingData.group || toybacoComposerGroup.current;

      const posts = allValues.map((post: any) => ({
        integration: {
          id: post.id,
        },
        group,
        settings: { ...(post.settings || {}) },
        value: post.values.map((value: any) => ({
          // Global editor values share makeId(10) IDs across channels. Keep
          // persisted IDs intact; scope only new composer IDs to their channel.
          ...(value.id ? { id: !existingData.integration && !existingData.group && !existingData.posts?.length && /^[A-Za-z0-9]{10}$/.test(value.id)
            ? `${post.id}:${value.id}`
            : value.id } : {}),
          content: value.content,
          delay: value.delay || 0,
          image:
            (value?.media || []).map(
              ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                id,
                path,
                alt,
                thumbnail,
                thumbnailTimestamp,
              })
            ) || [],
        })),
      }));

      if (!dummy) {
        const checkAllValid = await (
          await fetch('/posts/valid', {
            method: 'POST',
            body: JSON.stringify({ type, posts }),
          })
        ).json();

        if (!Array.isArray(checkAllValid)) throw new Error('TOYBACO_POST_REJECTED');

        const focus = (id: string, where: 'fix' | 'preview') => {
          integrationById(id)?.ref?.current?.[where]?.();
        };

        const notEnoughChars = checkAllValid.filter((p: any) => p.emptyContent);

        for (const item of notEnoughChars) {
          toaster.show(
            `${toybacoProviderLabel(item.identifier)}: ${toybacoValidationMessage(
              item.toybacoErrorCode || 'TOYBACO_POST_CONTENT_REQUIRED'
            )}`,
            'warning'
          );
          setLoading(false);
          focus(item.id, 'preview');
          return;
        }

        if (type !== 'draft') {
          for (const item of checkAllValid) {
            if (item.commentPermissionError) {
              toaster.show(toybacoValidationMessage(item.commentPermissionError), 'warning');
              focus(item.id, 'preview');
              setLoading(false);
              return;
            }
            if (item.valid === false) {
              toaster.show(
                `${toybacoProviderLabel(item.identifier)}: ${toybacoValidationMessage(
                  item.toybacoErrorCode || 'TOYBACO_POST_SETTINGS_INVALID'
                )}`,
                'warning'
              );
              focus(item.id, 'fix');
              setLoading(false);
              setShowSettings(true);
              return;
            }

            if (item.errors !== true) {
              toaster.show(
                `${toybacoProviderLabel(item.identifier)}: ${toybacoValidationMessage(
                  item.toybacoErrorCode || 'TOYBACO_POST_MEDIA_INVALID'
                )}`,
                'warning'
              );
              focus(item.id, 'preview');
              setLoading(false);
              setShowSettings(false);
              return;
            }

            if (item.tooLong) {
              toaster.show(
                `${toybacoProviderLabel(item.identifier)}: ${toybacoValidationMessage(
                  item.toybacoErrorCode || 'TOYBACO_POST_TOO_LONG'
                )}`,
                'warning'
              );
              focus(item.id, 'preview');
              setLoading(false);
              return;
            }
          }
        }
      }

      const shortlinkPreference = shortlinkPreferenceData?.shortlink || 'ASK';

      let shortLink = false;

      if (!dummy && shortlinkPreference !== 'NO') {
        const shortLinkUrl = await (
          await fetch('/posts/should-shortlink', {
            method: 'POST',
            body: JSON.stringify({
              messages: allValues
                // platforms that remove links won't keep shortlinks either
                .filter(
                  (p: any) => !integrationById(p.id)?.integration?.stripLinks
                )
                .flatMap((p: any) => p.values.flatMap((a: any) => a.content)),
            }),
          })
        ).json();

        if (shortLinkUrl.ask) {
          if (shortlinkPreference === 'YES') {
            // Automatically shortlink without asking
            shortLink = true;
          } else {
            // ASK: Show the dialog
            shortLink = await deleteDialog(
              t(
                'shortlink_urls_question',
                'Do you want to shortlink the URLs? it will let you get statistics over clicks'
              ),
              t('yes_shortlink_it', 'Yes, shortlink it!'),
              undefined,
              t('no_original_urls', 'No, original URLs')
            );
          }
        }
      }

      const data = {
        type,
        ...(republish ? { republish } : {}),
        ...(repeater ? { inter: repeater } : {}),
        tags,
        shortLink,
        date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
        posts,
      };

      if (dummy) {
        modal.openModal({
          title: '',
          children: <DummyCodeComponent code={data} />,
          classNames: {
            modal: 'w-[100%] bg-transparent text-textColor',
          },
          size: '100%',
          withCloseButton: false,
          closeOnEscape: true,
          closeOnClickOutside: true,
        });

        setLoading(false);
      }

      if (!dummy) {
        addEditSets
          ? addEditSets(data)
          : await fetch('/posts', {
              method: 'POST',
              body: JSON.stringify({
                ...data,
                // A timeout or rejection keeps this save identity. Only a new
                // composer starts a new logical save operation.
                toybacoRequestId: toybacoSaveRequestId.current ||= crypto.randomUUID(),
              }),
            });

        if (!addEditSets) {
          mutate();
          toaster.show(
            !existingData.integration
              ? t('added_successfully', 'Added successfully')
              : t('updated_successfully', 'Updated successfully')
          );
        }
        if (customClose) {
          setTimeout(() => {
            customClose();
          }, 2000);
        }

        if (!addEditSets) {
          modal.closeAll();
        }
      }
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        const saved = code === 'TOYBACO_POST_SAVE_ALREADY_COMMITTED' || code === 'TOYBACO_POST_SAVE_REQUEST_CHANGED';
        if (saved) {
          setToybacoSavedResult(true);
          mutate();
        }
        setToybacoSaveError(code === 'TOYBACO_POST_SAVE_ALREADY_COMMITTED'
          ? 'この操作の投稿は保存済みです。重複した投稿は作成していません。カレンダーで保存済みの投稿と公開状況を確認してください。'
          : code === 'TOYBACO_POST_SAVE_REQUEST_CHANGED'
          ? '前の操作の投稿は保存済みです。今回の変更は保存していません。入力内容は残しています。カレンダーから保存済みの投稿を開いて変更してください。'
          : code === 'TOYBACO_POST_SAVE_RELOAD_REQUIRED'
          ? 'この保存は受け付けていません。入力内容を控えてから、この画面を閉じて再読み込みしてください。'
          : code === 'TOYBACO_POST_NOT_ALLOWED'
          ? '保存する権限を確認できません。入力内容は残しています。管理者に確認してください。'
          : code === 'TOYBACO_POST_REJECTED'
          ? '保存できませんでした。入力内容は残しています。投稿先・本文・日時を確認してください。'
          : '保存結果を確認できません。入力内容は残しています。重複を避けるため、カレンダーを確認してから再操作してください。');
      } finally {
        toybacoFinishSaving();
      }
    },
    [ref, repeater, tags, date, addEditSets, dummy, shortlinkPreferenceData, fetch, selectedIntegrations, existingData, mutate, modal, customClose, toaster, t, toybacoCanPublish, toybacoCanEditDraft, toybacoFinishSaving, toybacoConnectionError, toybacoSavedResult]
  );

  return (
    <div data-toybaco-composer="" ref={composerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="toybaco-composer-title" onInputCapture={toybacoMarkTouched} onChangeCapture={toybacoMarkTouched} onPasteCapture={toybacoMarkTouched} onDropCapture={toybacoMarkTouched} className="w-full h-full flex-1 p-[40px] flex relative">
      <div data-toybaco-composer-panel="" className="flex flex-1 bg-newBgColorInner rounded-[20px] flex-col">
        {addEditSets && <p data-toybaco-template-guidance="" className="px-[20px] py-[12px] text-[13px] leading-[1.6]">投稿文・メディア・投稿先ごとの設定を保存し、投稿作成で呼び出せます。この操作では公開・予約されません。</p>}
        <div data-toybaco-composer-body="" className="flex-1 flex">
          <div data-toybaco-composer-editor="" className="flex flex-col flex-1 border-e border-newBorder">
            <div data-toybaco-composer-heading="" className="bg-newBgColor h-[65px] rounded-s-[20px] !rounded-b-[0] flex items-center gap-[12px] px-[20px] text-[20px] font-[600]" style={{ display: 'grid', gridTemplateColumns: '1fr auto', height: 'auto', minHeight: 64 }}>
              <h2 id="toybaco-composer-title">{addEditSets ? (props.set ? '投稿テンプレートを編集' : '投稿テンプレートを作成') : existingData.integration ? '投稿を編集' : '投稿を作成'}</h2>
      <ToybacoPostingAiIntent.Provider value={props.toybacoAiIntent === true}>
      <CopilotPopup
        className="!relative !z-[200] !inset-auto order-3 col-span-2 w-full shrink-0 [&_.poweredBy]:!hidden [&_.poweredByContainer]:!pb-0"
        Button={ToybacoCopilotButton}
        Header={ToybacoCopilotHeader}
        AssistantMessage={ToybacoCopilotAssistantMessage}
        ErrorMessage={ToybacoCopilotErrorMessage}
        onSubmitMessage={toybacoMarkTouched}
        onInProgress={toybacoAiProgress}
        hitEscapeToClose={false}
        clickOutsideToClose={true}
        instructions={`
You are an assistant that help the user to schedule their social media posts,
Here are the things you can do:
- Add a new comment / post to the list of posts
- Delete a comment / post from the list of posts
- Add content to the comment / post
- Activate or deactivate the comment / post

Post content can be added using the addPostContentFor{num} function.
After using the addPostFor{num} it will create a new addPostContentFor{num+ 1} function.
`}
        labels={{
          title: '投稿文づくり',
          initial: TOYBACO_POSTING_AI_HELP,
          placeholder: t(
            'ai_chat_placeholder',
            '例：新商品の紹介を、親しみやすく150文字で'
          ),
          error: t(
            'ai_chat_error',
            '文案を作成できませんでした。投稿欄の内容は残っています。少し待ってから再試行してください。'
          ),
          stopGenerating: t('ai_chat_stop', '生成を停止'),
          regenerateResponse: t('ai_chat_regenerate', '回答を再生成'),
          copyToClipboard: t('ai_chat_copy', 'クリップボードにコピー'),
          thumbsUp: t('ai_chat_helpful', '役に立った'),
          thumbsDown: t('ai_chat_not_helpful', '役に立たなかった'),
          copied: t('ai_chat_copied', 'コピーしました'),
        }}
      />
      </ToybacoPostingAiIntent.Provider>
              <button type="button" data-toybaco-composer-close="" aria-label="投稿作成を閉じる" onClick={askClose} disabled={loading}>
                <CloseIcon />
              </button>
              <CreationMethodBadge
                creationMethod={existingData?.posts?.[0]?.creationMethod}
                size="sm"
              />
            </div>
            <ToybacoPostingConnectionNotice placement="composer" />
            <div className="flex-1 flex flex-col gap-[16px]">
              <div
                className={clsx('flex-1 relative', showSettings && 'hidden')}
              >
                <div
                  id="social-content"
                  className="gap-[32px] flex flex-col pe-[8px] pt-[20px] ps-[20px] absolute top-0 left-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
                >
                  <div data-toybaco-composer-content="" className="flex flex-1 gap-[6px] flex-col">
                    {!dummy && !addEditSets && <ToybacoPostingFailureNotice />}
                    <div>{!existingData.integration && <SelectCurrent />}</div>
                    <div className="flex-1 flex">
                      {!hide && <EditorWrapper totalPosts={1} value="" />}
                    </div>
                    <div
                      id="social-empty"
                      className={clsx(
                        'pb-[16px]'
                        // current !== 'global' && 'hidden'
                      )}
                    />
                  </div>
                  <div data-toybaco-composer-channels="" className="flex w-full">
                    <h3>投稿先</h3>
                    <div className="flex flex-1">
                      <PicksSocialsComponent toolTip={true} />
                    </div>
                    <div>
                      {!dummy && (
                        <SelectCustomer
                          onChange={changeCustomer}
                          integrations={integrations}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div
                id="wrapper-settings"
                className={clsx(
                  'pb-[20px] px-[20px] select-none',
                  showSettings && 'flex-1 flex pt-[20px]',
                  current === 'global' && 'hidden'
                )}
              >
                <div className="flex-1 flex flex-col rounded-[12px] gap-[12px] overflow-hidden bg-newSettings">
                  <div
                    onClick={() => setShowSettings(!showSettings)}
                    className={clsx(
                      'bg-[#1F3A5F] rounded-[12px] flex items-center gap-[8px] cursor-pointer p-[12px]',
                      showSettings ? '!rounded-b-none' : ''
                    )}
                  >
                    <div className="flex-1 text-[14px] font-[600] text-white">
                      {currentIntegrationText}
                    </div>
                    <div>
                      <ChevronDownIcon
                        rotated={showSettings}
                        className="text-white"
                      />
                    </div>
                  </div>
                  <div
                    className={clsx(
                      !showSettings ? 'hidden' : 'flex-1',
                      'text-[14px] text-textColor font-[500] relative'
                    )}
                  >
                    <div className="absolute left-0 top-0 w-full h-full flex flex-col overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newBgColorInner scrollbar-track-newColColor">
                      <div
                        id="social-settings"
                        className="flex flex-col gap-[20px] bg-newBgColor"
                      />
                    </div>
                  </div>
                  <style>
                    {`#social-settings [data-id="${current}"] {display: block !important;}`}
                  </style>
                </div>
              </div>
            </div>
          </div>
          <div data-toybaco-composer-preview="" className="w-[580px] flex flex-col">
            <div className="bg-newBgColor h-[65px] rounded-e-[20px] !rounded-b-[0] flex items-center px-[20px] text-[20px] font-[600]">
              <div className="flex-1">{t('post_preview', 'Post Preview')}</div>

            </div>
            <div className="flex-1 relative">
              <Scrollable
                scrollClasses="!pe-[20px]"
                className="absolute top-0 p-[20px] pe-[8px] left-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
              >
                <ShowAllProviders ref={ref} />
              </Scrollable>
            </div>
          </div>
        </div>
        <div data-toybaco-composer-footer="" aria-busy={loading} style={toybacoConnectionError ? { height: 'auto', flexWrap: 'wrap', maxHeight: '40dvh', overflowY: 'auto' } : undefined} className="select-none h-[84px] py-[20px] border-t border-newBorder flex items-center">
          {toybacoSaveError && !toybacoConnectionError && <p data-toybaco-save-error="" role="alert">{toybacoSaveError}{toybacoSavedResult && <button type="button" className="block mt-[8px] underline" onClick={() => { void askClose(); }}>カレンダーで保存済み投稿を確認</button>}</p>}
          {toybacoConnectionError && (
            <div data-toybaco-session-recovery="" style={{ flexBasis: '100%', minWidth: 0, padding: '8px 16px' }}>
              <p role="alert">{toybacoConnectionError}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px' }}>
                <a href="/api/auth/toybaco-entry?return=/launches" target="_blank" rel="noopener noreferrer" className="underline">別タブで再接続</a>
                <button type="button" onClick={toybacoReconnect} disabled={toybacoCheckingConnection} className="underline">
                  {toybacoCheckingConnection ? '接続を確認中…' : '接続を確認'}
                </button>
              </div>
            </div>
          )}
          {!dummy && !addEditSets && (
            <p data-toybaco-approval-note="">
              {existingData.posts.some((post) => post.state === 'ERROR')
                ? '上の案内と投稿先の公開状況を確認してください。再送する場合は管理者が判断します。'
                : toybacoCanPublish
                ? '下書きを確認し、投稿先と日時を選んで予約してください。'
                : toybacoCanEditDraft
                ? 'スタッフは下書きを保存できます。公開は管理者が確認してから行います。'
                : '予約・公開済みの投稿の変更は管理者に依頼してください。'}
            </p>
          )}
          <div className="flex-1 flex ps-[20px] gap-[8px]">
            {!dummy && (
              <TagsComponent
                name="tags"
                label={t('tags', 'Tags')}
                initial={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                }}
              />
            )}

            {!dummy && !addEditSets && (
              <RepeatComponent repeat={repeater} onChange={setRepeater} />
            )}
          </div>
          <div data-toybaco-composer-actions="" className="pe-[20px] flex items-center justify-end gap-[8px]">
            {existingData?.integration && toybacoCanEditDraft && (
              <button
                disabled={loading || !!toybacoConnectionError}
                onClick={deletePost}
                className="cursor-pointer flex text-[#FF3F3F] gap-[8px] items-center text-[15px] font-[600]"
              >
                <div>
                  <TrashIcon />
                </div>
                <div>{t('delete_post', 'Delete Post')}</div>
              </button>
            )}
            {!addEditSets && <DatePicker onChange={setDate} date={date} />}
            {!addEditSets && (
              <button
                disabled={
                  selectedIntegrations.length === 0 || loading || locked || !toybacoCanEditDraft || !!toybacoConnectionError || toybacoSavedResult
                }
                onClick={schedule('draft')}
                className="relative cursor-pointer disabled:cursor-not-allowed px-[20px] h-[44px] bg-btnSimple justify-center items-center flex rounded-[8px] text-[15px] font-[600]"
              >
                {loading && (
                  <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                    <div className="animate-spin h-[20px] w-[20px] border-4 border-textColor border-t-transparent rounded-full" />
                  </div>
                )}
                <div className={clsx(loading && 'invisible')}>
                  {t('save_as_draft', 'Save as Draft')}
                </div>
              </button>
            )}
            {addEditSets && (
              <button
                className="text-white text-[15px] font-[600] min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] rounded-[8px] bg-[#1F3A5F] ps-[20px] pe-[16px]"
                disabled={
                  selectedIntegrations.length === 0 || loading || locked || !toybacoCanEditDraft || !!toybacoConnectionError || toybacoSavedResult
                }
                onClick={schedule('draft')}
              >
                投稿テンプレートを保存
              </button>
            )}
            {!addEditSets && (dummy || toybacoCanPublish) && (
              <div className="group cursor-pointer relative">
                <button
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked || !toybacoCanEditDraft || !!toybacoConnectionError || toybacoSavedResult
                  }
                  onClick={schedule('schedule')}
                  className="text-white relative min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] rounded-[8px] bg-[#1F3A5F] ps-[20px] pe-[16px]"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                      <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
                    </div>
                  )}
                  <div
                    className={clsx(
                      'text-[15px] font-[600]',
                      loading && 'invisible'
                    )}
                  >
                    {selectedIntegrations.length === 0
                      ? t('select_posting_channel', '投稿先チャンネルを選択してください')
                      : dummy
                      ? t('create_output', 'Create output')
                      : !existingData?.integration
                      ? t('add_to_calendar', 'Add to calendar')
                      : existingData?.posts?.[0]?.state === 'DRAFT'
                      ? '承認して予約'
                      : t('update', 'Update')}
                  </div>
                  {!dummy && (
                    <div className="flex justify-center items-center h-[20px] w-[20px] pt-[4px] arrow-change">
                      <DropdownArrowSmallIcon className="group-hover:rotate-180 text-white" />
                    </div>
                  )}
                </button>

                {!dummy && (
                  <button
                    onClick={schedule('now')}
                    disabled={
                      selectedIntegrations.length === 0 || loading || locked || !toybacoCanEditDraft || !!toybacoConnectionError || toybacoSavedResult
                    }
                    className="rounded-[8px] z-[300] disabled:cursor-not-allowed disabled:opacity-80 hidden group-hover:flex absolute bottom-[100%] -left-[12px] p-[12px] w-[206px] bg-newBgColorInner"
                  >
                    <div className="text-white rounded-[8px] bg-[#1F3A5F] h-[44px] w-full flex justify-center items-center post-now">
                      {t('post_now', 'Post Now')}
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

const Scrollable: FC<{
  className: string;
  scrollClasses: string;
  children: ReactNode;
}> = ({ className, scrollClasses, children }) => {
  const ref = useRef(undefined);
  const hasScroll = useHasScroll(ref);
  return (
    <div className={clsx(className, hasScroll && scrollClasses)} ref={ref}>
      {children}
    </div>
  );
};
