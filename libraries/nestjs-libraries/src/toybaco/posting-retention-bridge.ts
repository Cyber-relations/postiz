import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { toybacoRetentionPolicy } from '../database/prisma/posts/posting-retention';

export const RETENTION_PATH = '/toybaco/internal/posting-retention';
const PURPOSE = 'toybaco-posting-retention-v1';
const HEX = /^[0-9a-f]{64}$/;
const MAX_BYTES = 65536;
const unavailable = () => new ServiceUnavailableException('保留状態を確認できません。');
const denied = () => new ForbiddenException('契約移行の要求を確認できません。');
function configuration() {
  const audience = process.env.FRONTEND_URL;
  const pairs: Record<string, string> = {
    'https://post.toybaco.jp': 'https://app.toybaco.jp',
    'https://post.staging.toybaco.jp': 'https://app.staging.toybaco.jp',
  };
  const issuer = audience && pairs[audience];
  const secret = process.env.POSTIZ_OAUTH_CLIENT_SECRET || '';
  if (process.env.TOYBACO_POSTING_RETENTION_ENABLED !== 'true' || !issuer || Buffer.byteLength(secret) < 32 ||
      process.env.POSTIZ_OAUTH_USERINFO_URL !== `${issuer}/toybaco/oidc/userinfo`) throw unavailable();
  return { audience, issuer, key: createHmac('sha256', secret).update(PURPOSE).digest() };
}
export function retentionOrganization(account: number) {
  if (!Number.isSafeInteger(account) || account <= 0) throw denied();
  const namespace = Buffer.from('2ce137d1b1535df8a334f97cb11ad413', 'hex');
  const value = createHash('sha1').update(namespace).update(`chatwoot-account:${account}`).digest().subarray(0, 16);
  value[6] = (value[6] & 15) | 80; value[8] = (value[8] & 63) | 128;
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function signature(key: Buffer, direction: string, stamp: string, raw: string) {
  return createHmac('sha256', key).update(`${direction}\n${RETENTION_PATH}\n${stamp}\n${raw}`).digest('hex');
}
export function retentionRequest(request: any) {
  const config = configuration();
  // Verify the wire bytes, never the separately parsed body or browser session.
  if (request.method !== 'POST' || request.originalUrl !== RETENTION_PATH ||
      request.headers?.['content-type'] !== 'application/json' || !Buffer.isBuffer(request.rawBody) ||
      request.rawBody.length > MAX_BYTES) throw denied();
  const raw = request.rawBody.toString('utf8');
  const header = request.headers['x-toybaco-retention-signature'];
  const match = typeof header === 'string' && /^([0-9]{10})\.([0-9a-f]{64})$/.exec(header);
  if (!match || Math.abs(Math.floor(Date.now() / 1000) - Number(match[1])) > 60 ||
      !timingSafeEqual(Buffer.from(signature(config.key, 'POST', match[1], raw), 'hex'), Buffer.from(match[2], 'hex'))) throw denied();
  let body: any;
  try { body = JSON.parse(raw); } catch { throw denied(); }
  const fields = ['version', 'account_id', 'organization_id', 'transition_id', 'keep_integration_ids',
    'scheduled_posts_per_account', 'policy_hash', 'issuer', 'audience'];
  if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== fields.sort().join(',') ||
      JSON.stringify(body) !== raw || body.version !== 1 || body.issuer !== config.issuer || body.audience !== config.audience ||
      body.organization_id !== retentionOrganization(body.account_id)) throw denied();
  const policy = toybacoRetentionPolicy(body.organization_id, { transitionId: body.transition_id,
    keepIntegrationIds: body.keep_integration_ids, scheduledPostsPerAccount: body.scheduled_posts_per_account });
  if (policy.policyHash !== body.policy_hash) throw denied();
  return { policy, accountId: body.account_id, requestHash: createHash('sha256').update(raw).digest('hex') };
}
export function retentionResponse(context: ReturnType<typeof retentionRequest>, receipt: any) {
  const { policy } = context;
  if (!receipt || receipt.transitionId !== policy.transitionId || typeof receipt.receiptHash !== 'string' ||
      !HEX.test(receipt.receiptHash) || ![receipt.keptPosts, receipt.heldPosts].every(n => Number.isInteger(n) && n >= 0 && n <= 10000)) throw unavailable();
  const raw = JSON.stringify({ version: 1, request_sha256: context.requestHash,
    organization_id: policy.organizationId, transition_id: policy.transitionId, policy_hash: policy.policyHash,
    receipt_hash: receipt.receiptHash, kept_posts: receipt.keptPosts, held_posts: receipt.heldPosts });
  const stamp = String(Math.floor(Date.now() / 1000));
  return { raw, signature: `${stamp}.${signature(configuration().key, 'RESPONSE', stamp, raw)}` };
}
