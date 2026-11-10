import { createHash, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// A per-attempt host-only cookie is shared by the page and its popup, but is
// never sent to the provider or copied through URLs/postMessage. X's OAuth 1
// request token is also a state; hash it to a fixed, cookie-safe name.
const lifetime = 3600;
const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' as const };
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
function cookieName(state: string) {
  if (typeof state !== 'string' || !state || state.length > 1024) {
    throw new HttpException('Invalid connection state', 400);
  }
  return '__Host-toybaco_connect_' + digest(state);
}
export async function startConnectBrowser(state: string, provider: string, organization: string, res: Response) {
  const name = cookieName(state);
  const nonce = randomBytes(32).toString('base64url');
  const value = JSON.stringify({ nonce: digest(nonce), provider, organization });
  if (await ioRedis.set('connect-browser:' + state, value, 'EX', lifetime, 'NX') !== 'OK') {
    throw new HttpException('Invalid connection state', 400);
  }
  res.cookie(name, nonce, { ...cookieOptions, maxAge: lifetime * 1000 });
}

// Compare AND consume atomically. Wrong browsers/providers must neither attach
// an account nor burn the legitimate browser's pending attempt.
const consume = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local binding = cjson.decode(value)
if binding.nonce ~= ARGV[1] or binding.provider ~= ARGV[2] then return nil end
redis.call('DEL', KEYS[1])
return binding.organization
`;
function browserNonce(state: string, req: Request) {
  const nonce = req.cookies?.[cookieName(state)];
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    throw new HttpException('Invalid connection state', 400);
  }
  return digest(nonce);
}
export async function consumeConnectBrowser(state: string, provider: string, req: Request) {
  const organization = await ioRedis.eval(consume, 1, 'connect-browser:' + state, browserNonce(state, req), provider);
  if (typeof organization !== 'string' || !organization) {
    throw new HttpException('Invalid connection state', 400);
  }
  return organization;
}
export function clearConnectBrowser(state: string, res: Response) {
  res.clearCookie(cookieName(state), cookieOptions);
}

// The public second step must be bound too: state alone must not select a page
// for an arbitrary integration. Its ticket is issued only AFTER OAuth succeeds.
export async function allowConnectPages(state: string, id: string, organization: string, req: Request) {
  await ioRedis.set('connect-pages:' + state, JSON.stringify({
    nonce: browserNonce(state, req), provider: id, organization,
  }), 'EX', lifetime);
}

// Ticket transitions preserve the original TTL. A reservation may be retried
// after a lost completion response; the integration lock and persisted choice
// in the service decide whether any provider/database mutation is still needed.
const pageTransition = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local binding = cjson.decode(value)
if binding.nonce ~= ARGV[1] or binding.provider ~= ARGV[2] then return nil end
local action = ARGV[3]
if action == 'read' then return value end
if action == 'reserve' then
  if binding.status == 'complete' then
    if binding.selection ~= ARGV[4] then return cjson.encode({status='different'}) end
    return cjson.encode({status='complete', result=binding.result})
  end
  if binding.status == 'reserved' then
    if binding.selection ~= ARGV[4] then return cjson.encode({status='different'}) end
    return cjson.encode({status='busy', organization=binding.organization, reservation=binding.reservation})
  end
  binding.status = 'reserved'
  binding.selection = ARGV[4]
  binding.reservation = ARGV[5]
elseif action == 'complete' and binding.status == 'complete' and binding.reservation == ARGV[5] then
  -- A retry can finish recording the already persisted choice.
  return value
elseif binding.status ~= 'reserved' or binding.reservation ~= ARGV[5] then
  return nil
elseif action == 'release' then
  binding.status = 'pending'
  binding.reservation = nil
  binding.selection = nil
elseif action == 'complete' then
  binding.status = 'complete'
  binding.result = cjson.decode(ARGV[6])
else
  return nil
end
redis.call('SET', KEYS[1], cjson.encode(binding), 'KEEPTTL')
return cjson.encode({status='reserved', organization=binding.organization, reservation=binding.reservation})
`;
type PageReservation =
  | { status: 'reserved' | 'busy'; organization: string; reservation: string }
  | { status: 'complete'; result: { success: boolean } };
export async function reserveConnectPages(state: string, id: string, body: any, req: Request): Promise<PageReservation> {
  // These are the selection inputs used by Toybaco's two-step providers (FB/GBP).
  // A successful retry for a different page must not report a false success.
  const selection = digest(JSON.stringify([body.page, body.id, body.accountName, body.locationName]));
  const result = await ioRedis.eval(pageTransition, 1, 'connect-pages:' + state,
    browserNonce(state, req), id, 'reserve', selection, randomBytes(32).toString('base64url'), '');
  if (typeof result !== 'string' || !result) throw new HttpException('Invalid connection state', 400);
  const ticket = JSON.parse(result);
  if (ticket.status === 'different') throw new HttpException('This connection already selected a different page', 409);
  return ticket;
}
export async function readConnectPages(state: string, id: string, req: Request): Promise<{ organization: string }> {
  const value = await ioRedis.eval(pageTransition, 1, 'connect-pages:' + state,
    browserNonce(state, req), id, 'read', '', '', '');
  if (typeof value !== 'string' || !value) throw new HttpException('Invalid connection state', 400);
  const ticket = JSON.parse(value);
  if (ticket.status === 'complete') throw new HttpException('This connection is no longer pending', 409);
  return { organization: ticket.organization };
}
export async function releaseConnectPages(state: string, id: string, reservation: string, req: Request) {
  await ioRedis.eval(pageTransition, 1, 'connect-pages:' + state,
    browserNonce(state, req), id, 'release', '', reservation, '');
}
export async function completeConnectPages(state: string, id: string, reservation: string, result: { success: boolean }, req: Request) {
  const completed = await ioRedis.eval(pageTransition, 1, 'connect-pages:' + state,
    browserNonce(state, req), id, 'complete', '', reservation, JSON.stringify(result));
  if (!completed) throw new HttpException('Unable to record page selection result', 503);
}

// Serialize all selection tickets (and authenticated selections) for this row.
// An expired owner must neither write nor delete a replacement owner's lock.
const selectionLockKey = (id: string) => 'connect-selection-lock:' + id;
const releaseSelectionLock = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;
export async function lockConnectSelection(id: string) {
  const owner = randomBytes(32).toString('base64url');
  if (await ioRedis.set(selectionLockKey(id), owner, 'EX', 30, 'NX') !== 'OK') {
    throw new HttpException('Page selection is already in progress. Retry shortly.', 409);
  }
  return owner;
}
export async function assertConnectSelectionLock(id: string, owner: string) {
  if (await ioRedis.get(selectionLockKey(id)) !== owner) {
    throw new HttpException('Page selection expired. Retry shortly.', 409);
  }
}
export async function unlockConnectSelection(id: string, owner: string) {
  await ioRedis.eval(releaseSelectionLock, 1, selectionLockKey(id), owner);
}

type ConnectInvitation = { provider: string; organization: string };
function invitationKey(ticket: string) {
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
    throw new HttpException('Invalid or expired connection invitation', 400);
  }
  return 'connect-invitation:' + ticket;
}
export async function createConnectInvitation(provider: string, organization: string) {
  const origin = new URL(process.env.FRONTEND_URL || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password) {
    throw new HttpException('Connection invitations are unavailable', 503);
  }
  const ticket = randomBytes(32).toString('base64url');
  const value = JSON.stringify({ provider, organization });
  if (await ioRedis.set(invitationKey(ticket), value, 'EX', lifetime, 'NX') !== 'OK') {
    throw new HttpException('Connection invitations are unavailable', 503);
  }
  // nginx already omits query strings from access logs. Do not put the bearer
  // ticket in the path or forward it to the OAuth provider.
  const url = new URL('/api/integrations/connect-invitation', origin);
  url.searchParams.set('ticket', ticket);
  return { url: url.href };
}
export async function readConnectInvitation(ticket: string): Promise<ConnectInvitation> {
  const value = await ioRedis.get(invitationKey(ticket));
  if (!value) throw new HttpException('Invalid or expired connection invitation', 400);
  return JSON.parse(value);
}
const claimInvitation = `
local value = redis.call('GET', KEYS[1])
if not value or value ~= ARGV[1] then return nil end
redis.call('DEL', KEYS[1])
return 1
`;
export async function consumeConnectInvitation(ticket: string, invitation: ConnectInvitation) {
  if (!await ioRedis.eval(claimInvitation, 1, invitationKey(ticket), JSON.stringify(invitation))) {
    throw new HttpException('Invalid or expired connection invitation', 400);
  }
}
export async function renderConnectInvitation(ticket: string, invitation: ConnectInvitation, organizationName: string, res: Response) {
  invitationKey(ticket);
  const confirmation = randomBytes(32).toString('base64url');
  await startConnectBrowser(confirmation, 'invite:' + ticket, invitation.organization, res);
  const escape = (value: string) => String(value).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    // The confirmation form follows an HTTPS redirect to the OAuth provider.
    'Content-Security-Policy': "default-src 'none'; form-action https:; frame-ancestors 'none'; base-uri 'none'",
  });
  return res.type('html').send(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>チャンネル接続の確認 | トイバコ</title></head>
<body><main><h1>接続先を確認してください</h1>
<p>接続先: <strong>${escape(organizationName)}</strong> (${escape(invitation.organization)})</p>
<p>サービス: ${escape(invitation.provider)}</p>
<p>接続すると、この組織があなたのチャンネルを使って投稿できるようになります。心当たりがない場合は、この画面を閉じてください。</p>
<form method="post" action="/api/integrations/connect-invitation?ticket=${ticket}">
<input type="hidden" name="confirmation" value="${confirmation}">
<button type="submit">この組織への接続を確認して進む</button></form></main></body></html>`);
}
