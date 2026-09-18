import { ForbiddenException } from '@nestjs/common';
import { toybacoOrganizationPolicy } from './posting-draft-bridge';

export async function toybacoLegacyRssAllowed(organizationId: string): Promise<boolean> {
  if (process.env.POSTIZ_OAUTH_CLIENT_ID !== 'toybaco-postiz') return true;
  return !(await toybacoOrganizationPolicy(organizationId)).shared;
}

export async function toybacoRequireLegacyRss(organizationId: string) {
  if (!(await toybacoLegacyRssAllowed(organizationId))) {
    throw new ForbiddenException('AI文案は投稿作成で利用できます。RSSは原文で取り込めます。');
  }
}

export function toybacoRejectUnscopedAgent() {
  if (process.env.POSTIZ_OAUTH_CLIENT_ID === 'toybaco-postiz') {
    throw new ForbiddenException('投稿欄のトイバコAIをご利用ください。');
  }
}
