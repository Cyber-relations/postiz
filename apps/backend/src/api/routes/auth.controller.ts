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

// toybaco_identity_boundary_v1: 認証cookieは post.toybaco.jp host-only に固定。
const TOYBACO_RETURN_PATHS = ['/launches', '/analytics', '/media', '/settings'];
const TOYBACO_SESSION_COOKIES = ['auth', 'showorg', 'impersonate', 'oauth_state'];

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
  const parsed = new URL(value, 'https://post.toybaco.invalid');
  if (
    parsed.origin !== 'https://post.toybaco.invalid' ||
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

function clearToybacoCookies(response: Response, includeReturn = false) {
  const domain = getCookieUrlFromDomain(process.env.FRONTEND_URL || '');
  const names = includeReturn
    ? [...TOYBACO_SESSION_COOKIES, 'toybaco_return']
    : TOYBACO_SESSION_COOKIES;
  for (const name of names) {
    expireToybacoCookie(response, name);
    expireToybacoCookie(response, name, domain);
  }
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

  // iframeを開くたび、古いPostiz sessionを破棄してChatwootへ再束縛する専用入口。
  @Get('/toybaco-entry')
  async toybacoEntry(
    @Query('return') returnPath: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const safeReturn = toybacoSafeReturnPath(returnPath);
    if (!safeReturn) {
      clearToybacoCookies(response, true);
      return response.status(400).json({
        code: 'TOYBACO_IDENTITY_INVALID_RETURN',
        message: '投稿画面の移動先が不正です',
      });
    }

    try {
      const state = `toybaco-${makeId(32)}`;
      clearToybacoCookies(response, true);
      response.cookie('toybaco_return', safeReturn, {
        ...toybacoHostCookieOptions(),
        expires: new Date(Date.now() + 10 * 60 * 1000),
      });
      response.cookie('oauth_state', state, {
        ...toybacoHostCookieOptions(),
        expires: new Date(Date.now() + 10 * 60 * 1000),
      });
      const link = await this._authService.oauthLink(Provider.GENERIC, {
        state,
      });
      return response.redirect(303, link);
    } catch (_error) {
      clearToybacoCookies(response, true);
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

    try {
      const { jwt, token, organizationId } =
        await this._authService.checkExists(
          provider,
          code,
          redirect_uri,
          state,
          req?.cookies?.oauth_state
        );

      if (generic) {
        if (!jwt || token || !organizationId) {
          throw new Error('trusted membership is missing');
        }
        // 旧domain cookieを消してから、host-onlyのauth/showorgだけを再発行する。
        clearToybacoCookies(response);
        response.cookie('auth', jwt, {
          ...toybacoHostCookieOptions(),
          expires: new Date(Date.now() + 10 * 60 * 1000),
        });
        response.cookie('showorg', organizationId, {
          ...toybacoHostCookieOptions(),
          expires: new Date(Date.now() + 10 * 60 * 1000),
        });
        if (process.env.NOT_SECURED) {
          response.header('auth', jwt);
          response.header('showorg', organizationId);
        }
        response.header('reload', 'true');
        return response.status(200).json({ login: true });
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
      clearToybacoCookies(response, true);
      return response.status(403).json({
        code: 'TOYBACO_IDENTITY_DENIED',
        message: 'トイバコIDで有効な所属を確認できませんでした',
      });
    }
  }
}
