import {
  UploadPartCommand,
  S3Client,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer } = require('file-type');

// toybaco_publishable_media_v1: UI・memory upload・multipart・投稿DTOを一致させる。
const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function normalizeExtension(filename: string): string | null {
  const ext = path.extname(filename || '').toLowerCase();
  return ALLOWED_EXT_TO_MIME[ext] ? ext : null;
}

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_BUCKETNAME,
  CLOUDFLARE_BUCKET_URL,
} = process.env;

// toybaco_s3_credentials_start
function toybacoResolveS3Options(
  endpoint: string | undefined,
  accountId: string | undefined,
  accessKey: string | undefined,
  secretKey: string | undefined
) {
  const normalizedEndpoint = endpoint?.trim();
  const normalizedAccountId = accountId?.trim();
  const normalizedAccessKey = accessKey?.trim();
  const normalizedSecretKey = secretKey?.trim();
  const hasAccessKey = Boolean(normalizedAccessKey);
  const hasSecretKey = Boolean(normalizedSecretKey);

  if (hasAccessKey !== hasSecretKey) {
    throw new Error(
      'S3 credentials are incomplete: access key and secret key must be set together.'
    );
  }

  let isAwsS3Endpoint = false;
  let resolvedEndpoint = normalizedEndpoint;
  if (normalizedEndpoint) {
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(normalizedEndpoint);
    } catch {
      throw new Error('S3_ENDPOINT must be a valid HTTPS URL.');
    }
    if (
      parsedEndpoint.protocol !== 'https:' ||
      parsedEndpoint.username ||
      parsedEndpoint.password ||
      parsedEndpoint.pathname !== '/' ||
      parsedEndpoint.port ||
      parsedEndpoint.search ||
      parsedEndpoint.hash
    ) {
      throw new Error('S3_ENDPOINT must be an origin-only HTTPS URL.');
    }
    const hostname = parsedEndpoint.hostname.toLowerCase();
    const isAnyAwsS3Endpoint =
      hostname === 's3.amazonaws.com' ||
      /^s3(?:-fips)?(?:\.dualstack)?\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(
        hostname
      ) ||
      /^s3-[a-z0-9-]+\.amazonaws\.com$/.test(hostname);
    if (
      isAnyAwsS3Endpoint &&
      parsedEndpoint.origin !== 'https://s3.ap-northeast-1.amazonaws.com'
    ) {
      throw new Error('AWS S3 endpoint must be the Tokyo regional endpoint.');
    }
    isAwsS3Endpoint =
      parsedEndpoint.origin === 'https://s3.ap-northeast-1.amazonaws.com';
    resolvedEndpoint = parsedEndpoint.origin;
  }

  if (!normalizedEndpoint && !normalizedAccountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required for R2 storage.');
  }
  if (
    !normalizedEndpoint &&
    !/^[a-f0-9]{32}$/i.test(normalizedAccountId || '')
  ) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal value.');
  }
  if (isAwsS3Endpoint && (hasAccessKey || hasSecretKey)) {
    throw new Error(
      'Static CLOUDFLARE credentials are forbidden for AWS S3; use the ECS Task Role.'
    );
  }
  if (!isAwsS3Endpoint && (!hasAccessKey || !hasSecretKey)) {
    throw new Error(
      'Explicit credentials are required for R2 or a custom S3 endpoint.'
    );
  }

  return {
    endpoint:
      resolvedEndpoint ||
      `https://${normalizedAccountId}.r2.cloudflarestorage.com`,
    credentialOptions:
      !isAwsS3Endpoint && hasAccessKey && hasSecretKey
        ? {
            credentials: {
              accessKeyId: normalizedAccessKey!,
              secretAccessKey: normalizedSecretKey!,
            },
          }
        : {},
  };
}
// toybaco_s3_credentials_end

const toybacoS3 = toybacoResolveS3Options(
  process.env.S3_ENDPOINT,
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY
);

const R2 = new S3Client({
  // toybaco_s3_tokyo_v3: AWSはTask Role、R2は明示キーで認証する。
  region: process.env.S3_REGION || 'auto',
  endpoint: toybacoS3.endpoint,
  ...toybacoS3.credentialOptions,
});

// Function to generate a random string
function generateRandomString() {
  return makeId(20);
}

