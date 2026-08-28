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
  });
  return res.json();
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
          abortMultipartUpload: (_file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'abort-multipart-upload', {
              key: props.key,
              uploadId: props.uploadId,
            }),
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
