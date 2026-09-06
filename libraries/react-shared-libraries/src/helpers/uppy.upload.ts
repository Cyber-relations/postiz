import XHRUpload from '@uppy/xhr-upload';
import AwsS3Multipart from '@uppy/aws-s3';
import Transloadit from '@uppy/transloadit';
const fetchUploadApiEndpoint = async (
  fetch: any,
  endpoint: string,
  data: any
) => {
  const res = await fetch(`/media/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
  }).catch((error: Error) => {
    if (error?.message === 'TOYBACO_COMPOSER_RECONNECT_REQUIRED') throw error;
    throw new Error(endpoint === 'complete-multipart-upload'
      ? 'TOYBACO_UPLOAD_RESULT_UNKNOWN' : 'TOYBACO_UPLOAD_FAILED');
  });
  // toybaco_upload_response_v1: never treat an HTTP error body as upload metadata.
  if (res.status === 401 || res.headers.get('logout') ||
      (res.status === 409 && res.headers.get('x-toybaco-session') === 'identity-changed')) {
    throw new Error('TOYBACO_UPLOAD_RECONNECT_REQUIRED');
  }
  const payload = await res.json().catch(() => {
    throw new Error(endpoint === 'complete-multipart-upload'
      ? 'TOYBACO_UPLOAD_RESULT_UNKNOWN' : 'TOYBACO_UPLOAD_FAILED');
  });
  if (!res.ok) {
    const code = payload?.code;
    if (['UPLOAD_INVALID_FILE', 'UPLOAD_TOO_LARGE', 'UPLOAD_CONTENT_INVALID'].includes(code)) {
      throw new Error('TOYBACO_UPLOAD_INVALID_FILE');
    }
    if (code === 'UPLOAD_SESSION_INVALID') {
      throw new Error('TOYBACO_UPLOAD_SESSION_INVALID');
    }
    throw new Error(endpoint === 'complete-multipart-upload'
      ? 'TOYBACO_UPLOAD_RESULT_UNKNOWN' : 'TOYBACO_UPLOAD_FAILED');
  }
  if (endpoint === 'complete-multipart-upload' &&
      (typeof payload?.saved?.id !== 'string' || !payload.saved.id ||
       typeof payload?.saved?.path !== 'string' || !payload.saved.path)) {
    throw new Error('TOYBACO_UPLOAD_RESULT_UNKNOWN');
  }
  if (endpoint === 'create-multipart-upload' &&
      (typeof payload?.key !== 'string' || !payload.key ||
       typeof payload?.uploadId !== 'string' || !payload.uploadId)) {
    throw new Error('TOYBACO_UPLOAD_FAILED');
  }
  return payload;
};

// Define the factory to return appropriate Uppy configuration
export const getUppyUploadPlugin = (
  provider: string,
  fetch: any,
  backendUrl: string,
  transloadit: string[] = []
) => {
  switch (provider) {
    case 'transloadit':
      return {
        plugin: Transloadit,
        options: {
          waitForEncoding: true,
          alwaysRunAssembly: true,
          assemblyOptions: {
            params: {
              auth: { key: transloadit[0] },
              template_id: transloadit[1],
            },
          },
        },
      };
    case 'cloudflare':
      return {
        plugin: AwsS3Multipart,
        options: {
          // toybaco_upload_client_boundary_v1: browser/ECSへ全体bufferを作らない。
          shouldUseMultipart: (_file: any) => true,
          getChunkSize: (_file: any) => 10 * 1024 * 1024,
          // Retry only through the user's explicit action, including after SSO recovery.
          retryDelays: [],
          endpoint: '',
          createMultipartUpload: (file: any) =>
            fetchUploadApiEndpoint(fetch, 'create-multipart-upload', {
              file: { name: file.name, size: file.size, type: file.type },
              contentType: file.type,
            }),
          listParts: (_file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'list-parts', {
              key: props.key,
              uploadId: props.uploadId,
            }),
          signPart: (_file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'sign-part', {
              key: props.key,
              uploadId: props.uploadId,
              partNumber: props.partNumber,
            }),
          // Uppy starts cleanup without awaiting it; preserve the original upload error.
          abortMultipartUpload: (_file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'abort-multipart-upload', {
              key: props.key,
              uploadId: props.uploadId,
            }).catch(() => undefined),
          completeMultipartUpload: (_file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'complete-multipart-upload', {
              key: props.key,
              uploadId: props.uploadId,
              parts: props.parts,
            }),
        },
      };
    case 'local':
      return {
        plugin: XHRUpload,
        options: {
          endpoint: `${backendUrl}/media/upload-server`,
          withCredentials: true,
        },
      };

    // Add more cases for other cloud providers
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
};
