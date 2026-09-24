import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { ForbiddenException } from '@nestjs/common';
import {
  authorityRequest,
  authorityEnabled,
  executionRequest,
  postingHash,
  executionId,
  renewalRequest,
  paidUpgradeRequest,
  paidUpgradeApplication,
} from '../database/prisma/posts/posting-authority';
const PAIRS: Record<string, [string, string]> = {
  'https://post.toybaco.jp': ['https://app.toybaco.jp', 'live'],
  'https://post.staging.toybaco.jp': ['https://app.staging.toybaco.jp', 'test'],
};
export const AUTHORITY_PATH = '/toybaco/internal/posting-authority';
export const RENEWAL_PATH = '/toybaco/internal/posting-renewal';
export const PAID_UPGRADE_PATH = '/toybaco/internal/posting-paid-upgrade';
export const EXECUTION_PATH = '/toybaco/internal/posting-execution';
const invalid = () => new ForbiddenException('投稿状態を確認できません。');
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
const sameKeys = (value: any, fields: string[]) =>
  value &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...fields].sort().join('|');
export function postingProtocolConfig(
  kind: 'authority' | 'execution' | 'paid_upgrade' | 'renewal',
) {
  const origin = process.env.FRONTEND_URL || '',
    pair = PAIRS[origin],
    secret = process.env.POSTIZ_OAUTH_CLIENT_SECRET || '';
  if (
    !pair ||
    Buffer.byteLength(secret) < 32 ||
    process.env.POSTIZ_OAUTH_USERINFO_URL !== pair[0] + '/toybaco/oidc/userinfo'
  )
    throw invalid();
  const purpose =
    kind === 'authority'
      ? 'toybaco-posting-authority-v1'
      : kind === 'paid_upgrade'
        ? 'toybaco-posting-paid-upgrade-v1'
        : kind === 'renewal' ? 'toybaco-posting-renewal-v1' : 'toybaco-posting-execution-v3';
  return {
    origin,
    rails: pair[0],
    mode: pair[1],
    key: createHmac('sha256', secret).update(purpose).digest(),
    path:
      kind === 'authority'
        ? AUTHORITY_PATH
        : kind === 'paid_upgrade'
          ? PAID_UPGRADE_PATH
          : kind === 'renewal' ? RENEWAL_PATH : EXECUTION_PATH,
  };
}
export function postingSignature(
  raw: string,
  config: any,
  direction: string,
  stamp = String(Math.floor(Date.now() / 1000)),
) {
  return (
    stamp +
    '.' +
    createHmac('sha256', config.key)
      .update(`${direction}\n${config.path}\n${stamp}\n${raw}`)
      .digest('hex')
  );
}
function checked(raw: string, header: any, config: any, direction: string) {
  const match =
    typeof header === 'string' && /^([0-9]{10})\.([0-9a-f]{64})$/.exec(header);
  if (
    typeof raw !== 'string' ||
    Buffer.byteLength(raw) > 65536 ||
    !match ||
    Math.abs(Number(match[1]) - Math.floor(Date.now() / 1000)) > 60 ||
    !timingSafeEqual(
      Buffer.from(match[2], 'hex'),
      Buffer.from(
        postingSignature(raw, config, direction, match[1]).split('.')[1],
        'hex',
      ),
    )
  )
    throw invalid();
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  // Reserializing rejects duplicate members, insignificant whitespace and alternate numeric encodings.
  if (JSON.stringify(value) !== raw) throw invalid();
  return value;
}
export function postingAuthorityRequest(req: any) {
  const config = postingProtocolConfig('authority');
  if (
    req.method !== 'POST' ||
    req.originalUrl !== AUTHORITY_PATH ||
    req.headers?.['content-type'] !== 'application/json' ||
    !Buffer.isBuffer(req.rawBody)
  )
    throw invalid();
  const raw = req.rawBody.toString('utf8'),
    body = checked(
      raw,
      req.headers['x-toybaco-authority-signature'],
      config,
      'POST',
    );
  if (
    !sameKeys(body, [
      'version',
      'issuer',
      'audience',
      'mode',
      'operation',
      'authority',
    ]) ||
    body.version !== 1 ||
    body.issuer !== config.rails ||
    body.audience !== config.origin ||
    body.mode !== config.mode ||
    !['activate', 'confirm', 'status'].includes(body.operation)
  )
    throw invalid();
  return {
    config,
    requestHash: digest(raw),
    operation: body.operation,
    authority: authorityRequest(body.authority),
  };
}
export function postingAuthorityResponse(context: any, value: any) {
  if (
    !sameKeys(value, [
      'authorityId',
      'authorityHash',
      'organizationId',
      'state',
      'pointerHash',
      'current',
      'execute',
    ]) ||
    value.execute !== false ||
    typeof value.current !== 'boolean' ||
    !['pending', 'ready', 'stale'].includes(value.state) ||
    value.authorityHash !== postingHash(context.authority) ||
    value.authorityId !== context.authority.authorityId ||
    value.organizationId !== context.authority.organizationId
  )
    throw invalid();
  const raw = JSON.stringify({
    version: 1,
    request_sha256: context.requestHash,
    authority: value,
  });
  return { raw, signature: postingSignature(raw, context.config, 'RESPONSE') };
}
export function postingExecutionEnvelope(
  operation: string,
  input: any,
  result?: { outcome: string; evidenceHash: string },
) {
  const config = postingProtocolConfig('execution');
  const execution = executionRequest(input);
  if (operation === 'start') {
    authorityEnabled();
    if (
      process.env.TOYBACO_POSTING_RELEASE_ENABLED !== 'true' ||
      process.env.TOYBACO_POSTING_EXECUTION_ENABLED !== 'true'
    )
      throw invalid();
  }
  if (
    !['start', 'status', 'result'].includes(operation) ||
    (operation === 'result') !== !!result
  )
    throw invalid();
  const body: any = {
    version: 3,
    issuer: config.origin,
    audience: config.rails,
    mode: config.mode,
    operation,
    execution,
  };
  if (result) {
    if (
      !['pending', 'published', 'rejected', 'not_sent', 'uncertain'].includes(
        result.outcome,
      ) ||
      !/^[0-9a-f]{64}$/.test(result.evidenceHash)
    )
      throw invalid();
    Object.assign(body, result);
  }
  return { config, body, raw: JSON.stringify(body) };
}
export function postingExecutionResponse(
  context: any,
  raw: string,
  signature: any,
) {
  const body = checked(raw, signature, context.config, 'RESPONSE');
  if (
    !sameKeys(body, ['version', 'request_sha256', 'execution']) ||
    body.version !== 3 ||
    body.request_sha256 !== digest(context.raw) ||
    !sameKeys(body.execution, [
      'operationId',
      'requestHash',
      'state',
      'outcome',
      'evidenceHash',
      'execute',
    ]) ||
    body.execution.execute !== false ||
    ![
      'absent',
      'started',
      'uncertain',
      'pending',
      'completed',
      'cancelled',
    ].includes(body.execution.state) ||
    body.execution.operationId !== executionId(context.body.execution) ||
    body.execution.requestHash !== postingHash(context.body.execution) ||
    (body.execution.outcome !== null &&
      !['published', 'rejected', 'not_sent'].includes(body.execution.outcome) &&
      !(
        body.execution.outcome === 'pending' &&
        body.execution.state === 'completed' &&
        context.body.execution.step === 'FINALIZE'
      )) ||
    (body.execution.evidenceHash !== null &&
      !/^[0-9a-f]{64}$/.test(body.execution.evidenceHash))
  )
    throw invalid();
  return body.execution;
}
export async function callPostingExecution(
  operation: string,
  input: any,
  result?: { outcome: string; evidenceHash: string },
) {
  const context = postingExecutionEnvelope(operation, input, result);
  const output = await new Promise<{ raw: string; signature: any }>(
    (resolve, reject) => {
      const req = httpsRequest(
        context.config.rails + EXECUTION_PATH,
        {
          method: 'POST',
          agent: false,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(context.raw),
            'X-Toybaco-Execution-Signature': postingSignature(
              context.raw,
              context.config,
              'POST',
            ),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > 65536) req.destroy(invalid());
            else chunks.push(chunk);
          });
          res.on('error', () => reject(invalid()));
          res.on('end', () => {
            if (
              res.statusCode !== 200 ||
              res.headers['content-type']?.split(';')[0] !== 'application/json'
            )
              return reject(invalid());
            resolve({
              raw: Buffer.concat(chunks).toString('utf8'),
              signature: res.headers['x-toybaco-execution-signature'],
            });
          });
        },
      );
      const timer = setTimeout(() => req.destroy(invalid()), 15000);
      req.on('close', () => clearTimeout(timer));
      req.on('error', () => reject(invalid()));
      req.end(context.raw);
    },
  );
  return postingExecutionResponse(context, output.raw, output.signature);
}

