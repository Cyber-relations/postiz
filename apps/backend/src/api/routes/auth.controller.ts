import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ResendActivationDto } from '@gitroom/nestjs-libraries/dtos/auth/resend-activation.dto';
import { ApiTags } from '@nestjs/swagger';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import * as Sentry from '@sentry/nestjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { verify as verifyJwt } from 'jsonwebtoken';

// toybaco_identity_boundary_v1: 認証cookieは post.toybaco.jp host-only に固定。
const TOYBACO_RETURN_PATHS = ['/launches', '/analytics', '/media', '/settings'];
const TOYBACO_FLOW_PREFIX = '__Host-toybaco_oidc_';
const TOYBACO_FLOW_STATE = /^toybaco-([A-Za-z0-9_-]{43})$/;
const TOYBACO_FLOW_COOKIE = /^__Host-toybaco_oidc_[A-Za-z0-9_-]{43}$/;
const TOYBACO_FLOW_TTL = 10 * 60;
const TOYBACO_RENEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOYBACO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type ToybacoRenewal = {
  requestId: string; documentId: string; frameId: string; accountId: string;
  userId: string; organizationId: string; role: 'ADMIN' | 'USER';
};
type ToybacoOidcFlow = {
  v: 1;
  state: string;
  returnPath: string;
  iat: number;
  exp: number;
  renewal?: ToybacoRenewal;
};

function toybacoValidRenewal(value: unknown): value is ToybacoRenewal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const renewal = value as ToybacoRenewal;
  return Object.keys(renewal).sort().join(',') === 'accountId,documentId,frameId,organizationId,requestId,role,userId' &&
    ['requestId', 'documentId', 'frameId'].every(key => typeof renewal[key as keyof ToybacoRenewal] === 'string' && TOYBACO_RENEW_ID.test(renewal[key as keyof ToybacoRenewal])) &&
    typeof renewal.accountId === 'string' && /^[1-9][0-9]{0,18}$/.test(renewal.accountId) &&
    typeof renewal.userId === 'string' && TOYBACO_ID.test(renewal.userId) &&
    typeof renewal.organizationId === 'string' && TOYBACO_ID.test(renewal.organizationId) &&
    ['ADMIN', 'USER'].includes(renewal.role);
}

function toybacoRenewalCompletion(renewal: ToybacoRenewal, ok: boolean) {
  const app = new URL(process.env.TOYBACO_APP_ORIGIN || '');
  if (app.protocol !== 'https:' || app.username || app.password || app.pathname !== '/' || app.search || app.hash) throw new Error('Invalid app origin');
  const { requestId, documentId, frameId, accountId } = renewal;
  return { appOrigin: app.origin, renewal: { requestId, documentId, frameId, accountId, ok } };
}

function toybacoCurrentRenewalOwner(req: Request, renewal: ToybacoRenewal): boolean {
  const cookie = req.headers.auth || req.cookies?.auth;
  if (cookie === undefined) return true;
  if (typeof cookie !== 'string' || !cookie) return false;
  try {
    // Signature verification with ignored expiry is a rejection constraint only.
    // Fresh issuer session/DB checks remain mandatory before renewing. This
    // avoids a late background renewal replacing another tab's selected owner.
    const payload = verifyJwt(cookie, process.env.JWT_SECRET!, { ignoreExpiration: true });
    return typeof payload === 'object' && payload.id === renewal.userId &&
      payload.toybacoOrganizationId === renewal.organizationId &&
      payload.toybacoIdentityVersion === 1 && payload.providerName === 'GENERIC';
  } catch { return false; }
}

function toybacoHostCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: true,
  };
}

