'use client';

import React, { ReactNode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { Plus_Jakarta_Sans } from 'next/font/google';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useSearchParams } from 'next/navigation';
import useSWR, { SWRConfig } from 'swr';
import { toybacoLoadPostingIdentity, toybacoPostingCopilotHeaders, toybacoPostingServerSnapshot, toybacoPostingSnapshot, toybacoSubscribePosting, toybacoVerifyPostingIdentity } from '@gitroom/frontend/components/layout/toybaco.posting.context';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { setSentryUser } from '@gitroom/react/sentry/initialize.sentry.client';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();
  const posting = useSyncExternalStore(toybacoSubscribePosting, toybacoPostingSnapshot, toybacoPostingServerSnapshot);
  const [postingCache] = useState(() => ({ provider: () => new Map() }));
  const copilotHeaders = useMemo(() => posting.owner ? toybacoPostingCopilotHeaders(posting.owner, posting.documentId) : undefined, [posting.documentId, posting.owner]);
  const [verifyingPosting, setVerifyingPosting] = useState(false);

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const load = useCallback(() => toybacoLoadPostingIdentity(fetch, backendUrl, posting), [fetch, backendUrl, posting]);
  const identityKey = ['context', 'standalone', 'ready', 'blocked'].includes(posting.phase)
    ? ['/user/self', posting.documentId, posting.context?.frameId || 'standalone']
    : null;
  const { data: user, mutate } = useSWR(identityKey, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    shouldRetryOnError: false,
  });

  useEffect(() => {
    setSentryUser(
      user ? { id: user.id, email: user.email, orgId: user.orgId } : null
    );
  }, [user]);

  if (!user) return (
    <div data-toybaco-context-state={posting.phase} data-toybaco-context-recovery={posting.phase === 'denied' && !posting.context ? '' : undefined}
      className="mx-auto flex min-h-[240px] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center text-sm text-newTextColor" role="status">
      <p>{posting.phase === 'denied' ? (posting.context ? posting.message : 'トイバコを開き直してください。画面を更新して接続を確認します。') : '店舗の接続を確認しています。'}</p>
      {posting.phase === 'denied' && !posting.context && posting.appOrigin && (
        <a href={posting.appOrigin} target="_top" className="rounded-xl bg-newTextColor px-5 py-3 font-semibold text-newBgColorInner">トイバコを開き直す</a>
      )}
    </div>
  );

  return (
    <LayoutContext key={posting.documentId} postingTicket={posting}>
    <SWRConfig key={posting.documentId} value={postingCache}>
    <ContextWrapper user={user}>
      {posting.message && (
        <div role="alert" className="sticky top-0 z-[9999] mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-newTextColor/20 bg-newBgColorInner p-4 text-sm text-newTextColor">
          <p className="min-w-0 flex-1">{posting.message}</p>
          {posting.appOrigin && posting.context && (
            <a href={`${posting.appOrigin}/app/accounts/${posting.context.accountId}/dashboard#/toybaco/posting?path=%2Flaunches`} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-newTextColor/20 px-4 py-2 font-semibold">別タブで再接続</a>
          )}
          <button type="button" disabled={verifyingPosting} className="rounded-lg border border-newTextColor/20 px-4 py-2 font-semibold disabled:opacity-50"
            onClick={async () => { setVerifyingPosting(true); try { await toybacoVerifyPostingIdentity(backendUrl); } finally { setVerifyingPosting(false); } }}>
            {verifyingPosting ? '確認中…' : '接続を確認'}
          </button>
        </div>
      )}
      <CopilotKit
        credentials="include"
        headers={copilotHeaders}
        runtimeUrl={backendUrl + '/copilot/chat'}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              data-toybaco-shell=""
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[12px]',
                jakartaSans.className
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex gap-[8px]">
                    <Support />
                    <div
                      data-toybaco-sidebar=""
                      className="flex flex-col bg-newBgColorInner w-[80px] rounded-[12px]"
                    >
                      <div
                        id="left-menu"
                        className={clsx(
                          'fixed h-full w-[64px] start-[17px] flex flex-1 top-0',
                          user?.admin && 'pt-[60px] max-h-[1000px]:w-[500px]'
                        )}
                      >
                        <div className="flex flex-col h-full gap-[32px] flex-1 py-[12px]">
                          <Logo />
                          <TopMenu />
                        </div>
                      </div>
                    </div>
                    <div
                      data-toybaco-content-frame=""
                      className="flex-1 bg-newBgLineColor rounded-[12px] overflow-hidden flex flex-col gap-[1px] blurMe"
                    >
                      <div
                        data-toybaco-header=""
                        className="flex bg-newBgColorInner h-[80px] px-[20px] items-center"
                      >
                        <div
                          data-toybaco-header-title=""
                          className="text-[24px] font-[600] flex flex-1"
                        >
                          <Title />
                        </div>
                        <div
                          data-toybaco-header-controls=""
                          className="flex gap-[20px] text-textItemBlur"
                        >
                          <StreakComponent />
                          <div className="w-[1px] h-[20px] bg-blockSeparator" />
                          <span
                            style={{ display: 'contents' }}
                            data-toybaco-keep=""
                            data-toybaco-organization-control=""
                          >
                            <OrganizationSelector />
                          </span>
                          <div className="hover:text-newTextColor">
                            <ModeComponent />
                          </div>
                          <div className="w-[1px] h-[20px] bg-blockSeparator" />
                          <LanguageComponent />
                          <ChromeExtensionComponent />
                          <div className="w-[1px] h-[20px] bg-blockSeparator" />
                          <AttachToFeedbackIcon />
                          <span
                            style={{ display: 'contents' }}
                            data-toybaco-keep=""
                            data-toybaco-post-notifications=""
                          >
                            <NotificationComponent />
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-1 gap-[1px]">{children}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
    </SWRConfig>
    </LayoutContext>
  );
};
