import { Injectable } from '@nestjs/common';

// toybaco_identity_boundary_v1: GENERIC だけが trusted org claim を持つ。
export type AuthProviderOrganization = {
  id: string;
  externalId: string;
  name: string;
  role: 'ADMIN' | 'USER';
};

export type AuthProviderIdentity = {
  email: string;
  id: string;
  organization?: AuthProviderOrganization;
};

export abstract class AuthProviderAbstract {
  abstract generateLink(query?: any): Promise<string> | string;
  abstract getToken(code: string, redirectUri?: string): Promise<string>;
  abstract getUser(
    providerToken: string
  ): Promise<AuthProviderIdentity> | false;
  async postRegistration(
    providerToken: string,
    orgId: string
  ): Promise<void> {}
}

export interface AuthProviderParams {
  provider: string;
}

export function AuthProvider(params: AuthProviderParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('auth-provider', AuthProviderAbstract) || [];

    existingMetadata.push({ target, provider: params.provider });

    Reflect.defineMetadata(
      'auth-provider',
      existingMetadata,
      AuthProviderAbstract
    );
  };
}
