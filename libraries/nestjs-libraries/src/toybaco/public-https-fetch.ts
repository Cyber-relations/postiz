import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

// toybaco_autopost_ssrf_guard_v1: RSS feeds, article pages and media are
// fetched from addresses a store or the AI assistant supplies. Every hop must
// be a public HTTPS URL, the connection goes through the pinned-DNS
// dispatcher (so DNS rebinding cannot swap in an internal address after the
// check), redirects are followed by hand so each new address is checked
// again, and the hop count and total time are bounded. Text bodies are
// bounded in size as well.
export const TOYBACO_PUBLIC_FETCH_MAX_REDIRECTS = 5;
export const TOYBACO_PUBLIC_FETCH_MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const TOYBACO_PUBLIC_FETCH_TIMEOUT_MS = 20_000;

type ToybacoFetch = (
  input: string,
  init: Record<string, unknown>
) => Promise<Response>;

export type ToybacoPublicFetchOptions = {
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
};

export class ToybacoUnsafeFetchError extends Error {}

// isSafePublicHttpsUrl resolves the name with dns.lookup, which takes no
// signal. Settle at the shared deadline instead of waiting for a slow
// resolver; the connect-time check in the dispatcher still applies.
function toybacoWithin<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_TIMEOUT'));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
}

async function toybacoDiscard(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The body is not needed; a failed cancel changes nothing.
  }
}

async function toybacoReadBounded(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length') || '0');
  if (declared > maxBytes) {
    await toybacoDiscard(response);
    throw new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_TOO_LARGE');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const size = value.byteLength;
    if (total + size > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Already closed.
      }
      throw new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_TOO_LARGE');
    }
    total += size;
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

// Returns the final 2xx response. The deadline also covers reading its body.
export async function toybacoFetchPublic(
  url: string,
  options: ToybacoPublicFetchOptions = {}
): Promise<Response> {
  const request = fetch as unknown as ToybacoFetch;
  const maxRedirects =
    options.maxRedirects ?? TOYBACO_PUBLIC_FETCH_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(
    options.timeoutMs ?? TOYBACO_PUBLIC_FETCH_TIMEOUT_MS
  );
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (signal.aborted) {
      throw new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_TIMEOUT');
    }
    if (!(await toybacoWithin(isSafePublicHttpsUrl(current), signal))) {
      throw new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_UNSAFE_URL');
    }
    const response = await request(current, {
      dispatcher: ssrfSafeDispatcher,
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await toybacoDiscard(response);
      if (!location) {
        throw new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_BAD_REDIRECT');
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      await toybacoDiscard(response);
      throw new ToybacoUnsafeFetchError(
        `TOYBACO_PUBLIC_FETCH_HTTP_${response.status}`
      );
    }
    return response;
  }
  throw new ToybacoUnsafeFetchError('TOYBACO_PUBLIC_FETCH_TOO_MANY_REDIRECTS');
}

export async function toybacoFetchPublicText(
  url: string,
  options: ToybacoPublicFetchOptions = {}
): Promise<string> {
  const response = await toybacoFetchPublic(url, options);
  return toybacoReadBounded(
    response,
    options.maxBytes ?? TOYBACO_PUBLIC_FETCH_MAX_TEXT_BYTES
  );
}
