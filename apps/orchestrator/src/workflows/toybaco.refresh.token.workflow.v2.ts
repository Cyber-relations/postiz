import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import {
  TOYBACO_REFRESH_STEPS_PER_RUN,
  toybacoPlanTokenLifecycle,
  toybacoRetryDelayMs,
  toybacoTokenLifecyclePolicy,
} from '@gitroom/nestjs-libraries/toybaco/token-lifecycle';

// toybaco_token_lifecycle_v2: successor of refreshTokenWorkflow (which slept until the
// expiry and refreshed once). The legacy definition stays byte-identical for replay of
// running runs; only this separately named version is started. Activities receive ids
// only, so no token is written into the workflow history.
const {
  toybacoTokenLifecycleStateV2,
  toybacoSoftRefreshTokenV2,
  toybacoFinalRefreshTokenV2,
} = proxyActivities<IntegrationsActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export type ToybacoRefreshTokenWorkflowV2Input = {
  integrationId: string;
  organizationId: string;
  failures?: number;
};

export async function toybacoRefreshTokenWorkflowV2(
  input: ToybacoRefreshTokenWorkflowV2Input
) {
  const { integrationId, organizationId } = input;
  let failures = input.failures ?? 0;

  for (let step = 0; step < TOYBACO_REFRESH_STEPS_PER_RUN; step++) {
    let current: Awaited<ReturnType<typeof toybacoTokenLifecycleStateV2>>;
    try {
      current = await toybacoTokenLifecycleStateV2(integrationId, organizationId);
    } catch (err) {
      // A transient DB or worker failure must not end the workflow.
      await sleep(toybacoRetryDelayMs(1));
      continue;
    }
    if (!current.active) {
      return { ended: current.reason };
    }
    const policy = toybacoTokenLifecyclePolicy(current.providerIdentifier);
    if (!policy) {
      return { ended: 'unsupported-provider' };
    }

    const plan = toybacoPlanTokenLifecycle(policy, {
      nowMs: Date.now(),
      tokenExpirationMs: current.tokenExpirationMs,
      failures,
    });
    if (plan.type === 'wait') {
      // A reconnect or delete while sleeping is picked up by the re-read after waking.
      await sleep(Math.max(1000, plan.untilMs - Date.now()));
      continue;
    }

    // The generation (tokenExpiration, not a secret) is the one this step just read, so the
    // activity leaves alone a connection reconnected or refreshed elsewhere since then; the next
    // step reads it again and plans from there.
    const expected = { generationMs: current.tokenExpirationMs };

    let result: Awaited<ReturnType<typeof toybacoSoftRefreshTokenV2>>;
    try {
      // Only `final` may hand a failure to refreshNeeded and the reconnect notice, and only on a
      // provider-confirmed rejection or after the real expiry (toybacoFinalMayDisconnect).
      result =
        plan.type === 'final'
          ? await toybacoFinalRefreshTokenV2(integrationId, organizationId, expected)
          : await toybacoSoftRefreshTokenV2(integrationId, organizationId, expected);
    } catch (err) {
      result = { status: 'failed' };
    }

    if (result.status === 'refreshed') {
      // Close the history after every success and reset the failure count.
      await continueAsNew<typeof toybacoRefreshTokenWorkflowV2>({
        integrationId,
        organizationId,
        failures: 0,
      });
    }
    if (result.status === 'inactive' || result.status === 'refresh-needed') {
      return { ended: result.status };
    }
    if (result.status === 'stale') {
      // Lost to a concurrent reconnect or refresh: re-read later without counting a failure.
      await sleep(toybacoRetryDelayMs(1));
      continue;
    }
    failures += 1;
    await sleep(toybacoRetryDelayMs(failures));
  }

  await continueAsNew<typeof toybacoRefreshTokenWorkflowV2>({
    integrationId,
    organizationId,
    failures,
  });
}
