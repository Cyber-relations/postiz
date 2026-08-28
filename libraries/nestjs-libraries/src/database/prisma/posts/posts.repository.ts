import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Post as PostBody } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  APPROVED_SUBMIT_FOR_ORDER,
  CreationMethod,
  Post,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);

// toybaco_approval_flow_v5_transaction_start
export async function toybacoRunPostTransaction(
  transaction: any,
  operation: any
) {
  return transaction.$transaction(operation);
}

export const TOYBACO_LOCK_ACTIVE_INTEGRATION_SQL =
  'SELECT "id" FROM "Integration" WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL FOR UPDATE';
export const TOYBACO_LOCK_POST_SQL =
  'SELECT "id", "organizationId", "group", "parentPostId", "state"::text AS "state", "deletedAt", "error" FROM "Post" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE';

export type ToybacoWorkflowOperation = 'ENSURE' | 'REPLACE' | 'CANCEL';
const TOYBACO_WORKFLOW_TOKEN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TOYBACO_WORKFLOW_GENERATION = '(?:0|[0-9]{13})';
const TOYBACO_POST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function toybacoWorkflowId(
  postId: string,
  generation: string,
  token: string
) {
  if (
    !TOYBACO_POST_ID.test(postId) ||
    !new RegExp(`^${TOYBACO_WORKFLOW_GENERATION}$`).test(generation) ||
    !new RegExp(`^${TOYBACO_WORKFLOW_TOKEN}$`).test(token)
  ) {
    throw new Error('workflow identityの構成要素が不正です。');
  }
  const workflowId = `post_${postId}_g${generation}_t${token}`;
  if (workflowId.length > 255) {
    throw new Error('workflow identityが長すぎます。');
  }
  return workflowId;
}

export function toybacoParseWorkflowId(workflowId: string) {
  if (!workflowId || workflowId.length > 255) return null;
  const match = new RegExp(
    `^post_([A-Za-z0-9_-]{1,128})_g(${TOYBACO_WORKFLOW_GENERATION})_t(${TOYBACO_WORKFLOW_TOKEN})$`
  ).exec(workflowId);
  if (!match) return null;
  return { postId: match[1], generation: match[2], token: match[3] };
}

