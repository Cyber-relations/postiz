'use client';

import { LoadingSurface } from '@gitroom/frontend/components/layout/loading';

import { readGmbResponse } from '@gitroom/frontend/components/new-launch/providers/continue-provider/gmb/gmb.continue';
import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { HttpStatusCode } from 'axios';
import { useRouter } from 'next/navigation';
import { Redirect } from '@gitroom/frontend/components/layout/redirect';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import dayjs from 'dayjs';
import { continueProviderList } from '@gitroom/frontend/components/new-launch/providers/continue-provider/list';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useVariables } from '@gitroom/react/helpers/variable.context';

interface TwoStepState {
  integrationId: string;
  onboarding: boolean;
  pages: any[];
  pagesError?: unknown;
  pagesWarnings?: string[];
  returnURL?: string;
}

type ConnectionOutcome = 'connected' | 'precondition' | 'review';

export const ContinueIntegration: FC<{
  provider: string;
  searchParams: any;
  logged: boolean;
  appOrigin?: string;
}> = (props) => {
  const { provider, searchParams, logged } = props;
  const { push } = useRouter();
  const t = useT();
  const fetch = useFetch();
  const { extensionId, backendUrl } = useVariables();
  const [error, setError] = useState(false);
  const [twoStepState, setTwoStepState] = useState<TwoStepState | null>(null);
  const [successState, setSuccessState] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to handle navigation - redirects if logged or returnURL exists, otherwise shows inline
  const navigateOrShow = useCallback(
    (path: string, returnURL: string | undefined, outcome: ConnectionOutcome) => {
      if (returnURL) {
        // If returnURL exists, always redirect to it with the path params
        const params = path.includes('?') ? path.split('?')[1] : '';
        push(params ? `${returnURL}?${params}` : returnURL);
      } else if (logged) {
        // If logged in without returnURL, use normal navigation
        push(path);
      } else {
        // 外部由来の文言ではなく、型で接続結果を分岐する。
        if (outcome === 'connected') {
          setSuccessState(true);
        } else {
          setError(true);
        }
      }
    },
    [logged, push]
  );
  const modifiedParams = useMemo(() => {
    if (provider === 'mewe') {
      return {
        state: searchParams.state || '',
        code: searchParams.loginRequestToken || '',
        refresh: searchParams.refresh || '',
      };
    }
    if (provider === 'x') {
      return {
        state: searchParams.oauth_token || '',
        code: searchParams.oauth_verifier || '',
        refresh: searchParams.refresh || '',
      };
    }

    if (provider === 'tiktok-business') {
      // The TikTok Business API redirects back with `auth_code` instead of `code`
      return {
        state: searchParams.state || '',
        code: searchParams.auth_code || searchParams.code || '',
        refresh: searchParams.refresh || '',
      };
    }

    if (provider === 'vk') {
      return {
        ...searchParams,
        state: searchParams.state || '',
        code: searchParams.code + '&&&&' + searchParams.device_id,
      };
    }

    if (provider === 'mewe') {
      const hash =
        typeof window !== 'undefined' ? window.location.hash.substring(1) : '';
      const hashParams = new URLSearchParams(hash);
      return {
        state: hashParams.get('state') || searchParams.state || '',
        code: hashParams.get('loginRequestToken') || '',
        refresh: searchParams.refresh || '',
      };
    }

    return searchParams;
  }, []);

  useEffect(() => {
    (async () => {
      const timezone = String(dayjs.tz().utcOffset());

      // Try public endpoint first (handles both public and fallback scenarios)
      let data = await fetch(`/integrations/social-connect/${provider}`, {
        method: 'POST',
        body: JSON.stringify({ ...modifiedParams, timezone }),
      });

      // If public endpoint fails with specific errors, try authenticated endpoint
      if (data.status === HttpStatusCode.BadRequest) {
        const errorData = await data.json().catch(() => ({}));
        // "Invalid connection type" means this wasn't started as a public flow
        if (
          errorData.message?.includes('Invalid connection type') ||
          errorData.message?.includes('Invalid or expired state')
        ) {
          data = await fetch(`/integrations/social-connect/${provider}`, {
            method: 'POST',
            body: JSON.stringify({ ...modifiedParams, timezone }),
          });
        }
      }

      if (data.status === HttpStatusCode.PreconditionFailed) {
        const { returnURL } = await data.json().catch(() => ({}));
        navigateOrShow(
          `/launches?precondition=true`,
          returnURL,
          'precondition'
        );
        return;
      }

      if (data.status === HttpStatusCode.NotAcceptable) {
        const { returnURL } = await data.json().catch(() => ({}));
        navigateOrShow('/launches?connection=review', returnURL, 'review');
        return;
      }

      if (
        data.status !== HttpStatusCode.Ok &&
        data.status !== HttpStatusCode.Created
      ) {
        // API・連携先の生エラーは顧客画面へ出さない。
        await data.json().catch(() => ({}));
        setError(true);
        return;
      }

      const {
        inBetweenSteps,
        id,
        onboarding: resOnboarding,
        pages,
        pagesError,
        pagesWarnings,
        returnURL,
        extensionToken,
      } = await data.json();
      const onboarding = resOnboarding || searchParams.onboarding === 'true';

      // Store refresh token in extension for background cookie refresh
      if (
        extensionToken &&
        extensionId &&
        typeof chrome !== 'undefined' &&
        chrome?.runtime?.sendMessage
      ) {
        try {
          chrome.runtime.sendMessage(
            extensionId,
            {
              type: 'STORE_REFRESH_TOKEN',
              provider,
              integrationId: id,
              jwt: extensionToken,
              backendUrl,
            },
            () => {}
          );
        } catch {
          // Silently ignore — extension may not be available
        }
      }

      // If it's a two-step provider, show the selection UI inline
      if (inBetweenSteps && !searchParams.refresh) {
        setTwoStepState({
          integrationId: id,
          onboarding,
          pages: pages || [],
          ...(provider === 'gmb' ? { pagesError, pagesWarnings } : {}),
          returnURL,
        });
        return;
      }

      navigateOrShow(
        `/launches?added=${provider}${onboarding ? '&onboarding=true' : ''}`,
        returnURL,
        'connected'
      );
    })();
  }, []);

  const onSave = useCallback(
    async (data: any) => {
      if (!twoStepState) return;

      setIsSaving(true);

      try {
        // Use public or authenticated endpoint based on the flow
        const endpoint = logged
          ? `/integrations/provider/${twoStepState.integrationId}/connect`
          : `/integrations/public/provider/${twoStepState.integrationId}/connect`;

        const response = await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ ...modifiedParams, ...data }),
        });

        if (provider === 'gmb') {
          const result = await readGmbResponse(response);
          if (result?.success !== true) throw new Error('GBP_SELECTION_NOT_SAVED');
        }
        if (
          response.status !== HttpStatusCode.Ok &&
          response.status !== HttpStatusCode.Created
        ) {
          // API・連携先の生エラーは顧客画面へ出さない。
          await response.json().catch(() => ({}));
          setError(true);
          return;
        }

        navigateOrShow(
          `/launches?added=${provider}${
            twoStepState.onboarding ? '&onboarding=true' : ''
          }`,
          twoStepState.returnURL,
          'connected'
        );
      } finally {
        setIsSaving(false);
      }
    },
    [twoStepState, fetch, logged, modifiedParams, provider, navigateOrShow]
  );

  const Provider = useMemo(() => {
    return (
      continueProviderList[provider as keyof typeof continueProviderList] ||
      null
    );
  }, [provider]);

  // Success state for non-logged users without returnURL
  if (successState) {
    return (
      <div data-toybaco-connection-surface="" className="flex flex-1 items-center justify-center relative overflow-hidden p-[24px]" style={{ color: 'var(--toybaco-ink, #24303f)', backgroundColor: 'var(--toybaco-surface, #fcfbf8)' }}>
        {/* Background gradient decoration */}

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[20px] font-semibold mb-[12px]">
            {t('channel_connected', 'Channel Connected!')}
          </div>
          <div className="text-[16px] text-newTextColor max-w-[400px]">
            {t(
              'channel_connected_description',
              'チャンネルを接続しました。この画面を閉じてください。'
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show the two-step selection UI
  if (twoStepState && Provider) {
    return (
      <div data-toybaco-connection-surface="" className="flex flex-1 items-center justify-center relative overflow-hidden p-[24px]" style={{ color: 'var(--toybaco-ink, #24303f)', backgroundColor: 'var(--toybaco-surface, #fcfbf8)' }}>
        {/* Background gradient decoration */}

        {/* Content */}
        <div className="relative z-10 w-full max-w-[550px] mx-auto px-[20px]">
          <div className="bg-[#1A1919] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px] text-center">
              <h1 className="text-[24px] font-semibold">
                {t('configure_your_channel', 'Configure Your Channel')}
              </h1>
              <p className="text-[14px] text-newTextColor">
                {t(
                  'select_the_page_or_account',
                  '接続するページまたはアカウントを選択してください。'
                )}
              </p>
            </div>

            <IntegrationContext.Provider
              value={{
                date: newDayjs(),
                value: [],
                allIntegrations: [],
                integration: {
                  editor: 'normal',
                  additionalSettings: '',
                  display: '',
                  time: [{ time: 0 }],
                  id: twoStepState.integrationId,
                  type: '',
                  name: '',
                  picture: '',
                  inBetweenSteps: true,
                  changeNickName: false,
                  changeProfilePicture: false,
                  identifier: provider,
                },
              }}
            >
              <Provider
                onSave={onSave}
                existingId={[]}
                initialData={twoStepState.pages}
                isSaving={isSaving}
                {...(provider === 'gmb' ? {
                  initialError: twoStepState.pagesError,
                  initialWarnings: twoStepState.pagesWarnings,
                  allowLookup: logged,
                  checkExisting: logged,
                  onClose: logged ? () => push('/launches') : undefined,
                  returnToAppUrl: props.appOrigin ? `${props.appOrigin}/app` : '/launches',
                } : {})}
              />
            </IntegrationContext.Provider>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-toybaco-connection-surface="" className="flex flex-1 items-center justify-center relative overflow-hidden p-[24px]" style={{ color: 'var(--toybaco-ink, #24303f)', backgroundColor: 'var(--toybaco-surface, #fcfbf8)' }}>
        {/* Background gradient decoration */}

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[20px] font-semibold mb-[12px]">
            {t('could_not_add_provider', 'Could not add provider')}
          </div>
          <div className="text-[16px] text-newTextColor max-w-[400px]">
            {t(
              'you_are_being_redirected_back',
              'チャンネルを追加できませんでした。もう一度お試しください。'
            )}
          </div>
          {logged && <Redirect url="/launches" delay={3000} />}
        </div>
      </div>
    );
  }

  // Loading state
  return <LoadingSurface label={t('adding_channel', 'チャンネルを接続しています')} description={t('please_wait', '接続が完了するまでお待ちください。')} />;
};