export function postingPaidUpgradeRequest(req: any) {
  const config = postingProtocolConfig('paid_upgrade');
  if (
    req.method !== 'POST' ||
    req.originalUrl !== PAID_UPGRADE_PATH ||
    req.headers?.['content-type'] !== 'application/json' ||
    !Buffer.isBuffer(req.rawBody)
  )
    throw invalid();
  const raw = req.rawBody.toString('utf8'),
    body = checked(
      raw,
      req.headers['x-toybaco-paid-upgrade-signature'],
      config,
      'POST',
    );
  if (
    !sameKeys(body, [
      'version',
      'issuer',
      'audience',
      'mode',
      'operation',
      'handoff',
      'application',
    ]) ||
    body.version !== 1 ||
    body.issuer !== config.rails ||
    body.audience !== config.origin ||
    body.mode !== config.mode ||
    !['prepare', 'apply', 'confirm', 'status', 'withdraw'].includes(
      body.operation,
    ) ||
    ['apply', 'confirm'].includes(body.operation) !==
      (body.application !== null)
  )
    throw invalid();
  return {
    config,
    requestHash: digest(raw),
    operation: body.operation,
    handoff: paidUpgradeRequest(body.handoff),
    application:
      body.application === null
        ? null
        : paidUpgradeApplication(body.application),
  };
}
export function postingPaidUpgradeResponse(context: any, value: any) {
  const hex = (v: any) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  if (
    !sameKeys(value, [
      'operationId',
      'requestHash',
      'receiptHash',
      'rootManifestHash',
      'state',
      'authorityId',
      'authorityHash',
      'pointerHash',
      'current',
      'execute',
    ]) ||
    value.execute !== false ||
    typeof value.current !== 'boolean' ||
    !['pending', 'applied', 'ready', 'withdrawn'].includes(value.state) ||
    value.operationId !== context.handoff.operationId ||
    value.requestHash !== postingHash(context.handoff) ||
    !hex(value.receiptHash) ||
    !hex(value.rootManifestHash) ||
    (value.pointerHash !== null && !hex(value.pointerHash)) ||
    (['applied', 'ready'].includes(value.state)
      ? !hex(value.authorityId) || !hex(value.authorityHash)
      : value.authorityId !== null ||
        value.authorityHash !== null ||
        value.current !== false) ||
    (context.application &&
      ['applied', 'ready'].includes(value.state) &&
      context.application.authorityId !== value.authorityId)
  )
    throw invalid();
  const raw = JSON.stringify({
    version: 1,
    request_sha256: context.requestHash,
    handoff: value,
  });
  return { raw, signature: postingSignature(raw, context.config, 'RESPONSE') };
}