// toybaco_upload_security_v1_start
// ブラウザからECSメモリを経由する経路は10MiB画像まで。大きな画像・動画は
// 10MiB固定partでS3へ直接送り、署名sessionに全境界を固定する。
export const TOYBACO_MEMORY_UPLOAD_BYTES = 10 * 1024 * 1024;
export const TOYBACO_MULTIPART_PART_BYTES = 10 * 1024 * 1024;
export const TOYBACO_MULTIPART_MAX_BYTES = 1024 * 1024 * 1024;
export const TOYBACO_UPLOAD_SESSION_TTL_SECONDS = 60 * 60;
const TOYBACO_PUBLISHABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
]);

function toybacoBase64UrlJson(value: any) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function toybacoUploadSigningKey(secret: any) {
  if (typeof secret !== 'string' || secret.length < 32) return null;
  return crypto
    .createHmac('sha256', secret)
    .update('toybaco-upload-session-signing-key-v1')
    .digest();
}

export function toybacoExpectedPartCount(size: any) {
  if (!Number.isSafeInteger(size) || size < 1 || size > TOYBACO_MULTIPART_MAX_BYTES) {
    return null;
  }
  return Math.ceil(size / TOYBACO_MULTIPART_PART_BYTES);
}

export function toybacoExpectedPartSize(size: any, partNumber: any) {
  const count = toybacoExpectedPartCount(size);
  if (!count || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) {
    return null;
  }
  if (partNumber < count) return TOYBACO_MULTIPART_PART_BYTES;
  return size - TOYBACO_MULTIPART_PART_BYTES * (count - 1);
}

function toybacoSafeOriginalName(value: any, safeExt: any) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255) return null;
  const normalized = value
    .normalize('NFC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > 120) return null;
  const base = normalized.replace(/\.[^./\\]*$/, '').slice(0, 110).trim();
  return base ? `${base}${safeExt}` : null;
}

export function toybacoValidateMultipartCreate(file: any, declaredContentType: any) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return null;
  const safeExt = normalizeExtension(file.name || '');
  const safeContentType = safeExt ? ALLOWED_EXT_TO_MIME[safeExt] : null;
  const expectedParts = toybacoExpectedPartCount(file.size);
  const originalName = toybacoSafeOriginalName(file.name, safeExt);
  if (
    !safeExt ||
    !safeContentType ||
    !TOYBACO_PUBLISHABLE_MIME_TYPES.has(safeContentType) ||
    !expectedParts ||
    !originalName ||
    (safeContentType.startsWith('image/') && file.size > 30 * 1024 * 1024) ||
    file.type !== safeContentType ||
    declaredContentType !== safeContentType
  ) {
    return null;
  }
  return {
    safeExt,
    safeContentType,
    size: file.size,
    expectedParts,
    originalName,
  };
}

