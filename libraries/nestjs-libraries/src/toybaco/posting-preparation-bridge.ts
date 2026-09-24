import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { toybacoPreparationHash, toybacoPreparationRequest } from '../database/prisma/posts/posting-retention';

export const PREPARATION_PATH = '/toybaco/internal/posting-preparation';
const PURPOSE = 'toybaco-posting-preparation-v2';
const MAX_BYTES = 65536;
const denied = () => new ForbiddenException('再開の準備内容を確認できません。');
const unavailable = () => new ServiceUnavailableException('再開の準備状態を確認してください。');
function configuration() {
  const audience = process.env.FRONTEND_URL;
  const pairs: Record<string, [string, string]> = {
    'https://post.toybaco.jp': ['https://app.toybaco.jp', 'live'],
    'https://post.staging.toybaco.jp': ['https://app.staging.toybaco.jp', 'test'],
  };
  const pair = audience && pairs[audience];
  const secret = process.env.POSTIZ_OAUTH_CLIENT_SECRET || '';
  if (process.env.TOYBACO_POSTING_RELEASE_ENABLED !== 'true' || !pair || Buffer.byteLength(secret) < 32 ||
      process.env.POSTIZ_OAUTH_USERINFO_URL !== `${pair[0]}/toybaco/oidc/userinfo`) throw unavailable();
  return { audience, issuer: pair[0], mode: pair[1], key: createHmac('sha256', secret).update(PURPOSE).digest() };
}
function signature(key: Buffer, direction: string, stamp: string, raw: string) {
  return createHmac('sha256', key).update(`${direction}\n${PREPARATION_PATH}\n${stamp}\n${raw}`).digest('hex');
}
export function preparationRequest(request: any) {
  const config = configuration();
  if (request.method !== 'POST' || request.originalUrl !== PREPARATION_PATH ||
      request.headers?.['content-type'] !== 'application/json' || !Buffer.isBuffer(request.rawBody) ||
      request.rawBody.length > MAX_BYTES) throw denied();
  const raw = request.rawBody.toString('utf8');
  const header = request.headers['x-toybaco-preparation-signature'];
  const match = typeof header === 'string' && /^([0-9]{10})\.([0-9a-f]{64})$/.exec(header);
  if (!match || Math.abs(Math.floor(Date.now() / 1000) - Number(match[1])) > 60 ||
      !timingSafeEqual(Buffer.from(signature(config.key, 'POST', match[1], raw), 'hex'), Buffer.from(match[2], 'hex'))) throw denied();
  let body: any;
  try { body = JSON.parse(raw); } catch { throw denied(); }
  if (!body || Array.isArray(body) || Object.keys(body).sort().join('|') !== 'audience|issuer|mode|preparation|version' ||
      JSON.stringify(body) !== raw || body.version !== 2 || body.issuer !== config.issuer || body.audience !== config.audience || body.mode !== config.mode) throw denied();
  try {
    const preparation = toybacoPreparationRequest(body.preparation?.organizationId, body.preparation);
    return { preparation, requestHash: createHash('sha256').update(raw).digest('hex'), config };
  } catch { throw denied(); }
}
export function preparationResponse(context: ReturnType<typeof preparationRequest>, receipt: any) {
  const input = context.preparation;
  if (!receipt || Object.keys(receipt).sort().join('|') !== 'execute|organizationId|payloadHash|preparedAt|receiptHash|requestId|state|version' ||
      receipt.version !== 2 || receipt.state !== 'prepared' || receipt.execute !== false ||
      receipt.organizationId !== input.organizationId || receipt.requestId !== input.requestId ||
      receipt.payloadHash !== toybacoPreparationHash(input) || !Number.isSafeInteger(receipt.preparedAt) ||
      receipt.preparedAt < 1 || receipt.preparedAt > Date.now() ||
      receipt.receiptHash !== toybacoPreparationHash(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptHash')))) throw unavailable();
  const raw = JSON.stringify({ version: 2, request_sha256: context.requestHash, preparation: receipt });
  const stamp = String(Math.floor(Date.now() / 1000));
  return { raw, signature: `${stamp}.${signature(context.config.key, 'RESPONSE', stamp, raw)}` };
}
