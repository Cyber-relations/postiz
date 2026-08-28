import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import 'multer';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import mime from 'mime-types';
// @ts-ignore
import { getExtension } from 'mime';
import { IUploadProvider } from './upload.interface';
import axios from 'axios';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@gitroom/nestjs-libraries/upload/data.url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer } = require('file-type');

// toybaco_publishable_media_v1: 投稿まで通る形式だけを保持する。
const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
]);

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

class CloudflareStorage implements IUploadProvider {
  private _client: S3Client;

  constructor(
    accountID: string,
    accessKey: string,
    secretKey: string,
    private region: string,
    private _bucketName: string,
    private _uploadUrl: string
  ) {
    const toybacoS3 = toybacoResolveS3Options(
      process.env.S3_ENDPOINT,
      accountID,
      accessKey,
      secretKey
    );
    this._client = new S3Client({
      // toybaco_s3_tokyo_v3: AWSはTask Role、R2は明示キーで認証する。
      endpoint: toybacoS3.endpoint,
      region: process.env.S3_REGION?.trim() || region,
      ...toybacoS3.credentialOptions,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

    this._client.middlewareStack.add(
      (next) =>
        async (args): Promise<any> => {
          const request = args.request as RequestInit;

          // Remove checksum headers
          const headers = request.headers as Record<string, string>;
          delete headers['x-amz-checksum-crc32'];
          delete headers['x-amz-checksum-crc32c'];
          delete headers['x-amz-checksum-sha1'];
          delete headers['x-amz-checksum-sha256'];
          request.headers = headers;

          Object.entries(request.headers).forEach(
            // @ts-ignore
            ([key, value]: [string, string]): void => {
              if (!request.headers) {
                request.headers = {};
              }
              (request.headers as Record<string, string>)[key] = value;
            }
          );

          return next(args);
        },
      { step: 'build', name: 'customHeaders' }
    );
  }

  async uploadSimple(path: string) {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!(await isSafePublicHttpsUrl(path))) {
        throw new Error('Unsafe URL');
      }
      const loadImage = await fetch(path, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
      body = Buffer.from(await loadImage.arrayBuffer());
    }
    const detected = await fileTypeFromBuffer(body);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const extension = detected.ext;
    const safeContentType = detected.mime;
    const id = makeId(10);

    const params = {
      Bucket: this._bucketName,
      Key: `${id}.${extension}`,
      Body: body,
      ContentType: safeContentType,
      ChecksumMode: 'DISABLED',
    };

    const command = new PutObjectCommand({ ...params });
    await this._client.send(command);

    return `${this._uploadUrl}/${id}.${extension}`;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const detected = await fileTypeFromBuffer(file.buffer);
      if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const id = makeId(10);
      const extension = detected.ext;
      const safeContentType = detected.mime;

      // Create the PutObjectCommand to upload the file to Cloudflare R2
      const command = new PutObjectCommand({
        Bucket: this._bucketName,
        // トイバコ: S3 は ACL 無効が既定。true のときはACLを送らない。
        ...(process.env.S3_DISABLE_ACL === 'true'
          ? {}
          : { ACL: 'public-read' as const }),
        Key: `${id}.${extension}`,
        Body: file.buffer,
        ContentType: safeContentType,
      });

      await this._client.send(command);

      return {
        filename: `${id}.${extension}`,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
        originalname: `${id}.${extension}`,
        fieldname: 'file',
        path: `${this._uploadUrl}/${id}.${extension}`,
        destination: `${this._uploadUrl}/${id}.${extension}`,
        encoding: '7bit',
        stream: file.buffer as any,
      };
    } catch (err) {
      console.error('Error uploading file to Cloudflare R2:', err);
      throw err;
    }
  }

  // Implement the removeFile method from IUploadProvider
  async removeFile(filePath: string): Promise<void> {
    // const fileName = filePath.split('/').pop(); // Extract the filename from the path
    // const command = new DeleteObjectCommand({
    //   Bucket: this._bucketName,
    //   Key: fileName,
    // });
    // await this._client.send(command);
  }
}

export { CloudflareStorage };
export default CloudflareStorage;
