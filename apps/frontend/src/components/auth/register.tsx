'use client';

import { FormProvider, SubmitHandler, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { GithubProvider } from '@gitroom/frontend/components/auth/providers/github.provider';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';
import { GoogleProvider } from '@gitroom/frontend/components/auth/providers/google.provider';
import { AppleProvider } from '@gitroom/frontend/components/auth/providers/apple.provider';
import { OauthProvider } from '@gitroom/frontend/components/auth/providers/oauth.provider';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useTrack } from '@gitroom/react/helpers/use.track';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { FarcasterProvider } from '@gitroom/frontend/components/auth/providers/farcaster.provider';
import dynamic from 'next/dynamic';
import { WalletUiProvider } from '@gitroom/frontend/components/auth/providers/placeholder/wallet.ui.provider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
const WalletProvider = dynamic(
  () => import('@gitroom/frontend/components/auth/providers/wallet.provider'),
  {
    ssr: false,
    loading: () => <WalletUiProvider />,
  }
);
type Inputs = {
  email: string;
  password: string;
  company: string;
  providerToken: string;
  provider: string;
};
// toybaco_identity_boundary_v1: completion uses only this verified flow's return.
function toybacoCallbackReturn(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2000 ||
      !/^\/[A-Za-z0-9._~/?=&-]*$/.test(value) || value.includes('%') ||
      value.includes('\\') || value.includes('#')) return null;
  if (value.split('?', 1)[0].split('/').some((part) => part === '.' || part === '..')) return null;
  let target: URL;
  try { target = new URL(value, 'https://post.toybaco.invalid'); } catch { return null; }
  if (target.origin !== 'https://post.toybaco.invalid' ||
      !['/launches', '/analytics', '/media', '/settings'].some((path) =>
        target.pathname === path || target.pathname.startsWith(`${path}/`)) ||
      [...target.searchParams.keys()].some((key) =>
        ['code', 'state', 'error', 'id_token', 'error_description', 'access_token'].includes(key.toLowerCase()))) return null;
  return target.pathname + target.search;
}

