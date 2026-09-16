'use client';

import { v5 as uuidV5 } from 'uuid';

export type ToybacoPostingOwner = { id: string; orgId: string; role: string; providerName: string };
export type ToybacoPostingContext = { documentId: string; frameId: string; accountId: string };
type PostingPhase = 'uninitialized' | 'standalone' | 'waiting' | 'context' | 'ready' | 'blocked' | 'denied';
type PostingState = {
  generation: number;
  phase: PostingPhase;
  documentId: string;
  appOrigin?: string;
  context?: ToybacoPostingContext;
  owner?: ToybacoPostingOwner;
  message: string;
  renewing?: boolean;
  reason?: 'account-mismatch' | 'context-unavailable' | 'session-changed' | 'revoked';
};
type ResponseStatus = { status: number; headers: { get(name: string): string | null } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const TOYBACO_DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT_ID = /^[1-9][0-9]{0,18}$/;
const ORG_NAMESPACE = '2ce137d1-b153-5df8-a334-f97cb11ad413';
const initial: PostingState = { generation: 0, phase: 'uninitialized', documentId: '', message: '' };
let state: PostingState = initial;
const listeners = new Set<() => void>();
const requestOwners = new WeakMap<RequestInit, PostingState>();
const requestVersions = new WeakMap<RequestInit, number>();
const copilotForwards = new WeakMap<RequestInit, PostingState>();
let releaseCopilot: (() => void) | undefined;
const changedMessage = '利用者または店舗が変わっています。入力はこの画面に残っています。元の利用者・店舗で再接続してください。';
const expiredMessage = '接続を確認できません。入力はこの画面に残っています。別タブで再接続した後、接続を確認してください。';

function update(next: PostingState) {
  state = next;
  listeners.forEach(listener => listener());
}
export const toybacoPostingSnapshot = () => state;
export const toybacoPostingServerSnapshot = () => initial;
export function toybacoPostingDocumentId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== 'function') throw new Error('TOYBACO_POSTING_SECURE_RANDOM_UNAVAILABLE');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function toybacoSubscribePosting(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function current(ticket: PostingState) {
  return ticket.generation === state.generation && ticket.documentId === state.documentId;
}
export function toybacoAssertPostingTicket(ticket: PostingState) {
  if (!current(ticket)) throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
}
function sameOwner(left: ToybacoPostingOwner, right: ToybacoPostingOwner) {
  return ['id', 'orgId', 'role', 'providerName'].every(key => left[key as keyof ToybacoPostingOwner] === right[key as keyof ToybacoPostingOwner]);
}
export function toybacoPostingOwner(value: unknown): ToybacoPostingOwner | undefined {
  if (!value || typeof value !== 'object') return;
  const owner = value as ToybacoPostingOwner;
  if (typeof owner.id !== 'string' || !UUID.test(owner.id) ||
      typeof owner.orgId !== 'string' || !UUID.test(owner.orgId) ||
      !['ADMIN', 'USER'].includes(owner.role) || owner.providerName !== 'GENERIC') return;
  return { id: owner.id, orgId: owner.orgId, role: owner.role, providerName: owner.providerName };
}
export function toybacoExpectedPostingOrganization(accountId: string) {
  if (!ACCOUNT_ID.test(accountId)) throw new Error('TOYBACO_POSTING_INVALID_ACCOUNT');
  return uuidV5('chatwoot-account:' + accountId, ORG_NAMESPACE);
}
export function toybacoBeginPosting(documentId: string, embeddedGeneric: boolean, appOrigin = '') {
  if (!TOYBACO_DOCUMENT_ID.test(documentId)) throw new Error('TOYBACO_POSTING_INVALID_DOCUMENT');
  releaseCopilot?.(); releaseCopilot = undefined;
  releaseRenewal();
  let recoveryOrigin: string | undefined;
  try {
    if (new URL(appOrigin).origin === appOrigin && new URL(appOrigin).protocol === 'https:') recoveryOrigin = appOrigin;
  } catch { /* No unvalidated recovery URL is exposed. */ }
  update({ generation: state.generation + 1, documentId, appOrigin: recoveryOrigin, phase: embeddedGeneric ? 'waiting' : 'standalone', message: '' });
  const ticket = state;
  return () => {
    if (!current(ticket)) return;
    releaseCopilot?.(); releaseCopilot = undefined;
    releaseRenewal();
    update({ generation: state.generation + 1, phase: 'uninitialized', documentId: '', message: '' });
  };
}
export function toybacoAcceptPostingContext(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const context = value as ToybacoPostingContext;
  if (context.documentId !== state.documentId || !TOYBACO_DOCUMENT_ID.test(context.documentId) ||
      typeof context.frameId !== 'string' || !TOYBACO_DOCUMENT_ID.test(context.frameId) ||
      typeof context.accountId !== 'string' || !ACCOUNT_ID.test(context.accountId)) return false;
  if (state.context) {
    return state.context.documentId === context.documentId && state.context.frameId === context.frameId && state.context.accountId === context.accountId;
  }
  if (state.phase !== 'waiting') return false;
  update({ ...state, context: { documentId: context.documentId, frameId: context.frameId, accountId: context.accountId }, phase: 'context' });
  return true;
}
export function toybacoDenyPosting(reason: 'account-mismatch' | 'context-unavailable' | 'session-changed' | 'revoked', ticket = state) {
  if (!current(ticket)) return;
  if (reason !== 'context-unavailable') {
    hardDenial += 1;
    pendingRenewal?.finish(false);
  }
  update({ ...state, phase: state.owner ? 'blocked' : 'denied', reason, message: reason === 'context-unavailable' ? expiredMessage : reason === 'revoked' ? 'この店舗を利用する権限を確認できません。管理者に確認してください。入力はこの画面に残っています。' : changedMessage });
}
function headersFor(ticket: PostingState, verification = false): Record<string, string> {
  if (!current(ticket) || !state.owner || (state.phase !== 'ready' && !(verification && state.phase === 'blocked'))) {
    throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
  }
  return {
    'x-toybaco-composer-user-id': state.owner.id,
    'x-toybaco-composer-organization-id': state.owner.orgId,
    'x-toybaco-composer-role': state.owner.role,
  };
}
function observeResponse(response: ResponseStatus, ticket: PostingState, version = sessionVersion) {
  if (!current(ticket)) return false;
  const echoed = response.headers.get('x-toybaco-session-version');
  if (version !== sessionVersion || (echoed !== null && echoed !== String(sessionVersion))) return true;
  const changed = response.status === 409 && response.headers.get('x-toybaco-session') === 'identity-changed';
  if (response.status !== 401 && !response.headers.get('logout') && !changed) return false;
  const session = response.headers.get('x-toybaco-session');
  toybacoDenyPosting(changed ? 'session-changed' : session === 'revoked' ? 'revoked' : 'context-unavailable', ticket);
  // Only an explicit backend expiry/missing-cookie classification may renew.
  // The failed operation itself is returned untouched and is never replayed.
  if (!changed && response.status === 401 && ['expired', 'missing'].includes(session || '')) void renewPosting();
  return true;
}
export async function toybacoPostingBeforeRequest(url: string, options: RequestInit, ticket = state): Promise<RequestInit> {
  if (!current(ticket)) throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
  // Auth pages and non-posting consumers have no active posting boundary.
  if (state.phase === 'uninitialized' || (state.phase === 'standalone' && !state.owner)) return options;
  if (url === '/user/logout') { releaseRenewal(); return options; }
  if (url.startsWith('/auth/')) return options;
  if (state.owner && (pendingRenewal || (state.phase === 'ready' && renewalDue()))) await renewPosting();
  if (!current(ticket)) throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
  let next = { ...options };
  if (!state.owner) {
    if (url !== '/user/self' || state.phase !== 'context') throw new Error('TOYBACO_POSTING_CONTEXT_REQUIRED');
  } else {
    const headers = new Headers(options.headers);
    Object.entries(headersFor(ticket)).forEach(([key, value]) => headers.set(key, value));
    const merged: Record<string, string> = {};
    headers.forEach((value, key) => { merged[key] = value; });
    next = { ...options, headers: merged };
  }
  requestOwners.set(next, ticket);
  requestVersions.set(next, sessionVersion);
  return next;
}
export function toybacoPostingAfterResponse(url: string, options: RequestInit, response: ResponseStatus) {
  const ticket = requestOwners.get(options);
  if (!ticket) return false;
  // An old response must not invoke global logout behavior in a newer shell.
  if (!current(ticket)) return true;
  if (url === '/user/self' && !state.owner && [401, 403, 409].includes(response.status)) {
    toybacoDenyPosting('context-unavailable', ticket);
    return true;
  }
  return observeResponse(response, ticket, requestVersions.get(options));
}

export function toybacoPostingCopilotHeaders(owner = state.owner, documentId = state.documentId) {
  if (!owner) return undefined;
  // SDK configuration retains identity across a blocked-state render. The
  // transport checks the active generation and phase immediately before send.
  return {
    'x-toybaco-composer-user-id': owner.id,
    'x-toybaco-composer-organization-id': owner.orgId,
    'x-toybaco-composer-role': owner.role,
    'x-toybaco-posting-document-id': documentId,
  };
}

// The installed self-hosted Copilot SDK uses global fetch and has no fetch prop.
// Wrap only its configured runtime endpoint; leave bodies and streams untouched.
export function toybacoInstallCopilotTransport(runtimeUrl: string, ticket = state) {
  const original = window.fetch;
  const target = new URL(runtimeUrl, window.location.href);
  let active = true;
  const wrapped: typeof window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== target.origin || url.pathname !== target.pathname) return original.call(window, input, init);
    // A newer owned wrapper may forward through this inactive wrapper. Direct
    // calls retained by a disposed SDK must never bypass its old boundary.
    if (!active) {
      const forwarded = init && copilotForwards.get(init);
      if (forwarded && current(forwarded)) {
        headersFor(forwarded);
        return original.call(window, input, init);
      }
      const retiredHeaders = new Headers(init?.headers !== undefined ? init.headers : input instanceof Request ? input.headers : undefined);
      if (['x-toybaco-posting-document-id', 'x-toybaco-composer-user-id', 'x-toybaco-composer-organization-id', 'x-toybaco-composer-role'].some(key => retiredHeaders.has(key))) {
        throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
      }
      return original.call(window, input, init);
    }
    const headers = new Headers(init?.headers !== undefined ? init.headers : input instanceof Request ? input.headers : undefined);
    if (pendingRenewal || (state.phase === 'ready' && renewalDue())) await renewPosting();
    const expected = headersFor(ticket);
    const version = sessionVersion;
    if (headers.get('x-toybaco-posting-document-id') !== ticket.documentId ||
        Object.entries(expected).some(([key, value]) => headers.get(key) !== value)) {
      throw new Error('TOYBACO_COMPOSER_RECONNECT_REQUIRED');
    }
    const forwarded = { ...init, headers };
    copilotForwards.set(forwarded, ticket);
    const response = await original.call(window, input, forwarded);
    if (active) observeResponse(response, ticket, version);
    return response;
  };
  window.fetch = wrapped;
  return () => {
    active = false;
    // Keep a credential-free retired filter for an SDK resolving global fetch
    // after unmount but before the next shell. Unmarked standalone calls pass.
    // Never replace a wrapper installed by another owner.
  };
}
export function toybacoPostingUploadGuard() {
  if (!state.owner) return undefined;
  const ticket = state;
  return {
    beforeRequest: () => ({ ...headersFor(ticket), 'x-toybaco-session-version': String(sessionVersion) }),
    afterResponse: (status: number, headers: { get(name: string): string | null }) => observeResponse({ status, headers }, ticket),
  };
}
export async function toybacoLoadPostingIdentity(
  fetch: (url: string, options?: RequestInit) => Promise<Response>,
  backendUrl: string,
  ticket = state
) {
  if (!current(ticket)) throw new Error('TOYBACO_POSTING_STALE_RESPONSE');
  if (!['context', 'standalone', 'ready'].includes(ticket.phase)) throw new Error('TOYBACO_POSTING_CONTEXT_REQUIRED');
  try {
    const response = await fetch('/user/self');
    if (!current(ticket) || (!state.owner && !['context', 'standalone'].includes(state.phase))) throw new Error('TOYBACO_POSTING_STALE_RESPONSE');
    if (!response.ok) throw new Error('TOYBACO_POSTING_IDENTITY_UNAVAILABLE');
    const user = await response.json();
    if (!current(ticket) || (!state.owner && !['context', 'standalone'].includes(state.phase))) throw new Error('TOYBACO_POSTING_STALE_RESPONSE');
    if (!user || typeof user !== 'object' || typeof user.id !== 'string' || typeof user.orgId !== 'string') throw new Error('TOYBACO_POSTING_IDENTITY_INVALID');
    if (!ticket.context && user.providerName !== 'GENERIC') return user;
    const owner = toybacoPostingOwner(user);
    if (!owner || (ticket.context && owner.orgId !== toybacoExpectedPostingOrganization(ticket.context.accountId)) ||
        (state.owner && !sameOwner(state.owner, owner))) {
      toybacoDenyPosting('account-mismatch', ticket);
      throw new Error('TOYBACO_POSTING_IDENTITY_CHANGED');
    }
    if (!state.owner) {
      // Pin synchronously before resolving the bootstrap and mounting children.
      state = { ...state, owner, phase: 'ready', message: '' };
      releaseCopilot = toybacoInstallCopilotTransport(backendUrl + '/copilot/chat', state);
      listeners.forEach(listener => listener());
      acceptSessionExpiry(response, backendUrl);
    }
    return user;
  } catch (error) {
    if (current(ticket) && state.phase !== 'blocked' && state.phase !== 'denied') toybacoDenyPosting('context-unavailable', ticket);
    throw error;
  }
}
export async function toybacoVerifyPostingIdentity(backendUrl: string) {
  const ticket = state;
  const denial = hardDenial;
  const version = sessionVersion;
  if (!ticket.owner) return false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Both response headers and the streamed body share the same deadline.
    // The losing read never updates identity, even if abort is ignored.
    const read = (async () => {
      const response = await window.fetch(backendUrl + '/user/self', {
        credentials: 'include', cache: 'no-store', headers: headersFor(ticket, true), signal: controller.signal,
      });
      if (!current(ticket) || denial !== hardDenial || version !== sessionVersion) throw new Error('TOYBACO_POSTING_STALE_RESPONSE');
      if (!response.ok) { observeResponse(response, ticket, version); throw new Error('TOYBACO_POSTING_IDENTITY_UNAVAILABLE'); }
      return { user: await response.json(), response };
    })();
    const result = await Promise.race([read, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('TOYBACO_POSTING_IDENTITY_TIMEOUT'));
      }, 15000);
    })]);
    if (!current(ticket) || denial !== hardDenial || version !== sessionVersion) return false;
    const owner = toybacoPostingOwner(result.user);
    if (!owner || !sameOwner(ticket.owner, owner)) { toybacoDenyPosting('session-changed', ticket); return false; }
    update({ ...state, phase: 'ready', message: '', reason: undefined, renewing: false });
    acceptSessionExpiry(result.response, backendUrl);
    return true;
  } catch {
    if (current(ticket) && denial === hardDenial && version === sessionVersion && (!state.reason || state.reason === 'context-unavailable')) toybacoDenyPosting('context-unavailable', ticket);
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Renewal changes the HttpOnly credential, never the mounted document or draft.
// One attempt per accepted session; only a fresh same-owner verification enables
// another scheduled attempt. Failed requests and uploads are never replayed.
let sessionVersion = 0;
let sessionExpiresAt = 0;
let renewalBackend = '';
let renewalSequence = 0;
let attemptedVersion = -1;
let hardDenial = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let renewalListeners: (() => void) | undefined;
let pendingRenewal: { requestId: string; requestSequence: number; ticket: PostingState; promise: Promise<boolean>; finish(ok: boolean): void } | undefined;

function renewalDue() {
  return !!sessionExpiresAt && Date.now() >= sessionExpiresAt * 1000 - 60000;
}

function releaseRenewal() {
  hardDenial += 1;
  pendingRenewal?.finish(false);
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  expiryTimer = undefined;
  renewalListeners?.(); renewalListeners = undefined;
  sessionExpiresAt = 0; renewalBackend = ''; renewalSequence = 0;
  sessionVersion += 1; attemptedVersion = -1;
}

function acceptSessionExpiry(response: ResponseStatus, backendUrl: string) {
  const raw = response.headers.get('x-toybaco-session-expires-at');
  const expiry = Number(raw);
  if (!raw || !/^[1-9][0-9]{0,11}$/.test(raw) || !Number.isSafeInteger(expiry) ||
      expiry <= Math.floor(Date.now() / 1000) || expiry > Math.floor(Date.now() / 1000) + 600 ||
      !state.owner || !state.context || !state.appOrigin || window.parent === window) return;
  renewalBackend = backendUrl;
  if (sessionExpiresAt !== expiry) sessionVersion += 1;
  sessionExpiresAt = expiry;
  if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  const visibleRenew = () => {
    if (document.visibilityState !== 'hidden' && state.phase === 'ready' && renewalDue()) void renewPosting();
  };
  if (!renewalListeners) {
    const onResult = (event: MessageEvent) => {
      const pending = pendingRenewal;
      if (!pending || !current(pending.ticket) || event.origin !== state.appOrigin || event.source !== window.parent) return;
      const value = event.data;
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).sort().join(',') !== 'accountId,documentId,frameId,ok,requestId,requestSequence,type' ||
          value.type !== 'TOYBACO_POSTIZ_RENEW_RESULT' || value.requestId !== pending.requestId ||
          value.requestSequence !== pending.requestSequence || value.documentId !== pending.ticket.documentId ||
          value.frameId !== pending.ticket.context?.frameId || value.accountId !== pending.ticket.context?.accountId ||
          typeof value.ok !== 'boolean') return;
      pending.finish(value.ok);
    };
    window.addEventListener('message', onResult);
    document.addEventListener('visibilitychange', visibleRenew);
    renewalListeners = () => {
      window.removeEventListener('message', onResult);
      document.removeEventListener('visibilitychange', visibleRenew);
    };
  }
  expiryTimer = setTimeout(visibleRenew, Math.max(0, expiry * 1000 - Date.now() - 60000));
}

