import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);
import compression from 'compression';

import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { json } from 'express';
import { Runtime } from '@temporalio/worker';
Runtime.install({ shutdownSignals: [] });

process.env.TZ = 'UTC';

import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { PostValidationExceptionFilter } from '@gitroom/backend/api/routes/posts.validation.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@gitroom/helpers/configuration/configuration.checker';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';

const TOYBACO_BLOCKED_API_PREFIXES = Object.freeze([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/openai-apps-challenge',
  '/.well-known/openid-configuration',
  '/admin',
  '/billing',
  '/enterprise',
  '/integrations/customers',
  '/integrations/moltbook',
  '/integrations/plug/list',
  '/integrations/plugs',
  '/integrations/telegram',
  '/mcp',
  '/mcp-oauth',
  '/mcp-oauth-claude',
  '/message',
  '/oauth',
  '/public/agent',
  '/public/modify-subscription',
  '/public/v1',
  '/settings/team',
  '/sse',
  '/stripe',
  '/third-party',
  '/user/agent-media-sso',
  '/user/approved-apps',
  '/user/api-key',
  '/user/chatbase-token',
  '/user/delete-account',
  '/user/impersonate',
  '/user/join-org',
  '/user/oauth-app',
  '/user/subscription',
  '/user/switch',
  '/webhooks',
]);

const TOYBACO_BLOCKED_API_PATTERNS = Object.freeze([
  /^\/integrations\/[^/]+\/(?:internal-plugs|plugs)(?:\/|$)/,
]);

function toybacoCanonicalPath(rawUrl) {
  let value = String(rawUrl || '/').split(/[?#]/, 1)[0] || '/';

  // %252f のような多重encodeも同じpathとして判定する。4回で収束しない
  // percent escapeは曖昧なため、許可側へ倒さず拒否する。
  for (let round = 0; round < 4; round++) {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return null;
    }
    if (decoded === value) break;
    value = decoded;
  }
  if (
    /%[0-9a-f]{2}/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  value = value.replace(/\\/g, '/');
  const segments = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  // Express/Nestの既定routerは大文字小文字を区別しない。境界側もASCIIを
  // 小文字化しないと /OAUTH のような表記だけcontrollerへ通ってしまう。
  return ('/' + segments.join('/')).replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase()
  );
}

function toybacoApiBlocked(rawUrl) {
  const pathname = toybacoCanonicalPath(rawUrl);
  if (pathname === null) return true;

  // Chatwootを唯一のidentity sourceにする。PostizのLOCAL/GitHub等の認証・
  // password recovery・登録は、既存LOCAL accountから同期を迂回できるため閉じる。
  if (pathname === '/auth' || pathname.startsWith('/auth/')) {
    return ![
      '/auth/can-register',
      '/auth/oauth/generic/exists',
      // iframe openごとにChatwootへ再束縛する専用入口だけを追加で通す。
      '/auth/toybaco-entry',
    ].includes(pathname);
  }
  return (
    TOYBACO_BLOCKED_API_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
    ) || TOYBACO_BLOCKED_API_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

async function start() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: {
      ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'auth',
        'showorg',
        'impersonate',
        'x-copilotkit-runtime-client-gql-version',
      ],
      exposedHeaders: [
        'reload',
        'onboarding',
        'activate',
        'x-copilotkit-runtime-client-gql-version',
        ...(process.env.NOT_SECURED ? ['auth', 'showorg', 'impersonate'] : []),
      ],
      origin: [
        process.env.FRONTEND_URL,
        'http://localhost:6274',
        ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
      ],
    },
  });

  // toybaco_product_boundary_v1: 非提供機能はcontroller/MCP登録より先に拒否する。
  app.use((req: any, res: any, next: any) => {
    if (toybacoApiBlocked(req.originalUrl || req.url)) {
      return res.status(403).json({
        code: 'TOYBACO_FEATURE_DISABLED',
        message: 'この機能は利用できません',
      });
    }
    return next();
  });

  await startMcp(app);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    })
  );

  app.use(['/copilot/{*splat}', '/posts'], (req: any, res: any, next: any) => {
    json({ limit: '50mb' })(req, res, next);
  });

  app.use(cookieParser());
  app.use(compression());
  app.useGlobalFilters(new SubscriptionExceptionFilter());
  app.useGlobalFilters(new PostValidationExceptionFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  loadSwagger(app);

  const port = process.env.PORT || 3000;

  try {
    await app.listen(port);
    console.log('Backend started successfully on port ' + port);

    checkConfiguration(); // Do this last, so that users will see obvious issues at the end of the startup log without having to scroll up.

    Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  } catch (e) {
    Logger.error(`Backend failed to start on port ${port}`, e);
  }
}

function checkConfiguration() {
  const checker = new ConfigurationChecker();
  checker.readEnvFromProcess();
  checker.check();

  if (checker.hasIssues()) {
    for (const issue of checker.getIssues()) {
      Logger.warn(issue, 'Configuration issue');
    }

    Logger.warn('Configuration issues found: ' + checker.getIssuesCount());
  } else {
    Logger.log('Configuration check completed without any issues');
  }
}

start();
