type SettingsFetch = (path: string, options?: RequestInit) => Promise<Response>;
export class SettingsRequestError extends Error {
  constructor(public readonly kind: 'http' | 'network' | 'timeout' | 'invalid-response', public readonly status?: number) {
    super('SETTINGS_REQUEST_FAILED');
    this.name = 'SettingsRequestError';
  }
}

async function settingsRequest<T>(fetch: SettingsFetch, path: string, options: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => {
      const response = await fetch(path, { ...options, signal: controller.signal });
      if (!response.ok) throw new SettingsRequestError('http', response.status);
      return await read(response);
    })(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new SettingsRequestError('timeout')); }, 15000);
    })]);
  } catch (error) {
    if (error instanceof SettingsRequestError) throw error;
    throw new SettingsRequestError('network');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function readSettings<T>(fetch: SettingsFetch, path: string, validate: (value: unknown) => value is T, options: RequestInit = {}): Promise<T> {
  return settingsRequest(fetch, path, options, async response => {
    let value: unknown;
    try { value = await response.json(); } catch { throw new SettingsRequestError('invalid-response'); }
    if (!validate(value)) throw new SettingsRequestError('invalid-response');
    return value;
  });
}

// A successful write may return an empty body. Never replay a timed-out write.
export function writeSettings(fetch: SettingsFetch, path: string, options: RequestInit): Promise<void> {
  return settingsRequest(fetch, path, options, async () => undefined);
}

export function settingsWriteUncertain(error: unknown): boolean {
  return !(error instanceof SettingsRequestError) || error.kind === 'network' || error.kind === 'timeout' ||
    (error.kind === 'http' && (error.status || 0) >= 500);
}

export function settingsWriteMessage(error: unknown, action: '保存' | '削除' = '保存'): string {
  if (settingsWriteUncertain(error)) return `${action}結果を確認できません。一覧を確認し、反映済みでないことを確かめてから、もう一度お試しください。`;
  if (error instanceof SettingsRequestError && error.status === 403) return `${action}する権限を確認できません。管理者にご確認ください。`;
  return `${action}できませんでした。内容を確認して、もう一度お試しください。`;
}
