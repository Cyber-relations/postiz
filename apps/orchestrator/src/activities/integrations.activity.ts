import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { Integration } from '@prisma/client';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import type { ToybacoTokenGeneration } from '@gitroom/nestjs-libraries/toybaco/token-lifecycle';

@Injectable()
@Activity()
export class IntegrationsActivity {
  constructor(
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  @ActivityMethod()
  async getIntegrationsById(id: string, orgId: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  async refreshToken(integration: Integration) {
    return this._refreshIntegrationService.refresh(integration);
  }

  // toybaco_token_lifecycle_v2: V2 workflow の activity。ID だけを受け取り、token は返さない。
  @ActivityMethod()
  async toybacoTokenLifecycleStateV2(integrationId: string, organizationId: string) {
    return this._refreshIntegrationService.toybacoTokenLifecycleState(
      integrationId,
      organizationId
    );
  }

  // expected は接続の世代(その段で読んだ、秘密でない tokenExpiration)だけを持つ。
  @ActivityMethod()
  async toybacoSoftRefreshTokenV2(
    integrationId: string,
    organizationId: string,
    expected?: ToybacoTokenGeneration
  ) {
    return this._refreshIntegrationService.toybacoSoftRefresh(
      integrationId,
      organizationId,
      expected
    );
  }

  @ActivityMethod()
  async toybacoFinalRefreshTokenV2(
    integrationId: string,
    organizationId: string,
    expected?: ToybacoTokenGeneration
  ) {
    return this._refreshIntegrationService.toybacoFinalRefresh(
      integrationId,
      organizationId,
      expected
    );
  }

  @ActivityMethod()
  async toybacoReconcileTokenLifecycleV2() {
    return this._refreshIntegrationService.toybacoReconcileTokenLifecycle();
  }
}