async function renewPosting(): Promise<boolean> {
  if (pendingRenewal) return pendingRenewal.promise;
  const ticket = state;
  if (!renewalBackend || !ticket.owner || !ticket.context || !ticket.appOrigin ||
      !['ready', 'blocked'].includes(ticket.phase) ||
      (ticket.reason && ticket.reason !== 'context-unavailable') || attemptedVersion === sessionVersion) return false;
  attemptedVersion = sessionVersion;
  const version = sessionVersion;
  const requestId = toybacoPostingDocumentId();
  const requestSequence = ++renewalSequence;
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  let settled = false;
  let verifying = false;
  const cancelMessage = () => window.parent.postMessage({ type: 'TOYBACO_POSTIZ_RENEW_CANCEL',
    ...ticket.context, requestId, requestSequence }, ticket.appOrigin!);
  const finish = (ok: boolean) => {
    if (settled || (verifying && ok)) return;
    if (ok) {
      verifying = true;
      void toybacoVerifyPostingIdentity(renewalBackend).then(valid => settle(valid));
    } else settle(false);
  };
  const settle = (ok: boolean) => {
    if (settled) return;
    settled = true;
    if (!ok && version === sessionVersion) hardDenial += 1;
    clearTimeout(timer);
    if (pendingRenewal?.requestId === requestId) pendingRenewal = undefined;
    cancelMessage();
    if (current(ticket) && state.renewing) update({ ...state, renewing: false });
    if (current(ticket) && !ok && version === sessionVersion && (!state.reason || state.reason === 'context-unavailable')) toybacoDenyPosting('context-unavailable', ticket);
    resolve(ok && current(ticket));
  };
  const timer = setTimeout(() => finish(false), 25000);
  pendingRenewal = { requestId, requestSequence, ticket, promise, finish };
  update({ ...state, phase: 'blocked', renewing: true, message: '接続を更新しています。入力はそのまま続けられます。', reason: 'context-unavailable' });
  window.parent.postMessage({ type: 'TOYBACO_POSTIZ_RENEW_REQUEST', ...ticket.context,
    requestId, requestSequence, owner: { ...ticket.owner } }, ticket.appOrigin);
  return promise;
}