function toybacoSafeReturnPath(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2000 ||
    !/^\/[A-Za-z0-9._~/?=&-]*$/.test(value) ||
    value.includes('%') ||
    value.includes('\\') ||
    value.includes('#')
  ) {
    return null;
  }
  const rawPath = value.split('?', 1)[0];
  if (rawPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  let parsed: URL;
  try { parsed = new URL(value, 'https://post.toybaco.invalid'); } catch { return null; }
  if (
    parsed.origin !== 'https://post.toybaco.invalid' ||
    [...parsed.searchParams.keys()].some((key) =>
      ['code', 'state', 'error', 'id_token', 'error_description', 'access_token'].includes(key.toLowerCase())
    ) ||
    !TOYBACO_RETURN_PATHS.some(
      (prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }
  return parsed.pathname + parsed.search;
}

function expireToybacoCookie(
  response: Response,
  name: string,
  domain?: string
) {
  response.cookie(name, '', {
    ...toybacoHostCookieOptions(),
    ...(domain ? { domain } : {}),
    expires: new Date(0),
    maxAge: -1,
  });
}

function toybacoFlowName(state: unknown): string | null {
  if (typeof state !== 'string') return null;
  const match = TOYBACO_FLOW_STATE.exec(state);
  return match ? TOYBACO_FLOW_PREFIX + match[1] : null;
}

function toybacoFlowMac(payload: string): Buffer {
  const secret = process.env.JWT_SECRET;
  const issuer = new URL(process.env.FRONTEND_URL || '');
  if (!secret || issuer.protocol !== 'https:' || issuer.username || issuer.password) {
    throw new Error('OIDC flow configuration is unavailable');
  }
  // Different purpose and wire format from auth JWTs, including the deployment origin.
  return createHmac('sha256', secret)
    .update(`toybaco/postiz/oidc-flow\0v1\0${issuer.origin}\0${payload}`)
    .digest();
}

function toybacoSignFlow(flow: ToybacoOidcFlow): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `v1~${payload}~${toybacoFlowMac(payload).toString('base64url')}`;
}

function toybacoReadFlow(req: Request, state: unknown): ToybacoOidcFlow | null {
  const name = toybacoFlowName(state);
  const value: unknown = name ? req.cookies?.[name] : undefined;
  if (typeof value !== 'string' || value.length > 3072) return null;
  const parts = /^v1~([A-Za-z0-9_-]+)~([A-Za-z0-9_-]{43})$/.exec(value);
  if (!parts) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url');
    const mac = Buffer.from(parts[2], 'base64url');
    if (payload.toString('base64url') !== parts[1] || mac.toString('base64url') !== parts[2] ||
        mac.length !== 32 || !timingSafeEqual(mac, toybacoFlowMac(parts[1]))) return null;
    const flow: unknown = JSON.parse(payload.toString('utf8'));
    if (!flow || typeof flow !== 'object' || Array.isArray(flow) ||
        Object.keys(flow).sort().join(',') !== ('renewal' in flow ? 'exp,iat,renewal,returnPath,state,v' : 'exp,iat,returnPath,state,v') ||
        ('renewal' in flow && (!toybacoValidRenewal(flow.renewal) || !('returnPath' in flow) || flow.returnPath !== '/launches?tb_embed=1')) ||
        !('v' in flow) || flow.v !== 1 || !('state' in flow) || flow.state !== state ||
        !('returnPath' in flow) || typeof flow.returnPath !== 'string' || toybacoSafeReturnPath(flow.returnPath) !== flow.returnPath ||
        !('iat' in flow) || typeof flow.iat !== 'number' || !Number.isSafeInteger(flow.iat) || flow.iat < 0 ||
        !('exp' in flow) || typeof flow.exp !== 'number' || !Number.isSafeInteger(flow.exp) ||
        flow.exp - flow.iat !== TOYBACO_FLOW_TTL) return null;
    return flow as ToybacoOidcFlow;
  } catch {
    return null;
  }
}

function toybacoFlowCurrent(flow: ToybacoOidcFlow): boolean {
  const now = Math.floor(Date.now() / 1000);
  return flow.iat <= now && now < flow.exp;
}

function toybacoFlowBudget(req: Request, name: string, value: string): boolean {
  const pending = Object.entries(req.cookies || {}).filter(([key]) => TOYBACO_FLOW_COOKIE.test(key));
  const segment = `${name}=${value}`;
  const prior = pending.map(([key, entry]) => `${key}=${entry}`).join('; ');
  const header = req.headers.cookie || '';
  // Concurrent responses can see the same old jar: this is an issuance budget, not a shared lock.
  return pending.length < 4 && value.length <= 3072 &&
    Buffer.byteLength([prior, segment].filter(Boolean).join('; ')) <= 4096 &&
    Buffer.byteLength([header, segment].filter(Boolean).join('; ')) <= 6144;
}