export function postingRenewalRequest(req:any) {
  const config=postingProtocolConfig('renewal');
  if(req.method!=='POST'||req.originalUrl!==RENEWAL_PATH||req.headers?.['content-type']!=='application/json'||!Buffer.isBuffer(req.rawBody))throw invalid();
  const raw=req.rawBody.toString('utf8'),body=checked(raw,req.headers['x-toybaco-renewal-signature'],config,'POST');
  if(!sameKeys(body,['version','issuer','audience','mode','renewal'])||body.version!==1||body.issuer!==config.rails||body.audience!==config.origin||body.mode!==config.mode)throw invalid();
  return {config,requestHash:digest(raw),renewal:renewalRequest(body.renewal)};
}
export function postingRenewalResponse(context:any,value:any) {
  const input=context.renewal,hex=(v:any)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
  if(!sameKeys(value,['version','protocol','requestHash','operationId','sourceAuthorityId','targetAuthorityId','targetAuthorityHash','sourcePointerHash','targetPointerHash','receiptHash','rootManifestHash','state','execute'])||value.version!==1||value.protocol!==input.protocol||value.requestHash!==postingHash(input)||value.operationId!==input.operationId||value.sourceAuthorityId!==input.sourceAuthorityId||value.targetAuthorityId!==input.targetAuthorityId||value.targetAuthorityHash!==input.targetAuthorityHash||value.sourcePointerHash!==input.sourcePointerHash||!['targetPointerHash','receiptHash','rootManifestHash'].every(k=>hex(value[k]))||value.state!==(input.phase==='confirm'?'ready':'prepared')||value.execute!==false)throw invalid();
  const raw=JSON.stringify({version:1,request_sha256:context.requestHash,renewal:value});
  return {raw,signature:postingSignature(raw,context.config,'RESPONSE')};
}
