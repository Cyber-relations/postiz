import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Provider, Role, User } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { setSentryUserContext } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';

// toybaco_identity_boundary_v1: JWTのorg claimは毎request DB所属へ再束縛する。
const TOYBACO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOYBACO_ROLES = new Set<Role>([Role.ADMIN, Role.USER]);

function hostCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: true,
  };
}

function expireAuthCookie(res: Response, domain?: string) {
  res.cookie('auth', '', {
    ...hostCookieOptions(),
    ...(domain ? { domain } : {}),
    expires: new Date(0),
    maxAge: -1,
  });
}

export const removeAuth = (res: Response) => {
  // host-only 現行cookieと、旧 .toybaco.jp domain cookieを同時に消す。
  expireAuthCookie(res);
  expireAuthCookie(
    res,
    getCookieUrlFromDomain(process.env.FRONTEND_URL || '')
  );
  res.header('logout', 'true');
};

type ToybacoJwtPayload = User & {
  toybacoIdentityVersion?: unknown;
  toybacoOrganizationId?: unknown;
};

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _userService: UsersService
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.auth || req.cookies.auth;
    if (!auth || typeof auth !== 'string') {
      throw new HttpForbiddenException();
    }

    try {
      const payload = AuthService.verifyJWT(auth) as ToybacoJwtPayload | null;
      if (!payload?.id) {
        throw new HttpForbiddenException();
      }

      let user = (await this._userService.getUserById(payload.id)) as User | null;
      if (!user || !user.activated) {
        throw new HttpForbiddenException();
      }

      if (process.env.POSTIZ_GENERIC_OAUTH === 'true') {
        const toybacoOrganizationId = payload.toybacoOrganizationId;
        if (
          user.providerName !== Provider.GENERIC ||
          payload.toybacoIdentityVersion !== 1 ||
          typeof toybacoOrganizationId !== 'string' ||
          toybacoOrganizationId !== toybacoOrganizationId.toLowerCase() ||
          !TOYBACO_UUID.test(toybacoOrganizationId)
        ) {
          throw new HttpForbiddenException();
        }

        const organizations = await this._organizationService.getOrgsByUserId(
          user.id
        );
        // showorg / header / 配列先頭は一切使わず、署名済み不変claimと完全一致だけ。
        const organization = organizations.find(
          (candidate) => candidate.id === toybacoOrganizationId
        );
        const membership = organization?.users?.[0];
        if (
          !organization ||
          organization.users.length !== 1 ||
          !membership ||
          membership.disabled ||
          !TOYBACO_ROLES.has(membership.role)
        ) {
          throw new HttpForbiddenException();
        }

        const authenticatedRequest = req;
        delete user.password;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        authenticatedRequest.user = user;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        authenticatedRequest.org = organization;
        setSentryUserContext({
          userId: user.id,
          email: user.email,
          orgId: organization.id,
          paymentId: organization.paymentId,
        });
        next();
        return;
      }

      // Vanilla Postiz互換経路。トイバコ本番では上のfail-closed分岐だけを通る。
      const impersonate = req.cookies.impersonate || req.headers.impersonate;
      if (user.isSuperAdmin && impersonate) {
        const loadImpersonate = await this._organizationService.getUserOrg(
          impersonate
        );
        if (loadImpersonate) {
          user = loadImpersonate.user;
          user.isSuperAdmin = true;
          delete user.password;
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.user = user;
          // @ts-ignore
          loadImpersonate.organization.users =
            loadImpersonate.organization.users.filter(
              (candidate) => candidate.userId === user.id
            );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.org = loadImpersonate.organization;
          setSentryUserContext({
            userId: user.id,
            email: user.email,
            orgId: loadImpersonate.organization.id,
            paymentId: loadImpersonate.organization.paymentId,
          });
          next();
          return;
        }
      }

      delete user.password;
      const organizations = (
        await this._organizationService.getOrgsByUserId(user.id)
      ).filter((candidate) => !candidate.users[0]?.disabled);
      const orgHeader = req.cookies.showorg || req.headers.showorg;
      const organization =
        organizations.find((candidate) => candidate.id === orgHeader) ||
        organizations[0];
      if (!organization) {
        throw new HttpForbiddenException();
      }
      if (!organization.apiKey) {
        await this._organizationService.updateApiKey(organization.id);
      }
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.user = user;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.org = organization;
      setSentryUserContext({
        userId: user.id,
        email: user.email,
        orgId: organization.id,
        paymentId: organization.paymentId,
      });
    } catch (_error) {
      throw new HttpForbiddenException();
    }
    next();
  }
}