function toybacoSafeReason(reason: unknown) {
  const wellFormed = String(reason || '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '?')
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1?');
  return encodeURIComponent(Array.from(wellFormed).slice(0, 80).join(''));
}

export function toybacoWorkflowMarker(
  operation: ToybacoWorkflowOperation,
  generation = '0',
  token = uuidv4(),
  previousWorkflowId = '',
  previousToken = '',
  reason = ''
) {
  const previousIdentity = previousWorkflowId
    ? toybacoParseWorkflowId(previousWorkflowId)
    : null;
  if (
    !new RegExp(`^${TOYBACO_WORKFLOW_GENERATION}$`).test(generation) ||
    !new RegExp(`^${TOYBACO_WORKFLOW_TOKEN}$`).test(token) ||
    (!!previousWorkflowId !== !!previousToken) ||
    (!!previousWorkflowId &&
      (!previousIdentity || previousIdentity.token !== previousToken))
  ) {
    throw new Error('workflow marker identityが不正です。');
  }
  return `TOYBACO_WORKFLOW_V2|${operation}|${generation}|${token}|${encodeURIComponent(previousWorkflowId)}|${previousToken}|${toybacoSafeReason(reason)}`;
}
export function toybacoParseWorkflowMarker(marker: string) {
  const match = new RegExp(
    `^TOYBACO_WORKFLOW_V2\\|(ENSURE|REPLACE|CANCEL)\\|(${TOYBACO_WORKFLOW_GENERATION})\\|(${TOYBACO_WORKFLOW_TOKEN})\\|([^|]*)\\|(${TOYBACO_WORKFLOW_TOKEN}|)\\|(.*)$`
  ).exec(
    marker || ''
  );
  if (!match) return null;
  let previousWorkflowId = '';
  let reason = '';
  try {
    previousWorkflowId = decodeURIComponent(match[4] || '');
    reason = decodeURIComponent(match[6] || '');
  } catch (_) {
    return null;
  }
  if (
    !!previousWorkflowId !== !!match[5] ||
    encodeURIComponent(previousWorkflowId) !== (match[4] || '') ||
    encodeURIComponent(reason) !== (match[6] || '') ||
    Array.from(reason).length > 80
  ) return null;
  const previousIdentity = previousWorkflowId
    ? toybacoParseWorkflowId(previousWorkflowId)
    : null;
  if (
    previousWorkflowId &&
    (!previousIdentity || previousIdentity.token !== match[5])
  ) return null;
  return {
    operation: match[1] as ToybacoWorkflowOperation,
    generation: match[2],
    token: match[3],
    previousWorkflowId,
    previousToken: match[5],
    previousGeneration: previousIdentity?.generation || '',
    previousPostId: previousIdentity?.postId || '',
    reason,
  };
}

export function toybacoParsePublishMarker(marker: string) {
  const match = new RegExp(
    `^TOYBACO_PUBLISH_V2\\|(${TOYBACO_WORKFLOW_GENERATION})\\|(${TOYBACO_WORKFLOW_TOKEN})\\|(READY|CLAIMED)$`
  ).exec(marker || '');
  if (!match) return null;
  return { generation: match[1], token: match[2], status: match[3] };
}

export function toybacoParseTerminalMarker(marker: string) {
  const match = new RegExp(
    `^TOYBACO_TERMINAL_V2\\|(${TOYBACO_WORKFLOW_GENERATION})\\|(${TOYBACO_WORKFLOW_TOKEN})\\|(PUBLISHED|ERROR)\\|([^|]*)$`
  ).exec(marker || '');
  if (!match) return null;
  try {
    const reason = decodeURIComponent(match[4] || '');
    if (
      encodeURIComponent(reason) !== (match[4] || '') ||
      Array.from(reason).length > 80
    ) return null;
  } catch (_) {
    return null;
  }
  return { generation: match[1], token: match[2], state: match[3] };
}

export function toybacoProviderStepMarker(
  generation: string,
  token: string,
  step: 'MAIN' | 'FINALIZE' | 'COMMENT',
  stepPostId: string
) {
  if (!['MAIN', 'FINALIZE', 'COMMENT'].includes(step)) {
    throw new Error('provider stepが不正です。');
  }
  toybacoWorkflowId(stepPostId, generation, token);
  return `TOYBACO_STEP_V2|${generation}|${token}|${step}|${encodeURIComponent(stepPostId)}|CLAIMED`;
}

export function toybacoParseProviderStepMarker(marker: string) {
  const match = new RegExp(
    `^TOYBACO_STEP_V2\\|(${TOYBACO_WORKFLOW_GENERATION})\\|(${TOYBACO_WORKFLOW_TOKEN})\\|(MAIN|FINALIZE|COMMENT)\\|([^|]+)\\|CLAIMED$`
  ).exec(marker || '');
  if (!match) return null;
  try {
    const stepPostId = decodeURIComponent(match[4]);
    if (encodeURIComponent(stepPostId) !== match[4]) return null;
    toybacoWorkflowId(stepPostId, match[1], match[2]);
    return {
      generation: match[1],
      token: match[2],
      step: match[3],
      stepPostId,
    };
  } catch (_) {
    return null;
  }
}

export function toybacoParseCommentTerminalMarker(marker: string) {
  const match = new RegExp(
    `^TOYBACO_COMMENT_V2\\|(${TOYBACO_WORKFLOW_GENERATION})\\|(${TOYBACO_WORKFLOW_TOKEN})\\|([^|]+)\\|(PUBLISHED|ERROR|UNCONFIRMED)\\|([^|]*)$`
  ).exec(marker || '');
  if (!match) return null;
  try {
    const stepPostId = decodeURIComponent(match[3]);
    const reason = decodeURIComponent(match[5] || '');
    if (
      encodeURIComponent(stepPostId) !== match[3] ||
      encodeURIComponent(reason) !== (match[5] || '') ||
      Array.from(reason).length > 80
    ) return null;
    toybacoWorkflowId(stepPostId, match[1], match[2]);
    return {
      generation: match[1],
      token: match[2],
      stepPostId,
      outcome: match[4],
    };
  } catch (_) {
    return null;
  }
}

export function toybacoEditVersionMarker(
  postId: string,
  generation: string,
  token: string,
  previousWorkflowId: string
) {
  const previous = toybacoParseWorkflowId(previousWorkflowId);
  if (!previous || previous.postId !== postId) {
    throw new Error('edit previous workflow identityが不正です。');
  }
  toybacoWorkflowId(postId, generation, token);
  return `TOYBACO_EDIT_V2|${generation}|${token}|${encodeURIComponent(previousWorkflowId)}`;
}

export function toybacoParseEditVersionMarker(marker: string) {
  const match = new RegExp(
    `^TOYBACO_EDIT_V2\\|(${TOYBACO_WORKFLOW_GENERATION})\\|(${TOYBACO_WORKFLOW_TOKEN})\\|([^|]+)$`
  ).exec(marker || '');
  if (!match) return null;
  try {
    const previousWorkflowId = decodeURIComponent(match[3]);
    if (encodeURIComponent(previousWorkflowId) !== match[3]) return null;
    const previous = toybacoParseWorkflowId(previousWorkflowId);
    if (!previous) return null;
    return { generation: match[1], token: match[2], previousWorkflowId, previous };
  } catch (_) {
    return null;
  }
}

export function toybacoWorkflowIdsForMarker(postId: string, marker: string) {
  const pending = toybacoParseWorkflowMarker(marker || '');
  const current =
    pending ||
    toybacoParsePublishMarker(marker || '') ||
    toybacoParseProviderStepMarker(marker || '') ||
    toybacoParseTerminalMarker(marker || '') ||
    toybacoParseCommentTerminalMarker(marker || '') ||
    toybacoParseEditVersionMarker(marker || '');
  const ids = new Set<string>();
  if (current && (!('stepPostId' in current) || current.stepPostId === postId)) {
    ids.add(toybacoWorkflowId(postId, current.generation, current.token));
  }
  if (pending?.previousWorkflowId) ids.add(pending.previousWorkflowId);
  const edit = toybacoParseEditVersionMarker(marker || '');
  if (edit?.previousWorkflowId) ids.add(edit.previousWorkflowId);
  return [...ids];
}

export function toybacoWorkflowStopMarker(workflowIds: any) {
  const exact = [...new Set(workflowIds)].sort();
  if (
    exact.length === 0 ||
    exact.length > 4 ||
    exact.some(
      (id) => typeof id !== 'string' || !toybacoParseWorkflowId(id)
    )
  ) throw new Error('workflow stop identityが不正です。');
  return `TOYBACO_STOP_V2|${encodeURIComponent(exact.join(','))}|READY`;
}

export function toybacoParseWorkflowStopMarker(marker: string) {
  const match = /^TOYBACO_STOP_V2\\|([^|]+)\\|(READY|ACKED)$/.exec(marker || '');
  if (!match) return null;
  try {
    const encoded = decodeURIComponent(match[1]);
    if (encodeURIComponent(encoded) !== match[1]) return null;
    const workflowIds = encoded.split(',');
    if (
      workflowIds.length === 0 ||
      workflowIds.length > 4 ||
      workflowIds.some((id) => !toybacoParseWorkflowId(id))
    ) return null;
    return { workflowIds, status: match[2] };
  } catch (_) {
    return null;
  }
}

export function toybacoMarkerIsClaimed(marker: string | null | undefined) {
  return (
    toybacoParsePublishMarker(marker || '')?.status === 'CLAIMED' ||
    !!toybacoParseProviderStepMarker(marker || '')
  );
}

export function toybacoStoredMarkerIsSafe(
  state: string,
  marker: string | null | undefined,
  postId?: string
) {
  if (!marker) return state === 'DRAFT';
  const pending = toybacoParseWorkflowMarker(marker);
  if (pending) {
    if (
      pending.previousWorkflowId &&
      (!postId ||
        pending.previousPostId !== postId ||
        pending.previousToken !==
          toybacoParseWorkflowId(pending.previousWorkflowId)?.token)
    ) return false;
    return pending.operation === 'CANCEL' ? state === 'DRAFT' : state === 'QUEUE';
  }
  const published = toybacoParsePublishMarker(marker);
  if (published) return state === 'QUEUE' || state === 'PUBLISHED';
  const step = toybacoParseProviderStepMarker(marker);
  if (step) {
    return (
      (!postId || step.stepPostId === postId) &&
      (state === 'QUEUE' || state === 'PUBLISHED')
    );
  }
  const terminal = toybacoParseTerminalMarker(marker);
  if (terminal) return terminal.state === state;
  const edit = toybacoParseEditVersionMarker(marker);
  if (edit) {
    return state === 'PUBLISHED' && (!postId || edit.previous.postId === postId);
  }
  const comment = toybacoParseCommentTerminalMarker(marker);
  return !!comment &&
    (comment.outcome === 'PUBLISHED' ? state === 'PUBLISHED' : state === 'ERROR');
}

export function toybacoNextWorkflowMarker(
  operation: ToybacoWorkflowOperation,
  postId: string,
  currentMarker: string | null | undefined,
  currentState: string,
  generation = '0'
) {
  const pending = toybacoParseWorkflowMarker(currentMarker || '');
  const published = toybacoParsePublishMarker(currentMarker || '');
  const terminal = toybacoParseTerminalMarker(currentMarker || '');
  const edit = toybacoParseEditVersionMarker(currentMarker || '');
  if (!toybacoStoredMarkerIsSafe(currentState, currentMarker, postId)) {
    throw new Error('未知または破損したworkflow markerを拒否しました。');
  }
  const previous = pending || published || terminal || edit;
  return toybacoWorkflowMarker(
    operation,
    generation,
    uuidv4(),
    previous
      ? toybacoWorkflowId(postId, previous.generation, previous.token)
      : '',
    previous?.token || ''
  );
}

export async function toybacoRotatePublishVersion(
  database: any,
  orgId: string,
  post: any
) {
  if (post.state !== 'QUEUE' && post.state !== 'PUBLISHED') return post.error;
  if (!toybacoStoredMarkerIsSafe(post.state, post.error, post.id)) {
    throw new Error('公開versionが未知のため編集を拒否しました。');
  }
  const generation = String(Date.now());
  const token = uuidv4();
  const previous =
    toybacoParseWorkflowMarker(post.error || '') ||
    toybacoParsePublishMarker(post.error || '');
  const marker = post.state === 'QUEUE' && previous
    ? toybacoWorkflowMarker(
        'REPLACE',
        generation,
        token,
        toybacoWorkflowId(post.id, previous.generation, previous.token),
        previous.token
      )
    : previous
      ? toybacoEditVersionMarker(
          post.id,
          generation,
          token,
          toybacoWorkflowId(post.id, previous.generation, previous.token)
        )
      : (() => { throw new Error('PUBLISHED workflow identityがありません。'); })();
  const updated = await database.post.updateMany({
    where: {
      id: post.id,
      organizationId: orgId,
      deletedAt: null,
      state: post.state,
      error: post.error,
    },
    data: { error: marker },
  });
  if (updated.count !== 1) {
    throw new Error('publish versionのatomic rotateに失敗しました。');
  }
  return marker;
}

export async function toybacoLockMutableGroup(
  database: any,
  orgId: string,
  group: string
) {
  const posts = (await database.$queryRawUnsafe(
    'SELECT "id", "parentPostId", "state"::text AS "state", "error" FROM "Post" WHERE "organizationId" = $1 AND "group" = $2 AND "deletedAt" IS NULL ORDER BY "parentPostId" NULLS FIRST, "id" FOR UPDATE',
    orgId,
    group
  )) as Array<{
    id: string;
    parentPostId: string | null;
    state: string;
    error: string | null;
  }>;
  if (
    posts.some(
      (post) =>
        toybacoMarkerIsClaimed(post.error) ||
        (!toybacoStoredMarkerIsSafe(post.state, post.error, post.id) &&
          (!post.parentPostId || !!post.error))
    )
  ) {
    throw new ForbiddenException(
      '公開処理中または状態が不明な投稿グループは変更できません。'
    );
  }
  return posts;
}

export async function toybacoLockActiveIntegration(
  database: any,
  orgId: string,
  integrationId: string
) {
  const rows = await database.$queryRawUnsafe(
    TOYBACO_LOCK_ACTIVE_INTEGRATION_SQL,
    integrationId,
    orgId
  );
  if (rows.length !== 1) {
    throw new ForbiddenException(
      '連携先が削除されたか、別の組織に属しています。画面を再読み込みしてください。'
    );
  }
}

export async function toybacoWriteTenantPost(
  database: any,
  orgId: string,
  state: string,
  value: any,
  createData: any,
  updateData: any,
  draftOnly: boolean,
  expected: any,
  allowRepublish: boolean
) {
  const existingPost = value.id
    ? await database.post.findUnique({
        where: { id: value.id },
        select: {
          id: true,
          organizationId: true,
          state: true,
          deletedAt: true,
          group: true,
          integrationId: true,
          parentPostId: true,
          error: true,
        },
      })
    : null;
  const expectedParent = expected.parentPostId
    ? await database.post.findUnique({
        where: { id: expected.parentPostId },
        select: {
          id: true,
          organizationId: true,
          state: true,
          deletedAt: true,
          group: true,
          integrationId: true,
          parentPostId: true,
          error: true,
        },
      })
    : null;
  let validDraftChain = !!expectedParent;
  let chainPost = expectedParent;
  const seenChain = new Set<string>();
  while (chainPost) {
    if (
      seenChain.has(chainPost.id) ||
      chainPost.organizationId !== orgId ||
      chainPost.state !== 'DRAFT' ||
      chainPost.deletedAt !== null ||
      chainPost.group !== expected.group ||
      chainPost.integrationId !== expected.integrationId ||
      toybacoMarkerIsClaimed(chainPost.error) ||
      (!toybacoStoredMarkerIsSafe(
        chainPost.state,
        chainPost.error,
        chainPost.id
      ) && (!chainPost.parentPostId || !!chainPost.error))
    ) {
      validDraftChain = false;
      break;
    }
    seenChain.add(chainPost.id);
    if (!chainPost.parentPostId) break;
    chainPost = await database.post.findUnique({
      where: { id: chainPost.parentPostId },
      select: {
        id: true,
        organizationId: true,
        state: true,
        deletedAt: true,
        group: true,
        integrationId: true,
        parentPostId: true,
        error: true,
      },
    });
    if (!chainPost) validDraftChain = false;
  }
  const validNewComment =
    !existingPost &&
    state === 'update' &&
    !!expected.parentPostId &&
    validDraftChain &&
    chainPost?.parentPostId === null;
  if (
    existingPost &&
    (existingPost.organizationId !== orgId ||
      existingPost.deletedAt !== null ||
      toybacoMarkerIsClaimed(existingPost.error) ||
      (!toybacoStoredMarkerIsSafe(
        existingPost.state,
        existingPost.error,
        existingPost.id
      ) &&
        (!existingPost.parentPostId || !!existingPost.error)) ||
      (draftOnly && existingPost.state !== 'DRAFT') ||
      !(
        state === 'update' ||
        ((state === 'schedule' || state === 'now') &&
          (existingPost.state !== 'PUBLISHED' || allowRepublish))
      ) ||
      !expected.group ||
      existingPost.group !== expected.group ||
      existingPost.integrationId !== expected.integrationId ||
      existingPost.parentPostId !== expected.parentPostId ||
      ((state === 'schedule' || state === 'now') &&
        !allowRepublish &&
        existingPost.state === 'PUBLISHED'))
  ) {
    throw new ForbiddenException(
      'この投稿は編集できません。画面を再読み込みして組織と状態を確認してください。'
    );
  }
  if (state === 'update' && !existingPost && !validNewComment) {
    throw new ForbiddenException(
      '更新対象の下書きが見つかりません。画面を再読み込みしてください。'
    );
  }

  return existingPost
    ? database.post.update({
        where: {
          id: value.id,
          organizationId: orgId,
          deletedAt: null,
          group: expected.group || undefined,
          integrationId: expected.integrationId,
          parentPostId: expected.parentPostId,
          state: existingPost.state,
          ...(draftOnly ? { state: 'DRAFT' as const } : {}),
        },
        data: updateData,
      })
    : database.post.create({ data: createData });
}

export async function toybacoCreateCommentInTransaction(
  transaction: any,
  orgId: string,
  userId: string,
  postId: string,
  content: string
) {
  return toybacoRunPostTransaction(transaction, async (database: any) => {
    const post = await database.post.findFirst({
      where: {
        id: postId,
        organizationId: orgId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!post) {
      throw new ForbiddenException(
        'この投稿にはコメントできません。画面を再読み込みしてください。'
      );
    }

    return database.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId: post.id,
        content,
      },
    });
  });
}
// toybaco_approval_flow_v5_transaction_end

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>,
    private _transaction: PrismaTransaction
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
          deletedAt: null,
        },
        state: { in: ['QUEUE', 'DRAFT'] },
        error: {
          startsWith: 'TOYBACO_WORKFLOW_V2|',
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
        publishDate: true,
        state: true,
        error: true,
      },
    });
  }

  async recoverWorkflowStops() {
    const rows = await this._post.model.post.findMany({
      where: {
        deletedAt: { not: null },
        error: { startsWith: 'TOYBACO_STOP_V2|' },
      },
      select: { id: true, organizationId: true, error: true },
    });
    return rows.flatMap((row: any) => {
      const parsed = toybacoParseWorkflowStopMarker(row.error || '');
      return parsed?.status === 'READY'
        ? [{ ...row, workflowIds: parsed.workflowIds }]
        : [];
    });
  }

  async completeWorkflowStop(
    orgId: string,
    postId: string,
    expectedMarker: string
  ) {
    const parsed = toybacoParseWorkflowStopMarker(expectedMarker);
    if (!parsed || parsed.status !== 'READY') {
      throw new ForbiddenException('workflow stop markerが不正です。');
    }
    const updated = await this._post.model.post.updateMany({
      where: {
        id: postId,
        organizationId: orgId,
        deletedAt: { not: null },
        error: expectedMarker,
      },
      data: { error: expectedMarker.replace(/\|READY$/, '|ACKED') },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException('workflow stop ackのexact CASに失敗しました。');
    }
  }

  async recoverClaimedComments() {
    const rows = await this._post.model.post.findMany({
      where: {
        state: 'QUEUE',
        deletedAt: null,
        updatedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
        error: { startsWith: 'TOYBACO_STEP_V2|' },
      },
      select: { id: true, organizationId: true, error: true },
    });
    for (const row of rows) {
      try {
        const parsed = toybacoParseProviderStepMarker(row.error || '');
        if (!parsed || parsed.step !== 'COMMENT' || parsed.stepPostId !== row.id) continue;
        const terminal =
          `TOYBACO_COMMENT_V2|${parsed.generation}|${parsed.token}|${encodeURIComponent(row.id)}|UNCONFIRMED|owner%20recovery`;
        await this._post.model.post.updateMany({
          where: {
            id: row.id,
            organizationId: row.organizationId,
            state: 'QUEUE',
            deletedAt: null,
            error: row.error,
          },
          data: { state: 'ERROR', error: terminal },
        });
      } catch (_) {
        continue;
      }
    }
  }

  getOldPosts(orgId: string, date: string) {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        organizationId: orgId,
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  updateImages(id: string, images: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        image: images,
      },
    });
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    // Use the provided start and end dates directly
    const startDate = dayjs.utc(query.startDate).toDate();
    const endDate = dayjs.utc(query.endDate).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        integration: {
          deletedAt: null,
          organizationId: orgId,
          ...(query.customer ? { customerId: query.customer } : {}),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        intervalInDays: true,
        group: true,
        creationMethod: true,
        settings: true,
        tags: {
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    return list.reduce((all, post) => {
      if (!post.intervalInDays) {
        return [...all, post];
      }

      const addMorePosts = [];
      let startingDate = dayjs.utc(post.publishDate);
      while (dayjs.utc(endDate).isSameOrAfter(startingDate)) {
        if (dayjs(startingDate).isSameOrAfter(dayjs.utc(post.publishDate))) {
          addMorePosts.push({
            ...post,
            publishDate: startingDate.toDate(),
            actualDate: post.publishDate,
          });
        }

        startingDate = startingDate.add(post.intervalInDays, 'days');
      }

      return [...all, ...addMorePosts];
    }, [] as any[]);
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft'
        ? { state: State.DRAFT }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    const orderDirection: 'asc' | 'desc' =
      stateFilter === 'published' ? 'desc' : 'asc';

    const where = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
            },
          ],
        },
      ],
      ...stateAndDate,
      // Published posts were already posted (publishDate in the past), so fetch
      // all of them; everything else stays upcoming. Ordering handles the rest.
      ...(stateFilter === 'published'
        ? {}
        : { publishDate: { gte: dayjs.utc().toDate() } }),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      intervalInDays: null as number | null,

      integration: {
        deletedAt: null as any,
        organizationId: orgId,
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
      },
    };

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          publishDate: orderDirection,
        },
        select: {
          id: true,
          content: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          tags: {
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    return {
      posts,
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async deletePost(orgId: string, group: string) {
    return this._transaction.model.$transaction(async (database: any) => {
      const posts = (await database.$queryRawUnsafe(
        'SELECT "id", "parentPostId", "state"::text AS "state", "error" FROM "Post" WHERE "organizationId" = $1 AND "group" = $2 AND "deletedAt" IS NULL FOR UPDATE',
        orgId,
        group
      )) as Array<{
        id: string;
        parentPostId: string | null;
        state: string;
        error: string | null;
      }>;
      if (
        posts.some(
          (post) =>
            toybacoMarkerIsClaimed(post.error) ||
            (!toybacoStoredMarkerIsSafe(post.state, post.error, post.id) &&
              (!post.parentPostId || !!post.error))
        )
      ) {
        throw new ForbiddenException('公開処理中の投稿は削除できません。');
      }
      const workflowIds = new Set<string>();
      for (const post of posts) {
        if (post.parentPostId === null) {
          for (const workflowId of toybacoWorkflowIdsForMarker(
            post.id,
            post.error || ''
          )) workflowIds.add(workflowId);
        }
      }
      const root = posts.find((post) => post.parentPostId === null);
      const stopMarker = workflowIds.size
        ? toybacoWorkflowStopMarker([...workflowIds])
        : null;
      if (root && stopMarker) {
        const marked = await database.post.updateMany({
          where: {
            id: root.id,
            organizationId: orgId,
            deletedAt: null,
            error: root.error,
          },
          data: { error: stopMarker },
        });
        if (marked.count !== 1) {
          throw new ForbiddenException('workflow stop outboxのCASに失敗しました。');
        }
      }
      await database.post.updateMany({
        where: { organizationId: orgId, group, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return {
        id: root?.id,
        workflowIds: [...workflowIds],
        stopMarker,
      };
    });
  }

  getPostsByGroup(orgId: string, group: string) {
    return this._post.model.post.findMany({
      where: {
        group,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          select: {
            tag: true,
          },
        },
      },
    });
  }

  getPost(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });
  }

  async updatePost(id: string, postId: string, releaseURL: string) {
    // V101..V109の履歴workflowは残すが、V2管理行へのlegacy final writeは拒否する。
    const updated = await this._post.model.post.updateMany({
      where: {
        id,
        OR: [
          { error: null },
          { NOT: { error: { startsWith: 'TOYBACO_' } } },
        ],
      },
      data: {
        state: 'PUBLISHED',
        releaseURL,
        releaseId: postId,
      },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException('legacy workflow final writeを拒否しました。');
    }
  }

  updateReleaseId(id: string, orgId: string, releaseId: string) {
    return this._post.model.post.update({
      where: {
        id,
        organizationId: orgId,
        releaseId: 'missing',
      },
      data: {
        releaseId: String(releaseId),
      },
    });
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    return this._transaction.model.$transaction(async (database: any) => {
      const rows = (await database.$queryRawUnsafe(
        'SELECT "id", "organizationId", "group", "parentPostId", "state"::text AS "state", "deletedAt", "error" FROM "Post" WHERE "id" = $1 FOR UPDATE',
        id
      )) as Array<{
        id: string;
        organizationId: string;
        group: string;
        parentPostId: string | null;
        state: State;
        deletedAt: Date | null;
        error: string | null;
      }>;
      const current = await database.post.findUnique({
        where: { id },
        select: { organizationId: true, error: true },
      });
      if (
        rows.length !== 1 ||
        !current ||
        toybacoMarkerIsClaimed(current.error) ||
        !toybacoStoredMarkerIsSafe(rows[0].state, current.error, id) ||
        (!!err && current.error?.startsWith('TOYBACO_'))
      ) {
        throw new ForbiddenException(
          'この投稿は別の公開処理により変更されました。'
        );
      }
      await toybacoLockMutableGroup(
        database,
        rows[0].organizationId,
        rows[0].group
      );
      const update = await database.post.update({
      where: {
        id,
      },
      data: {
        state,
        ...(!err && (state === 'QUEUE' || state === 'DRAFT')
          ? {
              error:
                state === 'DRAFT'
                  ? toybacoNextWorkflowMarker(
                      'CANCEL',
                      id,
                      current.error,
                      rows[0].state
                    )
                  : toybacoNextWorkflowMarker(
                      toybacoParsePublishMarker(current.error || '') ||
                        toybacoParseWorkflowMarker(current.error || '')
                        ? 'REPLACE'
                        : 'ENSURE',
                      id,
                      current.error,
                      rows[0].state
                    ),
            }
          : {}),
        ...(err
          ? { error: typeof err === 'string' ? err : JSON.stringify(err) }
          : {}),
      },
      include: {
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
      },
    });

    if (state === 'ERROR' && err && body) {
      try {
        await this._errors.model.errors.create({
          data: {
            message: typeof err === 'string' ? err : JSON.stringify(err),
            organizationId: update.organizationId,
            platform: update.integration.providerIdentifier,
            postId: update.id,
            body: typeof body === 'string' ? body : JSON.stringify(body),
          },
        });
      } catch (err) {}
    }

      return update;
    });
  }

  getErrorsByPostIds(postIds: string[]) {
    return this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    expectedState: State,
    action: 'schedule' | 'update' = 'schedule',
    toybacoDraftOnly = false,
    allowRepublish = false
  ) {
    try {
      return await this._transaction.model.$transaction(async (database: any) => {
        const rows = (await database.$queryRawUnsafe(
          TOYBACO_LOCK_POST_SQL,
          id,
          orgId
        )) as Array<{
          id: string;
          organizationId: string;
          group: string;
          parentPostId: string | null;
          state: State;
          deletedAt: Date | null;
          error: string | null;
        }>;
        const locked = rows[0];
        if (
          rows.length !== 1 ||
          locked.deletedAt !== null ||
          locked.state !== expectedState ||
          toybacoMarkerIsClaimed(locked.error) ||
          !toybacoStoredMarkerIsSafe(locked.state, locked.error, locked.id) ||
          (toybacoDraftOnly && locked.state !== 'DRAFT') ||
          (action === 'schedule' &&
            !allowRepublish &&
            locked.state === 'PUBLISHED')
        ) {
          throw new ForbiddenException(
            '投稿の状態が変更されました。画面を再読み込みしてください。'
          );
        }
        await toybacoLockMutableGroup(database, orgId, locked.group);
        return database.post.update({
          where: {
            organizationId: orgId,
            id,
            state: locked.state,
            deletedAt: null,
          },
          data: {
            publishDate: dayjs(date).toDate(),
            ...(action === 'schedule'
              ? {
                  state: locked.state === 'DRAFT' ? 'DRAFT' : 'QUEUE',
                  error:
                    locked.state === 'DRAFT'
                      ? toybacoNextWorkflowMarker(
                          'CANCEL',
                          id,
                          locked.error,
                          locked.state
                        )
                      : toybacoNextWorkflowMarker(
                          'REPLACE',
                          id,
                          locked.error,
                          locked.state,
                          String(dayjs(date).valueOf())
                        ),
                  releaseId: null,
                  releaseURL: null,
                }
              : {}),
          },
        });
      });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new ForbiddenException(
          '投稿の状態が変更されました。画面を再読み込みしてください。'
        );
      }
      throw error;
    }
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  async recordWorkflowDispatchFailure(
    orgId: string,
    dispatches: Array<{ postId: string; marker: string }>,
    reason: string
  ) {
    if (dispatches.length === 0) return;
    const result = await this._transaction.model.$transaction(
      async (database: any) => {
        let count = 0;
        for (const dispatch of dispatches) {
          const parsed = toybacoParseWorkflowMarker(dispatch.marker);
          if (!parsed) continue;
          const updated = await database.post.updateMany({
            where: {
              id: dispatch.postId,
              organizationId: orgId,
              deletedAt: null,
              error: dispatch.marker,
            },
            data: {
              error: toybacoWorkflowMarker(
                parsed.operation,
                parsed.generation,
                parsed.token,
                parsed.previousWorkflowId,
                parsed.previousToken,
                reason
              ),
            },
          });
          count += updated.count;
        }
        return { count };
      }
    );
    if (result.count !== dispatches.length) {
      throw new Error(
        'workflow dispatch失敗状態を全投稿へ記録できませんでした。'
      );
    }
  }

  async completeWorkflowDispatch(
    orgId: string,
    dispatches: Array<{ postId: string; marker: string }>
  ) {
    for (const dispatch of dispatches) {
      const parsed = toybacoParseWorkflowMarker(dispatch.marker);
      if (!parsed) throw new ForbiddenException('workflow tokenが不正です。');
      const updated = await this._post.model.post.updateMany({
        where: {
          id: dispatch.postId,
          organizationId: orgId,
          deletedAt: null,
          error: dispatch.marker,
        },
        data: {
          error:
            parsed.operation === 'CANCEL'
              ? null
              : `TOYBACO_PUBLISH_V2|${parsed.generation}|${parsed.token}|READY`,
        },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException('stale workflow ackを拒否しました。');
      }
    }
  }

  async claimWorkflowDispatch(
    orgId: string,
    postId: string,
    expectedMarker: string
  ) {
    const parsed = toybacoParseWorkflowMarker(expectedMarker);
    if (!parsed) throw new ForbiddenException('workflow tokenが不正です。');
    return this._transaction.model.$transaction(async (database: any) => {
      await database.$queryRawUnsafe(TOYBACO_LOCK_POST_SQL, postId, orgId);
      const post = await database.post.findFirst({
        where: {
          id: postId,
          organizationId: orgId,
          deletedAt: null,
          state: parsed.operation === 'CANCEL' ? 'DRAFT' : 'QUEUE',
          error: expectedMarker,
        },
        select: { id: true },
      });
      if (!post) throw new ForbiddenException('stale workflow claimを拒否しました。');
      return parsed;
    });
  }

  async getWorkflowReadiness(
    orgId: string,
    postId: string,
    expectedPublishMarker: string
  ): Promise<'PENDING' | 'READY' | 'STALE'> {
    const expected = toybacoParsePublishMarker(expectedPublishMarker);
    if (!expected || expected.status !== 'READY') return 'STALE';
    const post = await this._post.model.post.findFirst({
      where: {
        id: postId,
        organizationId: orgId,
        deletedAt: null,
      },
      select: { state: true, error: true },
    });
    if (!post || (post.state !== 'QUEUE' && post.state !== 'PUBLISHED')) {
      return 'STALE';
    }
    if (post.error === expectedPublishMarker) return 'READY';
    const pending = toybacoParseWorkflowMarker(post.error || '');
    return pending &&
      pending.operation !== 'CANCEL' &&
      pending.generation === expected.generation &&
      pending.token === expected.token
      ? 'PENDING'
      : 'STALE';
  }

  async claimProviderPost(
    orgId: string,
    postId: string,
    expectedPublishMarker: string,
    expectedState: State
  ) {
    const parsed = toybacoParsePublishMarker(expectedPublishMarker);
    if (
      !parsed ||
      parsed.status !== 'READY' ||
      (expectedState !== 'QUEUE' && expectedState !== 'PUBLISHED')
    ) {
      throw new ForbiddenException('expected publish tokenが不正です。');
    }
    return this._transaction.model.$transaction(async (database: any) => {
      await database.$queryRawUnsafe(TOYBACO_LOCK_POST_SQL, postId, orgId);
      const claimed = toybacoProviderStepMarker(
        parsed.generation,
        parsed.token,
        'MAIN',
        postId
      );
      const updated = await database.post.updateMany({
        where: {
          id: postId,
          organizationId: orgId,
          deletedAt: null,
          state: expectedState,
          error: expectedPublishMarker,
        },
        data: { error: claimed },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException('投稿直前publish claimを取得できませんでした。');
      }
      return claimed;
    });
  }

  async claimProviderStep(
    orgId: string,
    rootPostId: string,
    stepPostId: string,
    expectedPublishMarker: string,
    step: 'FINALIZE' | 'COMMENT'
  ) {
    const parsed = toybacoParsePublishMarker(expectedPublishMarker);
    if (!parsed || parsed.status !== 'READY') {
      throw new ForbiddenException('expected publish tokenが不正です。');
    }
    return this._transaction.model.$transaction(async (database: any) => {
      await database.$queryRawUnsafe(TOYBACO_LOCK_POST_SQL, rootPostId, orgId);
      const mainClaim = toybacoProviderStepMarker(
        parsed.generation,
        parsed.token,
        'MAIN',
        rootPostId
      );
      const terminal =
        `TOYBACO_TERMINAL_V2|${parsed.generation}|${parsed.token}|PUBLISHED|`;
      const root = await database.post.findFirst({
        where: {
          id: rootPostId,
          organizationId: orgId,
          deletedAt: null,
          state: step === 'COMMENT' ? 'PUBLISHED' : undefined,
          error: step === 'FINALIZE' ? mainClaim : terminal,
        },
        select: { id: true },
      });
      if (!root) {
        throw new ForbiddenException('stale provider step rootを拒否しました。');
      }
      const claimed = toybacoProviderStepMarker(
        parsed.generation,
        parsed.token,
        step,
        stepPostId
      );
      if (step === 'FINALIZE') {
        const updated = await database.post.updateMany({
          where: {
            id: rootPostId,
            organizationId: orgId,
            deletedAt: null,
            error: mainClaim,
          },
          data: { error: claimed },
        });
        if (updated.count !== 1) {
          throw new ForbiddenException('finalize claim競合を拒否しました。');
        }
        return claimed;
      }
      await database.$queryRawUnsafe(TOYBACO_LOCK_POST_SQL, stepPostId, orgId);
      const updated = await database.post.updateMany({
        where: {
          id: stepPostId,
          organizationId: orgId,
          deletedAt: null,
          state: 'QUEUE',
          error: null,
        },
        data: { error: claimed },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException('comment claim競合を拒否しました。');
      }
      return claimed;
    });
  }

  async completeProviderCommentStep(
    orgId: string,
    childPostId: string,
    expectedPublishMarker: string,
    outcome: 'ERROR' | 'UNCONFIRMED',
    reason: unknown
  ) {
    const parsed = toybacoParsePublishMarker(expectedPublishMarker);
    if (!parsed || parsed.status !== 'READY') {
      throw new ForbiddenException('expected comment tokenが不正です。');
    }
    const claimed = toybacoProviderStepMarker(
      parsed.generation,
      parsed.token,
      'COMMENT',
      childPostId
    );
    const terminal =
      `TOYBACO_COMMENT_V2|${parsed.generation}|${parsed.token}|${encodeURIComponent(childPostId)}|${outcome}|${toybacoSafeReason(reason)}`;
    const updated = await this._post.model.post.updateMany({
      where: {
        id: childPostId,
        organizationId: orgId,
        deletedAt: null,
        state: 'QUEUE',
        error: claimed,
      },
      data: { state: 'ERROR', error: terminal },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException('stale comment terminal CASを拒否しました。');
    }
  }

  async updatePostFromWorkflow(
    orgId: string,
    id: string,
    postId: string,
    releaseURL: string,
    expectedPublishMarker: string,
    finalStep: 'MAIN' | 'FINALIZE' | 'COMMENT'
  ) {
    const parsed = toybacoParsePublishMarker(expectedPublishMarker);
    if (!parsed || parsed.status !== 'READY') {
      throw new ForbiddenException('expected publish tokenが不正です。');
    }
    const claimed = toybacoProviderStepMarker(
      parsed.generation,
      parsed.token,
      finalStep,
      id
    );
    const updated = await this._post.model.post.updateMany({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
        error: claimed,
      },
      data: {
        state: 'PUBLISHED',
        releaseURL,
        releaseId: postId,
        error: `TOYBACO_TERMINAL_V2|${parsed.generation}|${parsed.token}|PUBLISHED|`,
      },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException('stale workflow final writeを拒否しました。');
    }
  }

  async changeStateFromWorkflow(
    orgId: string,
    id: string,
    state: State,
    expectedPublishMarker: string,
    err?: any,
    body?: any
  ) {
    const parsed = toybacoParsePublishMarker(expectedPublishMarker);
    if (!parsed || parsed.status !== 'READY' || state !== 'ERROR') {
      throw new ForbiddenException('expected publish tokenが不正です。');
    }
    return this._transaction.model.$transaction(async (database: any) => {
      await database.$queryRawUnsafe(TOYBACO_LOCK_POST_SQL, id, orgId);
      const mainClaim = toybacoProviderStepMarker(
        parsed.generation,
        parsed.token,
        'MAIN',
        id
      );
      const finalizeClaim = toybacoProviderStepMarker(
        parsed.generation,
        parsed.token,
        'FINALIZE',
        id
      );
      const publishedTerminal =
        `TOYBACO_TERMINAL_V2|${parsed.generation}|${parsed.token}|PUBLISHED|`;
      const current = await database.post.findFirst({
        where: {
          id,
          organizationId: orgId,
          deletedAt: null,
          error: {
            in: [
              expectedPublishMarker,
              mainClaim,
              finalizeClaim,
              publishedTerminal,
            ],
          },
        },
        include: {
          integration: { select: { providerIdentifier: true } },
        },
      });
      if (!current) {
        throw new ForbiddenException('stale workflow state writeを拒否しました。');
      }
      const reason = err
        ? typeof err === 'string'
          ? err
          : JSON.stringify(err)
        : '';
      const terminal = `TOYBACO_TERMINAL_V2|${parsed.generation}|${parsed.token}|${state}|${toybacoSafeReason(reason)}`;
      const updated = await database.post.updateMany({
        where: {
          id,
          organizationId: orgId,
          deletedAt: null,
          error: current.error,
        },
        data: { state, error: terminal },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException('stale workflow state CASを拒否しました。');
      }
      if (state === 'ERROR' && err && body) {
        try {
          await database.errors.create({
            data: {
              message: reason,
              organizationId: orgId,
              platform: current.integration.providerIdentifier,
              postId: id,
              body: typeof body === 'string' ? body : JSON.stringify(body),
            },
          });
        } catch (_) {}
      }
      return database.post.findUnique({ where: { id } });
    });
  }

  async prepareRepeatWorkflow(
    orgId: string,
    postId: string,
    expectedPublishMarker: string
  ) {
    const parsed = toybacoParsePublishMarker(expectedPublishMarker);
    if (!parsed || parsed.status !== 'READY') {
      throw new ForbiddenException('expected repeat tokenが不正です。');
    }
    return this._transaction.model.$transaction(async (database: any) => {
      await database.$queryRawUnsafe(TOYBACO_LOCK_POST_SQL, postId, orgId);
      const currentTerminal =
        `TOYBACO_TERMINAL_V2|${parsed.generation}|${parsed.token}|PUBLISHED|`;
      const nextGeneration = String(Date.now());
      const nextToken = uuidv4();
      const marker =
        `TOYBACO_PUBLISH_V2|${nextGeneration}|${nextToken}|READY`;
      const updated = await database.post.updateMany({
        where: {
          id: postId,
          organizationId: orgId,
          deletedAt: null,
          state: 'PUBLISHED',
          error: currentTerminal,
        },
        data: { error: marker },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException('stale repeat workflowを拒否しました。');
      }
      return {
        marker,
        workflowId: toybacoWorkflowId(
          postId,
          nextGeneration,
          nextToken
        ),
      };
    });
  }

  runPostTransaction(operation: any) {
    return toybacoRunPostTransaction(this._transaction.model, operation);
  }

  async createOrUpdatePost(
    state: 'draft' | 'schedule' | 'now' | 'update',
    orgId: string,
    date: string,
    body: PostBody,
    tags: { value: string; label: string }[],
    creationMethod: CreationMethod,
    inter?: number,
    // Keep the existing group instead of rotating it, so open clients
    // (calendar) holding the group stay valid. Used by out-of-band updates
    // (agent / MCP / public API); the dashboard keeps the rotate-and-sweep.
    keepGroup = false,
    toybacoDraftOnly = false,
    toybacoAllowRepublish = false,
    toybacoDatabase?: any
  ) {
    const execute = async (database: any) => {
      const postModel = database.post;
      const tagsModel = database.tags;
      const tagsPostsModel = database.tagsPosts;
      await toybacoLockActiveIntegration(
        database,
        orgId,
        body.integration.id
      );
      if (body.group) {
        await toybacoLockMutableGroup(database, orgId, body.group);
      }
      const posts: Post[] = [];
      const uuid = uuidv4();
      const group = keepGroup && body.group ? body.group : uuid;

      for (const value of body.value) {
        const updateData = (type: 'create' | 'update') => ({
          publishDate: dayjs(date).toDate(),
          integration: {
            connect: {
              id: body.integration.id,
              organizationId: orgId,
            },
          },
          ...(posts?.[posts.length - 1]?.id
            ? {
                parentPost: {
                  connect: {
                    id: posts[posts.length - 1]?.id,
                  },
                },
              }
            : type === 'update'
            ? {
                parentPost: {
                  disconnect: true,
                },
              }
            : {}),
          content: value.content,
          delay: value.delay || 0,
          group,
          intervalInDays: inter ? +inter : null,
          approvedSubmitForOrder: APPROVED_SUBMIT_FOR_ORDER.NO,
          ...(type === 'create' ? { creationMethod } : {}),
          ...(state === 'update'
            ? {}
            : {
                state:
                  state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
                error:
                  state === 'draft'
                    ? null
                    : toybacoWorkflowMarker('ENSURE'),
              }),
          image: JSON.stringify(value.image),
          settings: JSON.stringify(body.settings),
          organization: {
            connect: {
              id: orgId,
            },
          },
        });

        const updatePayload = {
          ...updateData('update'),
          lastMessage: {
            disconnect: true,
          },
          submittedForOrder: {
            disconnect: true,
          },
        };

        try {
          posts.push(
            await toybacoWriteTenantPost(
              { post: postModel },
              orgId,
              state,
              value,
                {
                  ...updateData('create'),
                  ...(state === 'update' && toybacoDraftOnly
                    ? { state: 'DRAFT' as const }
                    : {}),
                },
                updatePayload,
                toybacoDraftOnly,
                {
                  group: body.group || null,
                  integrationId: body.integration.id,
                  parentPostId:
                    posts.length === 0
                      ? null
                      : posts[posts.length - 1]?.id || null,
                },
                toybacoAllowRepublish
              )
          );
        } catch (error: any) {
          if (error?.code === 'P2025') {
            throw new ForbiddenException(
              'この投稿は編集できません。画面を再読み込みして組織と状態を確認してください。'
            );
          }
          throw error;
        }

        if (posts.length === 1) {
          await tagsPostsModel.deleteMany({
            where: {
              post: {
                id: posts[0].id,
                ...(toybacoDraftOnly
                  ? {
                      organizationId: orgId,
                      state: 'DRAFT' as const,
                      deletedAt: null,
                    }
                  : {}),
              },
            },
          });

          if (tags.length) {
            const tagsList = await tagsModel.findMany({
              where: {
                orgId: orgId,
                name: {
                  in: tags.map((tag) => tag.label).filter((f) => f),
                },
              },
            });

            if (tagsList.length) {
              await postModel.update({
                where: {
                  id: posts[posts.length - 1].id,
                  organizationId: orgId,
                  ...(toybacoDraftOnly
                    ? { state: 'DRAFT' as const, deletedAt: null }
                    : {}),
                },
                data: {
                  tags: {
                    createMany: {
                      data: tagsList.map((tag: { id: string }) => ({
                        tagId: tag.id,
                      })),
                    },
                  },
                },
              });
            }
          }
        }
      }

      const firstPost = posts[0];
      if (
        state === 'update' &&
        firstPost &&
        (firstPost.state === 'QUEUE' || firstPost.state === 'PUBLISHED')
      ) {
        firstPost.error = await toybacoRotatePublishVersion(
          database,
          orgId,
          firstPost
        );
      }

      const previousPost = body.group
        ? (
            await postModel.findFirst({
              where: {
                group: body.group,
                organizationId: orgId,
                deletedAt: null,
                parentPostId: null,
                ...(toybacoDraftOnly ? { state: 'DRAFT' as const } : {}),
              },
              select: {
                id: true,
              },
            })
          )?.id!
        : undefined;

      if (body.group && !keepGroup) {
        await postModel.updateMany({
          where: {
            group: body.group,
            organizationId: orgId,
            deletedAt: null,
            ...(toybacoDraftOnly ? { state: 'DRAFT' as const } : {}),
          },
          data: {
            parentPostId: null,
            deletedAt: new Date(),
          },
        });
      }

      // keepGroup: the updated rows still carry the old group, so sweep only the
      // rows dropped from it (removed comments) by id instead of by group.
      if (body.group && keepGroup) {
        await postModel.updateMany({
          where: {
            group: body.group,
            organizationId: orgId,
            deletedAt: null,
            ...(toybacoDraftOnly ? { state: 'DRAFT' as const } : {}),
            id: {
              notIn: posts.map((p) => p.id),
            },
          },
          data: {
            parentPostId: null,
            deletedAt: new Date(),
          },
        });
      }

      return { previousPost, posts };
    };

    return execute(
      toybacoDatabase || {
          post: this._post.model.post,
          tags: this._tags.model.tags,
          tagsPosts: this._tagsPosts.model.tagsPosts,
        }
    );
  }
  async submit(id: string, order: string, buyerOrganizationId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        submittedForOrderId: order,
        approvedSubmitForOrder: 'WAITING_CONFIRMATION',
        submittedForOrganizationId: buyerOrganizationId,
      },
      select: {
        id: true,
        description: true,
        submittedForOrder: {
          select: {
            messageGroupId: true,
          },
        },
      },
    });
  }

  updateMessage(id: string, messageId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastMessageId: messageId,
      },
    });
  }

  getPostById(id: string, org?: string) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(org ? { organizationId: org } : {}),
      },
      include: {
        integration: true,
        submittedForOrder: {
          include: {
            posts: {
              where: {
                state: 'PUBLISHED',
              },
            },
            ordersItems: true,
            seller: {
              select: {
                id: true,
                account: true,
              },
            },
          },
        },
      },
    });
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: 'category',
        topic: 'topic',
        content: 'content',
        hook: 'hook',
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  async getComments(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getTags(orgId: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        name: body.name,
        color: body.color,
      },
    });
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.update({
      where: {
        id,
      },
      data: {
        name: body.name,
        color: body.color,
      },
    });
  }

  deleteTag(id: string, orgId: string) {
    return this._tags.model.tags.update({
      where: {
        id,
        orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    content: string
  ) {
    return toybacoCreateCommentInTransaction(
      this._transaction.model,
      orgId,
      userId,
      postId,
      content
    );
  }

  async getPostByForWebhookId(postId: string) {
    return this._post.model.post.findMany({
      where: {
        id: postId,
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }
}
