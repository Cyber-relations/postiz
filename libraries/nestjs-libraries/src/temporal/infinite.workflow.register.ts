import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import {
  TOYBACO_MISSING_POST_WORKFLOW_V2,
  TOYBACO_MISSING_POST_WORKFLOW_V2_ID,
} from '@gitroom/nestjs-libraries/toybaco/token-lifecycle';
import {
  TOYBACO_MEDIA_PURGE_WORKFLOW_V1,
  TOYBACO_MEDIA_PURGE_WORKFLOW_V1_ID,
} from '@gitroom/nestjs-libraries/toybaco/media-purge';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      // toybaco_token_lifecycle_v2: 旧 missingPostWorkflow は起動しない。走行中の旧 run は
      // V2 の最初の掃除が terminate する(定義は再生のため残す)。
      try {
        const started = await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start(TOYBACO_MISSING_POST_WORKFLOW_V2, {
            workflowId: TOYBACO_MISSING_POST_WORKFLOW_V2_ID,
            taskQueue: 'main',
            args: [{}],
          });
        console.log(
          started
            ? 'toybaco_token_lifecycle_v2 event=missing_post_v2_started'
            : 'toybaco_token_lifecycle_v2 event=missing_post_v2_start_failed error=NoTemporalClient'
        );
      } catch (err) {
        const name = String((err as { name?: unknown })?.name || 'Error');
        console.log(
          name === 'WorkflowExecutionAlreadyStartedError'
            ? 'toybaco_token_lifecycle_v2 event=missing_post_v2_running'
            : `toybaco_token_lifecycle_v2 event=missing_post_v2_start_failed error=${name.replace(/[^A-Za-z0-9_]/g, '')}`
        );
      }
      // toybaco_media_purge_v1: 論理削除したメディアの実体を消す日次の処理(既定は dry-run)。
      try {
        const started = await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start(TOYBACO_MEDIA_PURGE_WORKFLOW_V1, {
            workflowId: TOYBACO_MEDIA_PURGE_WORKFLOW_V1_ID,
            taskQueue: 'main',
            args: [{}],
          });
        console.log(
          started
            ? 'toybaco_media_purge event=workflow_started'
            : 'toybaco_media_purge event=workflow_start_failed error=NoTemporalClient'
        );
      } catch (err) {
        const name = String((err as { name?: unknown })?.name || 'Error');
        console.log(
          name === 'WorkflowExecutionAlreadyStartedError'
            ? 'toybaco_media_purge event=workflow_running'
            : `toybaco_media_purge event=workflow_start_failed error=${name.replace(/[^A-Za-z0-9_]/g, '')}`
        );
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