export function Register() {
  const getQuery = useSearchParams();
  const fetch = useFetch();
  const [provider] = useState(getQuery?.get('provider')?.toUpperCase());
  const [code, setCode] = useState(getQuery?.get('code') || '');
  const [state] = useState(getQuery?.get('state') || '');
  const [providerError] = useState(getQuery?.get('error') || undefined);
  const [invalidGeneric] = useState(() =>
    getQuery?.getAll('state').length !== 1 || getQuery?.getAll('provider').length !== 1 ||
    (getQuery?.getAll('code').length || 0) > 1 || (getQuery?.getAll('error').length || 0) > 1 ||
    Boolean(getQuery?.has('id_token')) || !/^toybaco-[A-Za-z0-9_-]{43}$/.test(state) ||
    Boolean(code) === Boolean(providerError) || (getQuery?.has('code') && !code) ||
    (getQuery?.has('error') && !providerError) || code.length > 2048 || (providerError?.length || 0) > 200
  );
  const [show, setShow] = useState(false);
  const started = useRef(false);
  const alive = useRef(false);
  const load = useCallback(async () => {
    if (provider === 'GENERIC') {
      try {
        if (invalidGeneric) throw new Error('Invalid callback');
        const response = await fetch('/auth/oauth/GENERIC/exists', {
          method: 'POST', credentials: 'include',
          body: JSON.stringify({ code: code || undefined, state, error: providerError }),
        });
        const result: unknown = await response.json();
        // A server-authenticated renewal completes only its owned hidden frame.
        // Normal login retains its exact response/return contract below.
        if (result && typeof result === 'object' && !Array.isArray(result) &&
            Object.keys(result).sort().join(',') === 'appOrigin,renewal' &&
            'renewal' in result && 'appOrigin' in result && typeof result.appOrigin === 'string') {
          const completion = result.renewal as Record<string, unknown>;
          const app = new URL(result.appOrigin);
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
          if (!completion || typeof completion !== 'object' || Array.isArray(completion) ||
              Object.keys(completion).sort().join(',') !== 'accountId,documentId,frameId,ok,requestId' ||
              !['requestId', 'documentId', 'frameId'].every(key => typeof completion[key] === 'string' && uuid.test(completion[key] as string)) ||
              typeof completion.accountId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(completion.accountId) ||
              typeof completion.ok !== 'boolean' || completion.ok !== response.ok ||
              app.origin !== result.appOrigin || app.protocol !== 'https:' || app.username || app.password ||
              window.parent === window) throw new Error('Invalid renewal completion');
          if (alive.current) {
            window.history.replaceState(null, '', '/auth?provider=GENERIC&tb_embed=1');
            window.parent.postMessage({ type: 'TOYBACO_POSTIZ_RENEW_COMPLETE', ...completion }, app.origin);
          }
          return;
        }
        if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result) ||
            Object.keys(result).sort().join(',') !== 'login,returnPath' ||
            !('login' in result) || result.login !== true || !('returnPath' in result)) {
          throw new Error('Callback was not accepted');
        }
        const returnPath = toybacoCallbackReturn(result.returnPath);
        if (!returnPath) throw new Error('Invalid callback return');
        if (alive.current) window.location.replace(returnPath);
      } catch {
        // Remove callback credentials; the proxy renders its existing neutral recovery.
        if (alive.current) window.location.replace('/auth?provider=GENERIC' + (window.parent !== window ? '&tb_embed=1' : ''));
      }
      return;
    }
    const { token } = await (
      await fetch(`/auth/oauth/${provider?.toUpperCase() || 'LOCAL'}/exists`, {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      })
    ).json();
    if (token) {
      setCode(token);
      setShow(true);
    }
  }, [provider, code, state, providerError, invalidGeneric, fetch]);
  useEffect(() => {
    alive.current = true;
    if (!started.current && provider && (code || provider === 'GENERIC')) {
      started.current = true;
      void load();
    }
    return () => { alive.current = false; };
  }, [provider, code, load]);
  if (!code && !provider) {
    return <RegisterAfter token="" provider="LOCAL" />;
  }
  if (!show) {
    return <LoadingComponent />;
  }
  return (
    <RegisterAfter token={code} provider={provider?.toUpperCase() || 'LOCAL'} />
  );
}
function getHelpfulReasonForRegistrationFailure(httpCode: number) {
  switch (httpCode) {
    case 400:
      return 'Email already exists';
    case 404:
      return 'Your browser got a 404 when trying to contact the API, the most likely reasons for this are the NEXT_PUBLIC_BACKEND_URL is set incorrectly, or the backend is not running.';
  }
  return 'Unhandled error: ' + httpCode;
}
export function RegisterAfter({
  token,
  provider,
}: {
  token: string;
  provider: string;
}) {
  const t = useT();
  const {
    isGeneral,
    genericOauth,
    neynarClientId,
    appleClientId,
    billingEnabled,
  } = useVariables();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const fireEvents = useFireEvents();
  const track = useTrack();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');
  const isAfterProvider = useMemo(() => {
    return !!token && !!provider;
  }, [token, provider]);
  const resolver = useMemo(() => {
    return classValidatorResolver(CreateOrgUserDto);
  }, []);
  const form = useForm<Inputs>({
    resolver,
    defaultValues: {
      providerToken: token,
      provider: provider,
    },
  });
  const fetchData = useFetch();
  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    setLoading(true);
    await fetchData('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        datafast_visitor_id,
      }),
    })
      .then(async (response) => {
        setLoading(false);
        if (response.status === 200) {
          fireEvents('register');
          return track(TrackEnum.CompleteRegistration).then(() => {
            if (response.headers.get('activate') === 'true') {
              router.push('/auth/activate');
            } else {
              router.push('/auth/login');
            }
          });
        } else {
          form.setError('email', {
            message: await response.text(),
          });
        }
      })
      .catch((e) => {
        form.setError('email', {
          message:
            'General error: ' +
            e.toString() +
            '. Please check your browser console.',
        });
      });
  };
  return (
    <FormProvider {...form}>
      <form className="flex-1 flex" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col flex-1">
          <div>
            <h1 className="text-[40px] font-[500] -tracking-[0.8px] text-start cursor-pointer">
              {t('sign_up', 'Sign Up')}
            </h1>
          </div>
          <div className="text-[14px] mt-[32px] mb-[12px]">
            {t('continue_with', 'Continue With')}
          </div>
          <div className="flex flex-col text-[14px]">
            {!isAfterProvider &&
              (!isGeneral ? (
                <GithubProvider />
              ) : (
                <div className="gap-[8px] flex">
                  {genericOauth && isGeneral ? (
                    <OauthProvider />
                  ) : (
                    <GoogleProvider />
                  )}
                  {!!appleClientId && <AppleProvider />}
                  {!!neynarClientId && <FarcasterProvider />}
                  {billingEnabled && <WalletProvider />}
                </div>
              ))}
            {!isAfterProvider && (
              <div className="h-[20px] mb-[24px] mt-[24px] relative">
                <div className="absolute w-full h-[1px] bg-fifth top-[50%] -translate-y-[50%]" />
                <div
                  className={`absolute z-[1] justify-center items-center w-full start-0 -top-[4px] flex`}
                >
                  <div className="px-[16px]">{t('or', 'or')}</div>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-[12px]">
              <div className="text-textColor">
                {!isAfterProvider && (
                  <>
                    <Input
                      label="Email"
                      translationKey="label_email"
                      {...form.register('email')}
                      type="email"
                      placeholder={t('email_address', 'Email Address')}
                    />
                    <Input
                      label="Password"
                      translationKey="label_password"
                      {...form.register('password')}
                      autoComplete="off"
                      type="password"
                      placeholder={t('label_password', 'Password')}
                    />
                  </>
                )}
                <Input
                  label="Company"
                  translationKey="label_company"
                  {...form.register('company')}
                  autoComplete="off"
                  type="text"
                  placeholder={t('label_company', 'Company')}
                />
              </div>
              <div className={clsx('text-[12px]')}>
                {t(
                  'by_registering_you_agree_to_our',
                  'By registering you agree to our'
                )}
                &nbsp;
                <a
                  href={`https://toybaco.jp/terms/`}
                  className="underline hover:font-bold"
                  rel="nofollow"
                >
                  {t('terms_of_service', 'Terms of Service')}
                </a>
                &nbsp;
                {t('and', 'and')}&nbsp;
                <a
                  href={`https://toybaco.jp/privacy/`}
                  rel="nofollow"
                  className="underline hover:font-bold"
                >
                  {t('privacy_policy', 'Privacy Policy')}
                </a>
                &nbsp;
              </div>
              <div className="text-center mt-6">
                <div className="w-full flex">
                  <Button
                    type="submit"
                    className="flex-1 rounded-[10px] !h-[52px]"
                    loading={loading}
                  >
                    {t('create_account', 'Create Account')}
                  </Button>
                </div>
                <p className="mt-4 text-sm">
                  {t('already_have_an_account', 'Already Have An Account?')}
                  &nbsp;
                  <Link
                    href="/auth/login"
                    className="underline  cursor-pointer"
                  >
                    {t('sign_in', 'Sign In')}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
