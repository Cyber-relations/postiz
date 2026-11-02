import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type { ToybacoMediaPurgeActivity } from '@gitroom/orchestrator/activities/toybaco.media.purge.activity';
import {
  TOYBACO_MEDIA_PURGE_INTERVAL_MS,
  TOYBACO_MEDIA_PURGE_RUNS_PER_HISTORY,
} from '@gitroom/nestjs-libraries/toybaco/media-purge';
import type { ToybacoMediaPurgeCursor } from '@gitroom/nestjs-libraries/toybaco/media-purge';

// toybaco_media_purge_v1: once a day, delete (or, by default, only count) the S3 objects of media
// that were soft-deleted more than 30 days ago and are referenced nowhere. The activity receives the
// scan position (deletion time and id) only, so no object key or URL is written into the history.
// Changing this definition breaks the replay of running runs; add a separately named version instead.
const { toybacoPurgeDeletedMediaV1 } = proxyActivities<ToybacoMediaPurgeActivity>({
  startToCloseTimeout: '30 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export type ToybacoMediaPurgeWorkflowV1Input = {
  generation?: number;
  cursor?: ToybacoMediaPurgeCursor | null;
};

export async function toybacoMediaPurgeWorkflowV1(
  input: ToybacoMediaPurgeWorkflowV1Input = {}
) {
  const generation = input?.generation ?? 0;
  let cursor = input?.cursor ?? null;
  for (let run = 0; run < TOYBACO_MEDIA_PURGE_RUNS_PER_HISTORY; run++) {
    // A failed run keeps the workflow alive and retries from the same position the next day.
    try {
      const result = await toybacoPurgeDeletedMediaV1(cursor);
      cursor = result.next;
    } catch (err) {}
    await sleep(TOYBACO_MEDIA_PURGE_INTERVAL_MS);
  }
  await continueAsNew<typeof toybacoMediaPurgeWorkflowV1>({
    generation: generation + 1,
    cursor,
  });
}
