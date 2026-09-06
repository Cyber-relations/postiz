export interface Params {
  baseUrl: string;
  beforeRequest?: (url: string, options: RequestInit) => Promise<RequestInit>;
  afterRequest?: (
    url: string,
    options: RequestInit,
    response: Response
  ) => Promise<boolean>;
}
export const customFetch = (
  params: Params,
  auth?: string,
  showorg?: string,
  secured: boolean = true
) => {
  return async function newFetch(url: string, options: RequestInit = {}) {
    const loggedAuth =
      typeof window === 'undefined'
        ? undefined
        : new URL(window.location.href).searchParams.get('loggedAuth');
    const newRequestObject = await params?.beforeRequest?.(url, options);
    const authNonSecuredCookie =
      typeof document === 'undefined'
        ? null
        : document.cookie
            .split(';')
            .find((p) => p.includes('auth='))
            ?.split('=')[1];

    const authNonSecuredOrg =
      typeof document === 'undefined'
        ? null
        : document.cookie
            .split(';')
            .find((p) => p.includes('showorg='))
            ?.split('=')[1];

    const authNonSecuredImpersonate =
      typeof document === 'undefined'
        ? null
        : document.cookie
            .split(';')
            .find((p) => p.includes('impersonate='))
            ?.split('=')[1];

    // Merge case-insensitively: duplicate Content-Type values bypass JSON parsing.
    const requestOptions = newRequestObject || options;
    const requestHeaders = new Headers({
      ...(showorg
        ? { showorg }
        : authNonSecuredOrg
        ? { showorg: authNonSecuredOrg }
        : {}),
      ...(requestOptions.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      Accept: 'application/json',
      ...(loggedAuth ? { auth: loggedAuth } : {}),
    });
    new Headers(newRequestObject?.headers || options?.headers).forEach((value, key) => {
      requestHeaders.set(key, value);
    });
    if (auth || authNonSecuredCookie) {
      requestHeaders.set('auth', auth || authNonSecuredCookie!);
    }
    if (authNonSecuredImpersonate) {
      requestHeaders.set('impersonate', authNonSecuredImpersonate);
    }

    const fetchRequest = await fetch(params.baseUrl + url, {
      ...(secured ? { credentials: 'include' } : {}),
      ...(newRequestObject || options),
      headers: requestHeaders,
      // @ts-ignore
      ...(!options.next && options.cache !== 'force-cache'
        ? { cache: options.cache || 'no-store' }
        : {}),
    });

    if (
      !params?.afterRequest ||
      (await params?.afterRequest?.(url, options, fetchRequest))
    ) {
      return fetchRequest;
    }

    // @ts-ignore
    return new Promise((res) => {}) as Response;
  };
};

export const fetchBackend = customFetch({
  get baseUrl() {
    return process.env.BACKEND_URL!;
  },
});
