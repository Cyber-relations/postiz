'use client';

import { ReactNode, useCallback } from 'react';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
// toybaco_composer_session_v1: keep the mounted editor; never retry a post.
type ToybacoComposerOwner = {
  id: string;
  orgId: string;
  role: string;
  providerName: string;
};
type ToybacoComposerSession = {
  owner: ToybacoComposerOwner;
  blocked: boolean;
  notify: (message: string) => void;
};
let toybacoComposerSession: ToybacoComposerSession | undefined;
const toybacoSessionExpired = '接続が切れています。入力はこの画面に残っています。別タブで再接続し、この画面に戻って接続を確認してください。';
const toybacoSessionChanged = '利用者または店舗が変わっています。入力は残しています。元の利用者・店舗で再接続してください。';

export function toybacoRegisterComposer(
  owner: ToybacoComposerOwner | undefined,
  notify: (message: string) => void
) {
  const current: ToybacoComposerSession | undefined = owner?.providerName === 'GENERIC'
    ? { owner: { id: owner.id, orgId: owner.orgId, role: owner.role, providerName: owner.providerName }, blocked: false, notify }
    : undefined;
  if (current) toybacoComposerSession = current;
  return {
    verify(next: Partial<ToybacoComposerOwner> | null) {
      if (!current || toybacoComposerSession !== current) return false;
      const matches = !!next && ['id', 'orgId', 'role', 'providerName'].every(
        (key) => typeof current.owner[key as keyof ToybacoComposerOwner] === 'string' &&
          current.owner[key as keyof ToybacoComposerOwner].length > 0 &&
          next[key as keyof ToybacoComposerOwner] === current.owner[key as keyof ToybacoComposerOwner]
      );
      current.blocked = !matches;
      current.notify(matches ? '' : toybacoSessionChanged);
      return matches;
    },
    dispose() {
      if (toybacoComposerSession === current) toybacoComposerSession = undefined;
    },
  };
}

export async function toybacoComposerBeforeRequest(url: string, options: RequestInit): Promise<RequestInit> {
  // Deliberate logout retains its existing confirmation and discard behavior.
  if (url === '/user/logout') {
    toybacoComposerSession = undefined;
    return options;
  }
  const current = toybacoComposerSession;
  if (!current || url === '/user/self') return options;
  if (current.blocked) throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
  const headers = new Headers(options.headers);
  headers.set('x-toybaco-composer-user-id', current.owner.id);
  headers.set('x-toybaco-composer-organization-id', current.owner.orgId);
  headers.set('x-toybaco-composer-role', current.owner.role);
  return { ...options, headers: Object.fromEntries(headers.entries()) };
}

export function toybacoComposerAfterResponse(url: string, response: Response): boolean {
  if (url === '/user/logout') return false;
  const current = toybacoComposerSession;
  if (!current) return false;
  const changed = response.status === 409 && response.headers.get('x-toybaco-session') === 'identity-changed';
  if (response.status !== 401 && !response.headers.get('logout') && !changed) return false;
  current.blocked = true;
  current.notify(changed ? toybacoSessionChanged : toybacoSessionExpired);
  return true;
}
// toybaco_composer_session_end

export default function LayoutContext(params: { children: ReactNode }) {
  if (params?.children) {
    // eslint-disable-next-line react/no-children-prop
    return <LayoutContextInner children={params.children} />;
  }
  return <></>;
}
export function setCookie(cname: string, cvalue: string, exdays: number) {
  if (typeof document === 'undefined') {
    return;
  }
  const d = new Date();
  d.setTime(d.getTime() + exdays * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = cname + '=' + cvalue + ';' + expires + ';path=/';
}
function LayoutContextInner(params: { children: ReactNode }) {
  const returnUrl = useReturnUrl();
  const { backendUrl, isGeneral, isSecured } = useVariables();
  const afterRequest = useCallback(
    async (url: string, options: RequestInit, response: Response) => {
      if (toybacoComposerAfterResponse(url, response)) return true;
      if (
        typeof window !== 'undefined' &&
        (window.location.href.includes('/p/') ||
          window.location.pathname.startsWith('/provider/'))
      ) {
        return true;
      }
      const headerAuth =
        response?.headers?.get('auth') || response?.headers?.get('Auth');
      const showOrg =
        response?.headers?.get('showorg') || response?.headers?.get('Showorg');
      const impersonate =
        response?.headers?.get('impersonate') ||
        response?.headers?.get('Impersonate');
      const logout =
        response?.headers?.get('logout') || response?.headers?.get('Logout');
      if (headerAuth) {
        setCookie('auth', headerAuth, 365);
      }
      if (showOrg) {
        setCookie('showorg', showOrg, 365);
      }
      if (impersonate) {
        setCookie('impersonate', impersonate, 365);
      }
      if (logout && !isSecured) {
        setCookie('auth', '', -10);
        setCookie('showorg', '', -10);
        setCookie('impersonate', '', -10);
        window.location.href = '/';
        return true;
      }
      const reloadOrOnboarding =
        response?.headers?.get('reload') ||
        response?.headers?.get('onboarding');
      if (reloadOrOnboarding) {
        const getAndClear = returnUrl.getAndClear();
        if (getAndClear) {
          window.location.href = getAndClear;
          return true;
        }
      }
      if (response?.headers?.get('onboarding')) {
        window.location.href = isGeneral
          ? '/launches?onboarding=true'
          : '/analytics?onboarding=true';
        return true;
      }

      if (response?.headers?.get('reload')) {
        window.location.reload();
        return true;
      }

      if (response.status === 401 || response?.headers?.get('logout')) {
        if (!isSecured) {
          setCookie('auth', '', -10);
          setCookie('showorg', '', -10);
          setCookie('impersonate', '', -10);
        }
        window.location.href = '/';
      }
      if (response.status === 406) {
        if (
          await deleteDialog(
            'You are currently on trial, in order to use the feature you must finish the trial',
            'Finish the trial, charge me now',
            'Trial',

          )
        ) {
          window.open('/billing?finishTrial=true', '_blank');
          return false;
        }
        return false;
      }

      if (response.status === 402) {
        if (
          await deleteDialog(
            (
              await response.json()
            ).message,
            'Move to billing',
            'Payment Required'
          )
        ) {
          window.open('/billing', '_blank');
          return false;
        }
        return true;
      }
      return true;
    },
    []
  );
  return (
    <FetchWrapperComponent baseUrl={backendUrl} beforeRequest={toybacoComposerBeforeRequest} afterRequest={afterRequest}>
      {params?.children || <></>}
    </FetchWrapperComponent>
  );
}