export function toybacoSignUploadSession(claims: any, secret: any, nowSeconds: any = Math.floor(Date.now() / 1000)) {
  const key = toybacoUploadSigningKey(secret);
  if (!key || !Number.isSafeInteger(nowSeconds)) return null;
  const payload = {
    v: 1,
    o: claims.organizationId,
    key: claims.key,
    uid: claims.uploadId,
    mime: claims.contentType,
    size: claims.size,
    parts: claims.parts,
    name: claims.originalName,
    iat: nowSeconds,
    exp: nowSeconds + TOYBACO_UPLOAD_SESSION_TTL_SECONDS,
  };
  const encoded = toybacoBase64UrlJson(payload);
  const signature = crypto.createHmac('sha256', key).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function toybacoVerifyUploadSession(token: any, organizationId: any, nowSeconds: any = Math.floor(Date.now() / 1000), secret: any = process.env.JWT_SECRET) {
  if (
    typeof token !== 'string' ||
    token.length < 40 ||
    token.length > 4096 ||
    typeof organizationId !== 'string' ||
    organizationId.length < 1 ||
    organizationId.length > 200 ||
    !Number.isSafeInteger(nowSeconds)
  ) return null;
  const segments = token.split('.');
  if (segments.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(segments[0]) || !/^[A-Za-z0-9_-]+$/.test(segments[1])) {
    return null;
  }
  const key = toybacoUploadSigningKey(secret);
  if (!key) return null;
  const expected = crypto.createHmac('sha256', key).update(segments[0]).digest();
  let provided: Buffer;
  let payloadText: string;
  try {
    provided = Buffer.from(segments[1], 'base64url');
    payloadText = Buffer.from(segments[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (
    provided.length !== expected.length ||
    provided.toString('base64url') !== segments[1] ||
    !crypto.timingSafeEqual(provided, expected)
  ) return null;
  let payload: any;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return null;
  }
  const exactKeys = ['exp', 'iat', 'key', 'mime', 'name', 'o', 'parts', 'size', 'uid', 'v'];
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(',') !== exactKeys.join(',') ||
    payload.v !== 1 ||
    payload.o !== organizationId ||
    typeof payload.key !== 'string' ||
    !/^[A-Za-z0-9]{20}\.(?:jpe?g|png|gif|webp|mp4)$/.test(payload.key) ||
    typeof payload.uid !== 'string' ||
    payload.uid.length < 1 ||
    payload.uid.length > 1024 ||
    typeof payload.mime !== 'string' ||
    ALLOWED_EXT_TO_MIME[path.extname(payload.key).toLowerCase()] !== payload.mime ||
    typeof payload.name !== 'string' ||
    payload.name.length < 1 ||
    payload.name.length > 120 ||
    toybacoExpectedPartCount(payload.size) !== payload.parts ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > nowSeconds + 5 ||
    payload.exp !== payload.iat + TOYBACO_UPLOAD_SESSION_TTL_SECONDS ||
    payload.exp <= nowSeconds
  ) return null;
  return payload;
}

export function toybacoOrganizationBinding(organizationId: any) {
  if (typeof organizationId !== 'string' || organizationId.length < 1 || organizationId.length > 200) {
    return null;
  }
  return crypto.createHash('sha256').update(organizationId).digest('hex');
}

export function toybacoStoredObjectMatches(objectHead: any, detected: any, session: any, organizationId: any) {
  const binding = toybacoOrganizationBinding(organizationId);
  return Boolean(
    binding &&
      objectHead &&
      session &&
      objectHead.ContentLength === session.size &&
      objectHead.ContentType === session.mime &&
      objectHead.Metadata?.['toybaco-session-version'] === '1' &&
      objectHead.Metadata?.['toybaco-organization-binding'] === binding &&
      detected &&
      detected.mime === session.mime
  );
}

const TOYBACO_UPLOAD_RATE_LUA = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return current
`;

export function toybacoUploadRatePolicy(endpoint: any) {
  if (endpoint === 'create-multipart-upload') {
    return { scope: 'create', limit: 10, windowSeconds: 60 * 60 };
  }
  if (
    [
      'prepare-upload-parts',
      'complete-multipart-upload',
      'list-parts',
      'abort-multipart-upload',
      'sign-part',
    ].includes(endpoint)
  ) {
    // 1GiBは最大103part。10 sessionを並行しても通常操作を妨げず、無制限にはしない。
    return { scope: 'control', limit: 1500, windowSeconds: 60 * 60 };
  }
  return null;
}

export function toybacoUploadRateKey(endpoint: any, organizationId: any) {
  const policy = toybacoUploadRatePolicy(endpoint);
  const binding = toybacoOrganizationBinding(organizationId);
  return policy && binding
    ? `toybaco:upload-rate:v1:${policy.scope}:${binding}`
    : null;
}

export async function toybacoConsumeUploadRate(redisClient: any, endpoint: any, organizationId: any) {
  const policy = toybacoUploadRatePolicy(endpoint);
  const key = toybacoUploadRateKey(endpoint, organizationId);
  if (
    !policy ||
    !key ||
    !redisClient ||
    typeof redisClient.eval !== 'function' ||
    (typeof redisClient.status === 'string' && redisClient.status !== 'ready')
  ) {
    return policy ? 'unavailable' : 'not-applicable';
  }
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const command = Promise.resolve(redisClient.eval(
      TOYBACO_UPLOAD_RATE_LUA,
      1,
      key,
      String(policy.limit),
      String(policy.windowSeconds)
    )).catch(() => null);
    const count = await Promise.race([
      command,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(null), 1500);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (!Number.isSafeInteger(Number(count)) || Number(count) < 1) return 'unavailable';
    return Number(count) <= policy.limit ? 'allowed' : 'limited';
  } catch {
    return 'unavailable';
  }
}

export function toybacoReadUploadSession(body: any, organizationId: any, nowSeconds: any = Math.floor(Date.now() / 1000), secret: any = process.env.JWT_SECRET) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const session = toybacoVerifyUploadSession(body.uploadId, organizationId, nowSeconds, secret);
  if (!session || body.key !== session.key) return null;
  return session;
}

export function toybacoReadPartNumber(value: any, session: any) {
  if (!session || typeof value !== 'number' || !Number.isInteger(value)) return null;
  return toybacoExpectedPartSize(session.size, value) ? value : null;
}

function toybacoSafeEtag(value: any) {
  return typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value);
}

export function toybacoValidateCompletedParts(parts: any, session: any) {
  if (!session || !Array.isArray(parts) || parts.length !== session.parts) return null;
  const safe = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const expectedNumber = index + 1;
    if (
      !part ||
      typeof part !== 'object' ||
      part.PartNumber !== expectedNumber ||
      !toybacoSafeEtag(part.ETag)
    ) return null;
    safe.push({ PartNumber: expectedNumber, ETag: part.ETag });
  }
  return safe;
}

export function toybacoValidateStoredParts(parts: any, session: any, requireComplete: any) {
  if (!session || !Array.isArray(parts) || parts.length > session.parts) return null;
  if (requireComplete && parts.length !== session.parts) return null;
  const safe = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const number = part?.PartNumber;
    if (
      number !== index + 1 ||
      part.Size !== toybacoExpectedPartSize(session.size, number) ||
      !toybacoSafeEtag(part.ETag)
    ) return null;
    safe.push({ PartNumber: number, Size: part.Size, ETag: part.ETag });
  }
  return safe;
}
// toybaco_upload_security_v1_end

function toybacoUploadError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ code, message });
}

async function toybacoAbortQuietly(key: string, uploadId: string) {
  try {
    await R2.send(
      new AbortMultipartUploadCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: key,
        UploadId: uploadId,
      })
    );
  } catch {
    // S3 lifecycleが1日後に必ず回収する。例外値はログ・responseへ出さない。
  }
}

async function toybacoDeleteQuietly(key: string) {
  try {
    await R2.send(
      new DeleteObjectCommand({ Bucket: CLOUDFLARE_BUCKETNAME, Key: key })
    );
  } catch {
    // 呼出元は安定した日本語エラーだけを返す。
  }
}

function toybacoSessionFromRequest(req: Request, organizationId: string) {
  return toybacoReadUploadSession(req.body, organizationId);
}

export default async function handleR2Upload(
  endpoint: string,
  organizationId: string,
  req: Request,
  res: Response
) {
  const rateResult = await toybacoConsumeUploadRate(ioRedis, endpoint, organizationId);
  if (rateResult === 'unavailable') {
    return toybacoUploadError(res, 503, 'UPLOAD_RATE_UNAVAILABLE', '現在メディアをアップロードできません');
  }
  if (rateResult === 'limited') {
    return toybacoUploadError(res, 429, 'UPLOAD_RATE_LIMITED', 'アップロード操作が多すぎます。しばらく待ってから再度お試しください');
  }
  switch (endpoint) {
    case 'create-multipart-upload':
      return createMultipartUpload(organizationId, req, res);
    case 'prepare-upload-parts':
      return prepareUploadParts(organizationId, req, res);
    case 'complete-multipart-upload':
      return completeMultipartUpload(organizationId, req, res);
    case 'list-parts':
      return listParts(organizationId, req, res);
    case 'abort-multipart-upload':
      return abortMultipartUpload(organizationId, req, res);
    case 'sign-part':
      return signPart(organizationId, req, res);
  }
  return toybacoUploadError(res, 404, 'UPLOAD_ROUTE_NOT_FOUND', 'アップロード経路が見つかりません');
}

export async function simpleUpload(
  data: Buffer,
  originalFilename: string,
  _contentType: string
) {
  if (!Buffer.isBuffer(data) || data.length < 1 || data.length > TOYBACO_MEMORY_UPLOAD_BYTES) {
    throw new Error('メディアをアップロードできませんでした');
  }
  const detected = await fileTypeFromBuffer(data);
  if (!detected || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(detected.mime)) {
    throw new Error('メディアをアップロードできませんでした');
  }
  const fileExtension = `.${detected.ext}`;
  const randomFilename = generateRandomString() + fileExtension;
  await R2.send(
    new PutObjectCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: randomFilename,
      Body: data,
      ContentType: detected.mime,
    })
  );
  return CLOUDFLARE_BUCKET_URL + '/' + randomFilename;
}

export async function createMultipartUpload(organizationId: string, req: Request, res: Response) {
  const validated = toybacoValidateMultipartCreate(req.body?.file, req.body?.contentType);
  if (!validated) {
    return toybacoUploadError(res, 400, 'UPLOAD_INVALID_FILE', '対応形式・サイズのメディアを指定してください');
  }
  if (!toybacoUploadSigningKey(process.env.JWT_SECRET)) {
    return toybacoUploadError(res, 503, 'UPLOAD_UNAVAILABLE', '現在メディアをアップロードできません');
  }
  const randomFilename = generateRandomString() + validated.safeExt;
  try {
    const response = await R2.send(
      new CreateMultipartUploadCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: randomFilename,
        ContentType: validated.safeContentType,
        Metadata: {
          'toybaco-session-version': '1',
          'toybaco-organization-binding': toybacoOrganizationBinding(organizationId),
        },
      })
    );
    if (response.Key !== randomFilename || typeof response.UploadId !== 'string') {
      return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'メディア保存先を準備できませんでした');
    }
    const sessionToken = toybacoSignUploadSession(
      {
        organizationId,
        key: randomFilename,
        uploadId: response.UploadId,
        contentType: validated.safeContentType,
        size: validated.size,
        parts: validated.expectedParts,
        originalName: validated.originalName,
      },
      process.env.JWT_SECRET
    );
    if (!sessionToken) {
      await toybacoAbortQuietly(randomFilename, response.UploadId);
      return toybacoUploadError(res, 503, 'UPLOAD_UNAVAILABLE', '現在メディアをアップロードできません');
    }
    return res.status(200).json({ uploadId: sessionToken, key: randomFilename });
  } catch {
    return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'メディア保存先を準備できませんでした');
  }
}

export async function prepareUploadParts(organizationId: string, req: Request, res: Response) {
  const partData = req.body?.partData;
  const session = toybacoReadUploadSession(partData, organizationId);
  const parts = partData?.parts;
  if (!session || !Array.isArray(parts) || parts.length < 1 || parts.length > session.parts) {
    return toybacoUploadError(res, 403, 'UPLOAD_SESSION_INVALID', 'アップロード情報を確認できませんでした');
  }
  const partNumbers = parts.map((part: any) => toybacoReadPartNumber(part?.number, session));
  if (partNumbers.some((value: any) => value === null) || new Set(partNumbers).size !== partNumbers.length) {
    return toybacoUploadError(res, 400, 'UPLOAD_PART_INVALID', 'アップロード分割情報が不正です');
  }
  try {
    const presignedUrls: Record<number, string> = {};
    for (const partNumber of partNumbers as number[]) {
      const command = new UploadPartCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        PartNumber: partNumber,
        UploadId: session.uid,
        ContentLength: toybacoExpectedPartSize(session.size, partNumber)!,
      });
      presignedUrls[partNumber] = await getSignedUrl(R2, command, {
        expiresIn: Math.max(1, Math.min(600, session.exp - Math.floor(Date.now() / 1000) - 1)),
      });
    }
    return res.status(200).json({ presignedUrls });
  } catch {
    return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'アップロード先を発行できませんでした');
  }
}

export async function listParts(organizationId: string, req: Request, res: Response) {
  const session = toybacoSessionFromRequest(req, organizationId);
  if (!session) {
    return toybacoUploadError(res, 403, 'UPLOAD_SESSION_INVALID', 'アップロード情報を確認できませんでした');
  }
  try {
    const response = await R2.send(
      new ListPartsCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        UploadId: session.uid,
      })
    );
    const safeParts = toybacoValidateStoredParts(response.Parts || [], session, false);
    if (!safeParts || response.IsTruncated) {
      await toybacoAbortQuietly(session.key, session.uid);
      return toybacoUploadError(res, 409, 'UPLOAD_PART_INVALID', 'アップロード分割情報が不正です');
    }
    return res.status(200).json(safeParts);
  } catch {
    return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'アップロード状況を確認できませんでした');
  }
}

export async function completeMultipartUpload(organizationId: string, req: Request, res: Response) {
  const session = toybacoSessionFromRequest(req, organizationId);
  const clientParts = session ? toybacoValidateCompletedParts(req.body?.parts, session) : null;
  if (!session || !clientParts) {
    return toybacoUploadError(res, 403, 'UPLOAD_SESSION_INVALID', 'アップロード情報を確認できませんでした');
  }
  let completionAttempted = false;
  try {
    const listed = await R2.send(
      new ListPartsCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        UploadId: session.uid,
      })
    );
    const storedParts = toybacoValidateStoredParts(listed.Parts || [], session, true);
    if (
      !storedParts ||
      listed.IsTruncated ||
      storedParts.some((part: any, index: number) => part.ETag !== clientParts[index].ETag)
    ) {
      await toybacoAbortQuietly(session.key, session.uid);
      return toybacoUploadError(res, 409, 'UPLOAD_PART_INVALID', 'アップロード分割情報が不正です');
    }
    completionAttempted = true;
    const completed = await R2.send(
      new CompleteMultipartUploadCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        UploadId: session.uid,
        MultipartUpload: {
          Parts: storedParts.map((part: any) => ({ PartNumber: part.PartNumber, ETag: part.ETag })),
        },
      })
    );
    const objectHead = await R2.send(
      new HeadObjectCommand({ Bucket: CLOUDFLARE_BUCKETNAME, Key: session.key })
    );
    const prefixObject = await R2.send(
      new GetObjectCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        Range: 'bytes=0-8191',
      })
    );
    const chunks: Buffer[] = [];
    // @ts-ignore
    for await (const chunk of prefixObject.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const detected = await fileTypeFromBuffer(Buffer.concat(chunks));
    if (!toybacoStoredObjectMatches(objectHead, detected, session, organizationId)) {
      await toybacoDeleteQuietly(session.key);
      return toybacoUploadError(res, 409, 'UPLOAD_CONTENT_INVALID', 'メディア内容を確認できませんでした');
    }
    return {
      Location: `${CLOUDFLARE_BUCKET_URL}/${session.key}`,
      Key: session.key,
      OriginalName: session.name,
      ETag: completed.ETag,
    };
  } catch {
    // Completeの応答喪失を含め、確定処理を開始した後の検証不能objectは公開しない。
    if (completionAttempted) await toybacoDeleteQuietly(session.key);
    return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'メディアを確定できませんでした');
  }
}

export async function abortMultipartUpload(organizationId: string, req: Request, res: Response) {
  const session = toybacoSessionFromRequest(req, organizationId);
  if (!session) {
    return toybacoUploadError(res, 403, 'UPLOAD_SESSION_INVALID', 'アップロード情報を確認できませんでした');
  }
  try {
    await R2.send(
      new AbortMultipartUploadCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        UploadId: session.uid,
      })
    );
    return res.status(200).json({ aborted: true });
  } catch {
    return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'アップロードを中止できませんでした');
  }
}

export async function signPart(organizationId: string, req: Request, res: Response) {
  const session = toybacoSessionFromRequest(req, organizationId);
  const partNumber = session ? toybacoReadPartNumber(req.body?.partNumber, session) : null;
  if (!session || partNumber === null) {
    return toybacoUploadError(res, 403, 'UPLOAD_SESSION_INVALID', 'アップロード情報を確認できませんでした');
  }
  try {
    const command = new UploadPartCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: session.key,
      PartNumber: partNumber,
      UploadId: session.uid,
      ContentLength: toybacoExpectedPartSize(session.size, partNumber)!,
    });
    const url = await getSignedUrl(R2, command, {
      expiresIn: Math.max(1, Math.min(600, session.exp - Math.floor(Date.now() / 1000) - 1)),
    });
    return res.status(200).json({ url });
  } catch {
    return toybacoUploadError(res, 502, 'UPLOAD_STORAGE_ERROR', 'アップロード先を発行できませんでした');
  }
}
