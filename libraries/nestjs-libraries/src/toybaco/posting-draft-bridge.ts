import { createHmac } from 'node:crypto';
import { ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';

const PATH = '/toybaco/internal/post-drafts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EDITOR = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Actor = { activated?: boolean; deletedAt?: unknown; providerName?: string; providerId?: string | null };
type Organization = { id: string };
type Policy = { account_id: number; organization_id: string; shared: boolean };
const unavailable = () => new ServiceUnavailableException('AIの状態を確認できません。もう一度お試しください。');

function configuration() {
  try {
    const issuer = new URL(process.env.POSTIZ_OAUTH_USERINFO_URL || '');
    const secret = process.env.POSTIZ_OAUTH_CLIENT_SECRET || '';
    if (issuer.protocol !== 'https:' || !['app.toybaco.jp', 'app.staging.toybaco.jp'].includes(issuer.hostname) ||
        issuer.port || issuer.username || issuer.password || issuer.pathname !== '/toybaco/oidc/userinfo' || issuer.search || issuer.hash ||
        Buffer.byteLength(secret) < 32) throw unavailable();
    return { audience: issuer.origin, secret };
  } catch { throw unavailable(); }
}

function identity(user: Actor, organization: Organization) {
  const match = /^cw:([1-9][0-9]*)$/.exec(user?.providerId || '');
  const id = match ? Number(match[1]) : 0;
  if (user?.providerName !== 'GENERIC' || user.activated !== true || user.deletedAt ||
      !Number.isSafeInteger(id) || id <= 0 || !UUID.test(organization?.id || '')) {
    throw new ForbiddenException('この店舗を利用する権限を確認できません。');
  }
  return { user_id: id, organization_id: organization.id };
}

async function signedRequest(body: Record<string, unknown>) {
  const config = configuration();
  const raw = JSON.stringify({ ...body, audience: config.audience });
  if (Buffer.byteLength(raw) > 32768) throw new HttpException('入力を短くしてください。', 422);
  const stamp = String(Math.floor(Date.now() / 1000));
  const key = createHmac('sha256', config.secret).update('toybaco-posting-ai-v1').digest();
  const signature = createHmac('sha256', key).update(`POST\n${PATH}\n${stamp}\n${raw}`).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(config.audience + PATH, { method: 'POST', redirect: 'error', cache: 'no-store',
      signal: controller.signal, headers: { 'content-type': 'application/json', 'X-Toybaco-Posting-Signature': `${stamp}.${signature}` }, body: raw });
    if (!response.ok) {
      if ([403, 404, 422].includes(response.status)) throw new HttpException('入力内容とAIの利用状態を確認してください。', response.status);
      throw unavailable();
    }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw unavailable();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 32768) throw unavailable();
      chunks.push(part.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
    return value;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function toybacoPostingPolicy(user: Actor, organization: Organization): Promise<Policy> {
  const actor = identity(user, organization);
  const value = await signedRequest({ ...actor, action: 'policy' });
  if (!Number.isSafeInteger(value.account_id) || value.account_id <= 0 ||
      value.organization_id !== actor.organization_id || typeof value.shared !== 'boolean') throw unavailable();
  return { account_id: value.account_id, organization_id: value.organization_id, shared: value.shared };
}

export async function toybacoOrganizationPolicy(organizationId: string): Promise<{ shared: boolean }> {
  if (!UUID.test(organizationId || '')) throw new ForbiddenException('店舗を確認できません。');
  const value = await signedRequest({ action: 'organization_policy', organization_id: organizationId });
  if (value.organization_id !== organizationId || typeof value.shared !== 'boolean') throw unavailable();
  return { shared: value.shared };
}

export async function toybacoPostingDraft(user: Actor, organization: Organization, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpException('入力を確認してください。', 422);
  const body = input as Record<string, unknown>;
  const fields: Record<string, string[]> = { state: ['request_id'], cancel: ['request_id'], start: ['nonce', 'draft', 'instruction'] };
  const extra = typeof body.action === 'string' ? fields[body.action] : undefined;
  if (!extra || Object.keys(body).sort().join(',') !== ['action', 'editor_id', ...extra].sort().join(',') ||
      typeof body.editor_id !== 'string' || !EDITOR.test(body.editor_id)) throw new HttpException('入力を確認してください。', 422);
  if (body.action === 'start') {
    if (typeof body.nonce !== 'string' || !EDITOR.test(body.nonce) || typeof body.draft !== 'string' || body.draft.length > 4000 ||
        typeof body.instruction !== 'string' || body.instruction.length > 1000 || !(body.draft.trim() || body.instruction.trim())) throw new HttpException('入力を確認してください。', 422);
  } else if (!(body.action === 'state' && body.request_id === null) &&
      !(Number.isSafeInteger(body.request_id) && Number(body.request_id) > 0)) throw new HttpException('入力を確認してください。', 422);
  const actor = identity(user, organization);
  const policy = await toybacoPostingPolicy(user, organization);
  if (!policy.shared) throw new ForbiddenException('このプランでは利用できません。');
  return signedRequest({ ...body, ...actor, account_id: policy.account_id });
}
