// toybaco_csprng_ids_v1: Math.random is not a cryptographic generator, and
// OAuth state values are built from makeId. The API, workers and browser
// components all import this module, so use Web Crypto (Node 22 and every
// supported browser provide it). Outside Temporal workflow code, never fall
// back to Math.random.
type ToybacoRandomSource = {
  getRandomValues(array: Uint8Array): Uint8Array;
};

const TOYBACO_ID_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// 248 = 4 * 62. Bytes at or above it are discarded so that every character
// is equally likely (no modulo bias).
const TOYBACO_ID_BYTE_LIMIT = 248;

export const makeId = (length: number) => {
  const scope = globalThis as unknown as {
    crypto?: ToybacoRandomSource;
    __TEMPORAL_ACTIVATOR__?: unknown;
  };
  // Temporal workflow code (older post workflows name child workflows with
  // makeId) runs in a replayed sandbox with no Web Crypto, where Math.random
  // is Temporal's seeded generator. Replay needs the original values, and
  // those ids are not secrets, so keep the original computation there only.
  // Same check as inWorkflowContext() in @temporalio/workflow.
  if (scope.__TEMPORAL_ACTIVATOR__ !== undefined) {
    let workflowText = '';
    for (let i = 0; i < length; i += 1) {
      workflowText += TOYBACO_ID_ALPHABET.charAt(
        Math.floor(Math.random() * TOYBACO_ID_ALPHABET.length)
      );
    }
    return workflowText;
  }
  const random = scope.crypto;
  if (!random || typeof random.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random source is unavailable');
  }
  let text = '';
  const bytes = new Uint8Array(64);
  while (text.length < length) {
    random.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && text.length < length; i += 1) {
      if (bytes[i] < TOYBACO_ID_BYTE_LIMIT) {
        text += TOYBACO_ID_ALPHABET.charAt(
          bytes[i] % TOYBACO_ID_ALPHABET.length
        );
      }
    }
  }
  return text;
};
