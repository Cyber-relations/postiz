import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import type { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import type { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import {
  TOYBACO_MISSING_POST_SWEEPS_PER_RUN,
  TOYBACO_MISSING_POST_SWEEP_INTERVAL_MS,
} from '@gitroom/nestjs-libraries/toybaco/token-lifecycle';

// toybaco_token_lifecycle_v2: successor of missingPostWorkflow (an endless loop without
// continueAsNew that is terminated at the 51,200 event limit, and fails after three failed
// activity attempts). The legacy definition stays byte-identical for replay of running runs;
// only this separately named version is started.
const { searchForMissingThreeHoursPosts } = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

const { toybacoReconcileTokenLifecycleV2 } =
  proxyActivities<IntegrationsActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue: 'main',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

export type ToybacoMissingPostWorkflowV2Input = { generation?: number };

export async function toybacoMissingPostWorkflowV2(
  input: ToybacoMissingPostWorkflowV2Input = {}
) {
  const generation = input?.generation ?? 0;
  for (let sweep = 0; sweep < TOYBACO_MISSING_POST_SWEEPS_PER_RUN; sweep++) {
    // Absorb failures inside the workflow and keep it alive until the next sweep.
    try {
      await searchForMissingThreeHoursPosts();
    } catch (err) {}
    // Recreate missing token refresh workflows and replace legacy runs.
    try {
      await toybacoReconcileTokenLifecycleV2();
    } catch (err) {}
    if (workflowInfo().continueAsNewSuggested) {
      break;
    }
    await sleep(TOYBACO_MISSING_POST_SWEEP_INTERVAL_MS);
  }
  await continueAsNew<typeof toybacoMissingPostWorkflowV2>({
    generation: generation + 1,
  });
}
