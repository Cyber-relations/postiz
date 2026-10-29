import {
  toybacoFetchPublic,
  ToybacoUnsafeFetchError,
} from '@gitroom/nestjs-libraries/toybaco/public-https-fetch';

// toybaco_media_fetch_guard_v1: media is read only from a public HTTPS URL,
// through the same path as other user-influenced fetches (public-HTTPS check
// on every redirect, pinned-DNS dispatcher, bounded redirects and time).
// Toybaco stores media in S3 over HTTPS, so there is no local-file branch: a
// non-HTTPS path is an error, never a file read.
export const readOrFetch = async (path: string): Promise<Buffer> => {
  if (typeof path !== 'string' || !path.startsWith('https://')) {
    throw new ToybacoUnsafeFetchError('Media path must be a public HTTPS URL');
  }
  const response = await toybacoFetchPublic(path, { timeoutMs: 60_000 });
  return Buffer.from(await response.arrayBuffer());
};