function replaceToybacoLegacySession(response: Response) {
  const domain = getCookieUrlFromDomain(process.env.FRONTEND_URL || '');
  for (const name of ['auth', 'showorg', 'impersonate']) {
    expireToybacoCookie(response, name, domain);
  }
  expireToybacoCookie(response, 'impersonate');
}

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService
  ) {}

  @Get('/can-register')
  async canRegister() {
    return {
      register: await this._authService.canRegister(Provider.LOCAL as string),
    };
  }

  @Post('/register')
  async register(
    @Req() req: Request,
    @Body() body: CreateOrgUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      const activationRequired =
        body.provider === 'LOCAL' && this._emailService.hasProvider();

      if (activationRequired) {
        response.header('activate', 'true');
        response.status(200).json({ activate: true });
        return;
      }

      response.cookie('auth', jwt, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie('showorg', addedOrg.organizationId, {
          domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
          ...(!process.env.NOT_SECURED
            ? {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
              }
            : {}),
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        });

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
      }

      Sentry.metrics.count('new_user', 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/login')
  async login(
    @Req() req: Request,
    @Body() body: LoginUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      response.cookie('auth', jwt, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie('showorg', addedOrg.organizationId, {
          domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
          ...(!process.env.NOT_SECURED
            ? {
                secure: true,
                httpOnly: true,
                sameSite: 'none',
              }
            : {}),
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        });

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
      }

      response.header('reload', 'true');
      response.status(200).json({
        login: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/forgot')
  async forgot(@Body() body: ForgotPasswordDto) {
    try {
      await this._authService.forgot(body.email);
      return {
        forgot: true,
      };
    } catch (e) {
      return {
        forgot: false,
      };
    }
  }

  @Post('/forgot-return')
  async forgotReturn(@Body() body: ForgotReturnPasswordDto) {
    const reset = await this._authService.forgotReturn(body);
    return {
      reset: !!reset,
    };
  }

  @Get('/oauth-mobile-callback')
  mobileCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const scheme = process.env.MOBILE_APP_SCHEME || 'postiz://auth/callback';
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    return response.redirect(302, `${scheme}?${params.toString()}`);
  }

  // Each iframe binds its own return without interrupting another tab's session.
  @Get('/toybaco-entry')
  async toybacoEntry(
    @Req() req: Request,
    @Query('return') returnPath: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const safeReturn = toybacoSafeReturnPath(returnPath);
    const query = req.query || {};
    const renewal = query.purpose === 'renew' ? {
      requestId: query.request_id, documentId: query.document_id, frameId: query.frame_id, accountId: query.account_id,
      userId: query.user_id, organizationId: query.organization_id, role: query.role,
    } : undefined;
    if (!safeReturn || (query.purpose !== undefined && query.purpose !== 'renew') ||
        (renewal && (!toybacoValidRenewal(renewal) || safeReturn !== '/launches?tb_embed=1'))) {
      return response.status(400).json({
        code: 'TOYBACO_IDENTITY_INVALID_RETURN',
        message: '投稿画面の移動先が不正です',
      });
    }
    try {
      const state = `toybaco-${randomBytes(32).toString('base64url')}`;
      const name = toybacoFlowName(state)!;
      const iat = Math.floor(Date.now() / 1000);
      const flow: ToybacoOidcFlow = { v: 1, state, returnPath: safeReturn, iat, exp: iat + TOYBACO_FLOW_TTL,
        ...(toybacoValidRenewal(renewal) ? { renewal } : {}) };
      const value = toybacoSignFlow(flow);
      if (!toybacoFlowBudget(req, name, value)) {
        return response.status(429).json({
          code: 'TOYBACO_IDENTITY_FLOW_LIMIT',
          message: '接続の確認が複数進行中です。完了してからもう一度お試しください',
        });
      }
      const link = await this._authService.oauthLink(Provider.GENERIC, { state, ...(flow.renewal ? { renewal: true } : {}) });
      response.cookie(name, value, {
        ...toybacoHostCookieOptions(),
        expires: new Date(flow.exp * 1000),
        maxAge: TOYBACO_FLOW_TTL * 1000,
      });
      return response.redirect(303, link);
    } catch (_error) {
      return response.status(503).json({
        code: 'TOYBACO_IDENTITY_UNAVAILABLE',
        message: 'トイバコIDを現在利用できません',
      });
    }
  }

  @Get('/oauth/:provider')
  async oauthLink(
    @Param('provider') provider: string,
    @Query() query: any,
    @Res({ passthrough: true }) response: Response
  ) {
    if (provider.toUpperCase() === Provider.GENERIC) {
      return response.status(403).json({
        code: 'TOYBACO_IDENTITY_ENTRY_REQUIRED',
        message: '投稿画面の入口から開いてください',
      });
    }

    const state = `login-${makeId(16)}`;
    response.cookie('oauth_state', state, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 10),
    });

    return this._authService.oauthLink(provider, { ...query, state });
  }

  @Post('/activate')
  async activate(
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const activate = await this._authService.activate(
      code,
      datafast_visitor_id
    );
    if (!activate) {
      return response.status(200).json({ can: false });
    }

    response.cookie('auth', activate, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('auth', activate);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  @Post('/resend-activation')
  async resendActivation(@Body() body: ResendActivationDto) {
    try {
      await this._authService.resendActivationEmail(body.email);
      return {
        success: true,
      };
    } catch (e: any) {
      return {
        success: false,
        message: e.message,
      };
    }
  }

  @Post('/oauth/:provider/redirect')
  oauthRedirect(
    @Param('provider') provider: string,
    @Body('code') code: string,
    @Body('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    if (!code) {
      return response.redirect(303, `${process.env.FRONTEND_URL}/auth/login`);
    }

    const params = new URLSearchParams();
    params.set('code', code);
    if (state) params.set('state', state);
    params.set('provider', provider.toUpperCase());
    return response.redirect(
      303,
      `${process.env.FRONTEND_URL}/auth?${params.toString()}`
    );
  }

  @Post('/oauth/:provider/exists')
  async oauthExists(
    @Req() req: Request,
    @Body('code') code: string,
    @Body('redirect_uri') redirect_uri: string,
    @Body('state') state: string,
    @Body('error') providerError: unknown,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const generic = provider.toUpperCase() === Provider.GENERIC;
    if (!req.headers['content-type']?.includes('application/json')) {
      return generic
        ? response.status(400).json({
            code: 'TOYBACO_IDENTITY_INVALID_REQUEST',
            message: '本人確認のリクエストが不正です',
          })
        : response.status(400).send('Invalid request');
    }

    const flow = generic ? toybacoReadFlow(req, state) : null;
    try {
      if (generic && (!flow || !toybacoFlowCurrent(flow) ||
          providerError !== undefined || typeof code !== 'string' || !code || code.length > 2048)) {
        throw new Error('OIDC flow is invalid');
      }
      const { jwt, token, organizationId, cookieExpiresAt } =
        await this._authService.checkExists(
          provider,
          code,
          redirect_uri,
          state,
          generic ? flow?.state : req?.cookies?.oauth_state,
          flow?.renewal
        );

      if (generic) {
        if (!jwt || token || !organizationId || !flow || !toybacoFlowCurrent(flow)) {
          throw new Error('trusted membership is missing');
        }
        if (flow.renewal && (!cookieExpiresAt || cookieExpiresAt <= Math.floor(Date.now() / 1000))) throw new Error('Renewal expired');
        if (flow.renewal && !toybacoCurrentRenewalOwner(req, flow.renewal)) throw new Error('Current session owner changed');
        const completion = flow.renewal ? toybacoRenewalCompletion(flow.renewal, true) : null;
        replaceToybacoLegacySession(response);
        response.cookie('auth', jwt, {
          ...toybacoHostCookieOptions(),
          expires: flow.renewal ? new Date(cookieExpiresAt! * 1000) : new Date(Date.now() + 10 * 60 * 1000),
        });
        response.cookie('showorg', organizationId, {
          ...toybacoHostCookieOptions(),
          expires: flow.renewal ? new Date(cookieExpiresAt! * 1000) : new Date(Date.now() + 10 * 60 * 1000),
        });
        expireToybacoCookie(response, toybacoFlowName(flow.state)!);
        if (completion) return response.status(200).json(completion);
        return response.status(200).json({ login: true, returnPath: flow.returnPath });
      }

      if (token) {
        return response.json({ token });
      }
      response.cookie('auth', jwt, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? { secure: true, httpOnly: true, sameSite: 'none' }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
      if (process.env.NOT_SECURED && jwt) {
        response.header('auth', jwt);
      }
      response.header('reload', 'true');
      return response.status(200).json({ login: true });
    } catch (error) {
      if (!generic) throw error;
      // A stale callback must not clear another flow or an established session.
      if (flow) {
        expireToybacoCookie(response, toybacoFlowName(flow.state)!);
      }
      if (flow?.renewal) return response.status(403).json(toybacoRenewalCompletion(flow.renewal, false));
      return response.status(403).json({
        code: 'TOYBACO_IDENTITY_DENIED',
        message: 'トイバコIDで有効な所属を確認できませんでした',
      });
    }
  }
}
