import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { toybacoPostingPolicy } from '@gitroom/nestjs-libraries/toybaco/posting-draft-bridge';

@Injectable()
export class ToybacoLegacyAiGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // AuthMiddleware supplies both objects from the current database, never
    // from composer headers or the body. Preserve standalone upstream users.
    if (request.user?.providerName !== 'GENERIC' && process.env.POSTIZ_OAUTH_CLIENT_ID !== 'toybaco-postiz') return true;
    const policy = await toybacoPostingPolicy(request.user, request.org);
    if (policy.shared) throw new ForbiddenException('投稿欄のトイバコAIをご利用ください。');
    return true;
  }
}
