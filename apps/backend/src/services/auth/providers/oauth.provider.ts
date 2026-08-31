import {
  AuthProvider,
  AuthProviderAbstract,
  AuthProviderIdentity,
} from '@gitroom/backend/services/auth/providers.interface';

// toybaco_identity_boundary_v1: Chatwoot userinfo を閉じた型として検証する。
const TOYBACO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOYBACO_SUBJECT = /^cw:[1-9][0-9]{0,18}$/;
const TOYBACO_EXTERNAL_ACCOUNT = /^[1-9][0-9]{0,18}$/;
const TOYBACO_ROLES = new Set(['ADMIN', 'USER']);

function invalidIdentity(): never {
  throw new Error('トイバコIDの応答を確認できませんでした');
}

export function toybacoValidateOidcUserInfo(
  payload: unknown
): AuthProviderIdentity {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalidIdentity();
  }
  const value = payload as Record<string, unknown>;
  const organization = value.org;
  if (
    !organization ||
    typeof organization !== 'object' ||
    Array.isArray(organization)
  ) {
    return invalidIdentity();
  }
  const org = organization as Record<string, unknown>;
  const email = value.email;
  const id = value.sub;
  const organizationId = org.id;
  const externalId = org.external_id;
  const name = org.name;
  const role = org.role;

  if (
    typeof email !== 'string' ||
    email.length < 3 ||
    email.length > 320 ||
    value.email_verified !== true ||
    typeof id !== 'string' ||
    id.length > 64 ||
    !TOYBACO_SUBJECT.test(id) ||
    typeof organizationId !== 'string' ||
    organizationId !== organizationId.toLowerCase() ||
    !TOYBACO_UUID.test(organizationId) ||
    typeof externalId !== 'string' ||
    !TOYBACO_EXTERNAL_ACCOUNT.test(externalId) ||
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 200 ||
    typeof role !== 'string' ||
    !TOYBACO_ROLES.has(role)
  ) {
    return invalidIdentity();
  }

  return {
    email,
    id,
    organization: {
      id: organizationId,
      externalId,
      name,
      role: role as 'ADMIN' | 'USER',
    },
  };
}

@AuthProvider({ provider: 'GENERIC' })
export class OauthProvider extends AuthProviderAbstract {
  private getConfig() {
    const {
      POSTIZ_OAUTH_AUTH_URL,
      POSTIZ_OAUTH_CLIENT_ID,
      POSTIZ_OAUTH_CLIENT_SECRET,
      POSTIZ_OAUTH_TOKEN_URL,
      POSTIZ_OAUTH_USERINFO_URL,
      FRONTEND_URL,
    } = process.env;

    if (
      !POSTIZ_OAUTH_USERINFO_URL ||
      !POSTIZ_OAUTH_TOKEN_URL ||
      !POSTIZ_OAUTH_CLIENT_ID ||
      !POSTIZ_OAUTH_CLIENT_SECRET ||
      !POSTIZ_OAUTH_AUTH_URL ||
      !FRONTEND_URL
    ) {
      throw new Error('トイバコIDを利用できません');
    }

    return {
      authUrl: POSTIZ_OAUTH_AUTH_URL,
      clientId: POSTIZ_OAUTH_CLIENT_ID,
      clientSecret: POSTIZ_OAUTH_CLIENT_SECRET,
      tokenUrl: POSTIZ_OAUTH_TOKEN_URL,
      userInfoUrl: POSTIZ_OAUTH_USERINFO_URL,
      frontendUrl: FRONTEND_URL,
    };
  }

  generateLink(query?: { state?: string }): string {
    const state = query?.state;
    if (
      typeof state !== 'string' ||
      !/^toybaco-[A-Za-z0-9_-]{20,96}$/.test(state)
    ) {
      throw new Error('トイバコIDの開始情報が不正です');
    }

    const { authUrl, clientId, frontendUrl } = this.getConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'openid profile email',
      response_type: 'code',
      state,
      return_to: `${frontendUrl}/settings`,
    });

    return `${authUrl}?${params.toString()}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    if (typeof code !== 'string' || code.length < 1 || code.length > 2048) {
      throw new Error('トイバコIDの認可コードが不正です');
    }
    const { tokenUrl, clientId, clientSecret, frontendUrl } = this.getConfig();
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${frontendUrl}/settings`,
      }),
    });

    if (!response.ok) {
      throw new Error('トイバコIDで本人確認できませんでした');
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const accessToken = payload?.access_token;
    if (
      typeof accessToken !== 'string' ||
      accessToken.length < 1 ||
      accessToken.length > 8192
    ) {
      throw new Error('トイバコIDの応答を確認できませんでした');
    }
    return accessToken;
  }

  async getUser(accessToken: string): Promise<AuthProviderIdentity> {
    if (
      typeof accessToken !== 'string' ||
      accessToken.length < 1 ||
      accessToken.length > 8192
    ) {
      throw new Error('トイバコIDのアクセストークンが不正です');
    }
    const { userInfoUrl } = this.getConfig();
    const response = await fetch(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('トイバコIDの所属を確認できませんでした');
    }
    return toybacoValidateOidcUserInfo(await response.json());
  }
}
