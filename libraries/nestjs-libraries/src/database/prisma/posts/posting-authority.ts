import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  toybacoPreparationHash as hash,
  toybacoPreparationRequest,
  toybacoRetentionLock,
  toybacoValidatePostingPreparation,
  toybacoPostPayloadHash,
  toybacoScheduleAuthorityChain,
} from './posting-retention';

const reject = () =>
  new ForbiddenException(
    '投稿の権限や状態が変わりました。内容を確認してください。',
  );
const HEX = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GENERATION =
  /^[0-9]{13}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORITY_FIELDS = [
  'accountId',
  'organizationId',
  'authorityId',
  'preparationRequestId',
  'preparationReceiptHash',
  'railsAuthorityHash',
  'expiresAt',
  'scheduledPostsPerAccount',
  'expectedPointerHash',
];
export const EXECUTION_FIELDS = [
  'authorityId',
  'authorityHash',
  'railsAuthorityHash',
  'accountId',
  'organizationId',
  'ownerId',
  'actorId',
  'rootId',
  'stepPostId',
  'step',
  'rootGeneration',
  'markerHash',
  'saveRequestId',
  'scheduleHash',
  'reservationHash',
  'sequence',
  'previousPendingHash',
  'pendingDataHash',
];
export const postingHash = hash;
export function authorityEnabled() {
  if (
    process.env.TOYBACO_POSTING_AUTHORITY_ENABLED !== 'true' ||
    process.env.TOYBACO_POSTING_RELEASE_ENABLED !== 'true'
  )
    throw reject();
}
function startEnabled() {
  authorityEnabled();
  if (process.env.TOYBACO_POSTING_EXECUTION_ENABLED !== 'true') throw reject();
}
function copy(value: any) {
  return JSON.parse(JSON.stringify(value));
}
function keys(value: any, fields: string[]) {
  return (
    value &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join('|') === [...fields].sort().join('|')
  );
}
function hex(value: any) {
  return typeof value === 'string' && HEX.test(value);
}
function id(value: any) {
  return typeof value === 'string' && ID.test(value);
}
function positive(value: any) {
  return Number.isSafeInteger(value) && value > 0;
}
export function authorityRequest(value: any) {
  if (
    !keys(
      value,
      ['paid_upgrade','renewal_grace','renewal_paid'].includes(value?.kind)
        ? [
            ...AUTHORITY_FIELDS,
            'kind',
            'operationId',
            'sourceAuthorityId',
            'sourceAuthorityHash',
            'handoffReceiptHash',
            'contractAppliedHash',
            'targetPrincipalHash',
          ]
        : AUTHORITY_FIELDS,
    ) ||
    (['paid_upgrade','renewal_grace','renewal_paid'].includes(value?.kind) &&
      ![
        'operationId',
        'sourceAuthorityId',
        'sourceAuthorityHash',
        'handoffReceiptHash',
        'contractAppliedHash',
        'targetPrincipalHash',
      ].every((k) => hex(value[k]))) ||
    !positive(value.accountId) ||
    !id(value.organizationId) ||
    ![
      'authorityId',
      'preparationRequestId',
      'preparationReceiptHash',
      'railsAuthorityHash',
    ].every((k) => hex(value[k])) ||
    !positive(value.expiresAt) ||
    !positive(value.scheduledPostsPerAccount) ||
    value.scheduledPostsPerAccount > 10000 ||
    (value.expectedPointerHash !== null && !hex(value.expectedPointerHash))
  )
    throw reject();
  return copy(value);
}
export function executionRequest(value: any) {
  if (
    !keys(value, EXECUTION_FIELDS) ||
    ![
      'authorityId',
      'authorityHash',
      'railsAuthorityHash',
      'markerHash',
      'scheduleHash',
      'reservationHash',
    ].every((k) => hex(value[k])) ||
    !['accountId', 'ownerId', 'actorId'].every((k) => positive(value[k])) ||
    value.ownerId !== value.actorId ||
    !['organizationId', 'rootId', 'stepPostId'].every((k) => id(value[k])) ||
    typeof value.rootGeneration !== 'string' ||
    !GENERATION.test(value.rootGeneration) ||
    typeof value.saveRequestId !== 'string' ||
    !UUID.test(value.saveRequestId) ||
    !['MAIN', 'FINALIZE', 'COMMENT'].includes(value.step) ||
    (value.step !== 'COMMENT' && value.stepPostId !== value.rootId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.step === 'FINALIZE'
      ? value.sequence < 1 ||
        value.sequence > 10000 ||
        !hex(value.previousPendingHash) ||
        !hex(value.pendingDataHash)
      : value.sequence !== 0 ||
        value.previousPendingHash !== null ||
        value.pendingDataHash !== null)
  )
    throw reject();
  return copy(value);
}
export function executionId(value: any) {
  return hash(
    Object.fromEntries(
      [
        'organizationId',
        'rootId',
        'rootGeneration',
        'step',
        'stepPostId',
        'sequence',
      ].map((k) => [k, value[k]]),
    ),
  );
}
export function pointerHash(row: any) {
  return row
    ? hash({
        organizationId: row.organizationId,
        authorityId: row.authorityId,
        generation: String(row.generation),
        epoch: row.epoch,
      })
    : null;
}
async function lock(db: any, org: string) {
  if (!db || db.$transaction !== undefined || !id(org)) throw reject();
  await db.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
  const [isolation] = await db.$queryRawUnsafe(
    "SELECT current_setting('transaction_isolation') AS isolation",
  );
  if (isolation?.isolation !== 'read committed') throw reject();
  await toybacoRetentionLock(db, org, true);
}
function checkedAuthority(row: any, input?: any) {
  if (
    !row ||
    hash(authorityRequest(row.payload)) !== row.authorityHash ||
    row.organizationId !== row.payload.organizationId ||
    row.authorityId !== row.payload.authorityId ||
    (input && hash(input) !== row.authorityHash)
  )
    throw reject();
  return row;
}
async function authoritySnapshot(
  db: any,
  row: any,
  inventory: boolean,
  continuation = false,
) {
  if (row.payload.kind === 'paid_upgrade') await checkedPaidAuthority(db, row);
  if (isRenewalKind(row.payload.kind)) await checkedRenewalAuthority(db, row);
  const prepared = await db.toybacoPostingPreparation.findUnique({
    where: {
      organizationId_requestId: {
        organizationId: row.organizationId,
        requestId: row.payload.preparationRequestId,
      },
    },
  });
  if (
    !prepared ||
    prepared.receiptHash !== row.payload.preparationReceiptHash ||
    hash(prepared.request) !== prepared.payloadHash ||
    prepared.receipt?.version !== 2 ||
    prepared.receipt.state !== 'prepared' ||
    prepared.receipt.execute !== false ||
    prepared.receipt.receiptHash !== prepared.receiptHash ||
    hash(
      Object.fromEntries(
        Object.entries(prepared.receipt).filter(
          ([key]) => key !== 'receiptHash',
        ),
      ),
    ) !== prepared.receiptHash ||
    prepared.request.accountId !== row.payload.accountId ||
    prepared.request.organizationId !== row.organizationId ||
    (!continuation && row.payload.expiresAt <= Math.floor(Date.now() / 1000))
  )
    throw reject();
  await toybacoValidatePostingPreparation(db, prepared.request, inventory);
  return prepared.request;
}
function result(row: any, pointer: any, current: boolean) {
  return {
    authorityId: row.authorityId,
    authorityHash: row.authorityHash,
    organizationId: row.organizationId,
    state: current ? pointer.state : 'stale',
    pointerHash: pointerHash(pointer),
    current,
    execute: false,
  };
}
export async function postingAuthority(db: any, operation: string, raw: any) {
  if (operation !== 'status') authorityEnabled();
  const input = authorityRequest(raw);
  await lock(db, input.organizationId);
  if (operation !== 'status') await noPaidHandoff(db, input.organizationId);
  const where = {
    organizationId_authorityId: {
      organizationId: input.organizationId,
      authorityId: input.authorityId,
    },
  };
  let row = await db.toybacoPostingAuthority.findUnique({ where });
  let pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (
    !['activate', 'confirm', 'status'].includes(operation) ||
    (input.kind && operation !== 'status')
  )
    throw reject();
  if (row) {
    checkedAuthority(row, input);
    let current =
      !!pointer &&
      pointer.authorityId === row.authorityId &&
      pointer.state !== 'stale';
    if (current) {
      try {
        await authoritySnapshot(db, row, false);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        current = false;
      }
    }
    if (operation === 'confirm' && current && pointer.state === 'pending') {
      await authoritySnapshot(db, row, false);
      pointer = await db.toybacoPostingAuthorityCurrent.update({
        where: { organizationId: input.organizationId },
        data: { state: 'ready' },
      });
    }
    return result(row, pointer, current);
  }
  if (
    operation !== 'activate' ||
    pointerHash(pointer) !== input.expectedPointerHash ||
    (await db.toybacoPostingStep.count({
      where: {
        organizationId: input.organizationId,
        state: { in: ['reserved', 'started', 'uncertain', 'pending'] },
      },
    }))
  )
    throw reject();
  if (
    pointer &&
    (await db.post.count({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        parentPostId: null,
        state: 'QUEUE',
        id: {
          in: (
            await db.toybacoPostingSchedule.findMany({
              where: {
                organizationId: input.organizationId,
                authorityId: pointer.authorityId,
              },
              select: { rootId: true },
            })
          ).map((value: any) => value.rootId),
        },
      },
    }))
  ) {
    throw new ForbiddenException(
      '再開済みの投稿先に未実行の予約があります。予約の完了または取消後に接続の選択を変更してください。',
    );
  }
  row = {
    organizationId: input.organizationId,
    authorityId: input.authorityId,
    authorityHash: hash(input),
    payload: input,
  };
  await authoritySnapshot(db, row, true);
  const generation = pointer
    ? BigInt(pointer.generation) + BigInt('1')
    : BigInt('1');
  if (generation >= BigInt('9223372036854775807')) throw reject();
  await db.toybacoPostingAuthority.create({ data: row });
  pointer = await db.toybacoPostingAuthorityCurrent.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      authorityId: input.authorityId,
      generation,
      epoch: randomUUID(),
      state: 'pending',
    },
    update: {
      authorityId: input.authorityId,
      generation,
      epoch: randomUUID(),
      state: 'pending',
    },
  });
  return result(row, pointer, true);
}
export async function currentAuthority(
  db: any,
  org: string,
  authorityId: string,
  continuation = false,
) {
  await lock(db, org);
  await noPaidHandoff(db, org);
  const pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: org },
  });
  if (
    !pointer ||
    pointer.authorityId !== authorityId ||
    pointer.state !== 'ready'
  )
    throw reject();
  const row = checkedAuthority(
    await db.toybacoPostingAuthority.findUnique({
      where: {
        organizationId_authorityId: { organizationId: org, authorityId },
      },
    }),
  );
  return {
    row,
    pointer,
    preparation: await authoritySnapshot(db, row, false, continuation),
  };
}
// The provider and persisted attachments fix the finite mutation budget before MAIN.
export async function postingFinalizeLimit(
  db: any,
  org: string,
  rootId: string,
) {
  const root = await db.post.findFirst({
    where: { id: rootId, organizationId: org, deletedAt: null },
  });
  const integration =
    root &&
    (await db.integration.findFirst({
      where: { id: root.integrationId, organizationId: org, deletedAt: null },
    }));
  if (!root || !integration) throw reject();
  let images, settings;
  try {
    images = JSON.parse(root.image || '[]');
    settings = JSON.parse(root.settings || '{}');
  } catch {
    throw reject();
  }
  if (!Array.isArray(images)) throw reject();
  const count =
    integration.providerIdentifier === 'facebook' &&
    settings.post_type === 'story'
      ? images.length * 2
      : integration.providerIdentifier === 'threads' && images.length > 1
        ? 2
        : 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > 10000)
    throw reject();
  return count;
}
function mainIdentity(request: any) {
  return { ...request, step: 'MAIN', stepPostId: request.rootId, sequence: 0 };
}
function sameRoot(left: any, right: any) {
  return [
    'organizationId',
    'rootId',
    'rootGeneration',
    'authorityId',
    'authorityHash',
    'railsAuthorityHash',
    'saveRequestId',
    'scheduleHash',
  ].every((key) => left[key] === right[key]);
}
async function previousPostingStep(db: any, request: any, finishing = false) {
  const previous = checkedStep(
    await db.toybacoPostingStep.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: request.organizationId,
          operationId: executionId(
            request.sequence === 1
              ? mainIdentity(request)
              : { ...request, sequence: request.sequence - 1 },
          ),
        },
      },
    }),
  );
  if (
    !sameRoot(previous.request, request) ||
    (request.sequence === 1
      ? previous.state !== 'pending' &&
        !(finishing && previous.state === 'completed')
      : previous.state !== 'completed' || previous.outcome !== 'pending') ||
    previous.pendingEvidenceHash !== request.previousPendingHash ||
    previous.pendingDataHash !== request.pendingDataHash
  )
    throw reject();
  const later = await db.toybacoPostingStep.count({
    where: {
      organizationId: request.organizationId,
      rootId: request.rootId,
      rootGeneration: request.rootGeneration,
      step: 'FINALIZE',
      sequence: { gt: request.sequence },
    },
  });
  if (later) throw reject();
  return previous;
}
// Recovery navigation only: a stale receipt never becomes an executable grant.
export async function postingEditorRecovery(
  db: any,
  org: string,
  actorId: string,
) {
  if (process.env.TOYBACO_POSTING_AUTHORITY_ENABLED !== 'true') return null;
  const row = await db.toybacoPostingPreparation.findFirst({
    where: { organizationId: org },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  const request = toybacoPreparationRequest(org, row.request);
  if (row.requestId !== request.requestId || row.payloadHash !== hash(request))
    throw reject();
  const owner = await db.user.findFirst({
    where: {
      id: actorId,
      providerName: 'GENERIC',
      providerId: 'cw:' + request.ownerId,
      activated: true,
      deletedAt: null,
    },
  });
  const membership =
    owner &&
    (await db.userOrganization.findFirst({
      where: {
        userId: actorId,
        organizationId: org,
        role: 'ADMIN',
        disabled: false,
      },
    }));
  const organization =
    membership &&
    (await db.organization.findFirst({ where: { id: org, deletedAt: null } }));
  if (!owner || !membership || !organization) return null;
  return request.accountId;
}

// Authenticated editor bootstrap. The captured ID is never refreshed by a save request.
export async function postingEditorAuthority(
  db: any,
  org: string,
  actorId: string,
) {
  if (
    process.env.TOYBACO_POSTING_AUTHORITY_ENABLED !== 'true' ||
    process.env.TOYBACO_POSTING_RELEASE_ENABLED !== 'true'
  )
    return { authorityId: null };
  await lock(db, org);
  const pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: org },
  });
  if (!pointer) return { authorityId: null };
  const { row, preparation } = await currentAuthority(
    db,
    org,
    pointer.authorityId,
  );
  const owner = await db.user.findFirst({
    where: {
      id: actorId,
      providerName: 'GENERIC',
      providerId: 'cw:' + preparation.ownerId,
      activated: true,
      deletedAt: null,
    },
  });
  if (!owner) throw reject();
  return { authorityId: row.authorityId };
}

export async function bindPostingSchedule(
  db: any,
  org: string,
  actorId: string,
  context: any,
  roots: any[],
  authorityId: string,
) {
  authorityEnabled();
  if (
    !context ||
    context.organizationId !== org ||
    context.actorId !== actorId ||
    !UUID.test(context.requestId) ||
    !hex(context.payloadHash) ||
    !roots.length
  )
    throw reject();
  const { row, preparation } = await currentAuthority(db, org, authorityId);
  const owner = await db.user.findFirst({
    where: {
      id: actorId,
      providerName: 'GENERIC',
      providerId: 'cw:' + preparation.ownerId,
      activated: true,
      deletedAt: null,
    },
  });
  if (
    !owner ||
    roots.some(
      (root) => !preparation.keepIntegrationIds.includes(root.integrationId),
    )
  )
    throw reject();
  const counts = await db.post.groupBy({
    by: ['integrationId'],
    where: {
      organizationId: org,
      deletedAt: null,
      parentPostId: null,
      state: 'QUEUE',
    },
    _count: { _all: true },
  });
  const quota = row.payload.scheduledPostsPerAccount;
  if (
    !Number.isSafeInteger(quota) ||
    quota < 1 ||
    counts.some((v: any) => v._count._all > quota)
  )
    throw reject();
  for (const root of roots) {
    const marker =
      /^TOYBACO_WORKFLOW_V2\|(ENSURE|REPLACE)\|(0|[0-9]{13})\|([0-9a-f-]{36})\|/.exec(
        root.error || '',
      );
    if (
      !marker ||
      root.state !== 'QUEUE' ||
      root.parentPostId ||
      !UUID.test(marker[3]) ||
      root.publishDate.getTime() <= Date.now()
    )
      throw reject();
    const stamp = String(Date.now());
    const nextMarker = root.error.replace(
      '|' + marker[2] + '|' + marker[3] + '|',
      '|' + stamp + '|' + marker[3] + '|',
    );
    await db.post.update({
      where: { id: root.id },
      data: { error: nextMarker },
    });
    root.error = nextMarker;
    const rootGeneration = stamp + ':' + marker[3];
    const payload = {
      postPayloadHash: await toybacoPostPayloadHash(db, org, root.id),
      organizationId: org,
      rootId: root.id,
      authorityId,
      authorityHash: row.authorityHash,
      actorId: preparation.ownerId,
      saveRequestId: context.requestId,
      savePayloadHash: context.payloadHash,
      rootGeneration,
      integrationId: root.integrationId,
      publishAt: root.publishDate.getTime(),
      finalizeLimit: await postingFinalizeLimit(db, org, root.id),
    };
    await db.toybacoPostingSchedule.create({
      data: {
        organizationId: org,
        rootId: root.id,
        rootGeneration,
        authorityId,
        payload,
        scheduleHash: hash(payload),
      },
    });
  }
}
export async function reservePostingStep(
  db: any,
  org: string,
  rootId: string,
  stepPostId: string,
  marker: string,
  step: string,
  continuation?: any,
) {
  authorityEnabled();
  await lock(db, org);
  const parsed =
    /^TOYBACO_PUBLISH_V2\|([0-9]{13})\|([0-9a-f-]{36})\|READY$/.exec(marker);
  if (
    !parsed ||
    !UUID.test(parsed[2]) ||
    !['MAIN', 'FINALIZE', 'COMMENT'].includes(step)
  )
    throw reject();
  const rootGeneration = parsed[1] + ':' + parsed[2];
  const schedule = await db.toybacoPostingSchedule.findUnique({
    where: {
      organizationId_rootId_rootGeneration: {
        organizationId: org,
        rootId,
        rootGeneration,
      },
    },
  });
  if (!schedule || hash(schedule.payload) !== schedule.scheduleHash)
    throw reject();
  const sequence = step === 'FINALIZE' ? continuation?.sequence : 0;
  if (
    !Number.isSafeInteger(sequence) ||
    (step === 'FINALIZE'
      ? sequence < 1 ||
        sequence > schedule.payload.finalizeLimit ||
        !hex(continuation.previousPendingHash) ||
        !hex(continuation.pendingDataHash)
      : continuation !== undefined)
  )
    throw reject();
  const identity = {
    sequence,
    organizationId: org,
    rootId,
    rootGeneration,
    step,
    stepPostId,
  };
  const operationId = executionId(identity);
  const existing = await db.toybacoPostingStep.findUnique({
    where: { organizationId_operationId: { organizationId: org, operationId } },
  });
  if (existing) {
    checkedStep(existing);
    if (
      step === 'FINALIZE' &&
      (existing.request.previousPendingHash !==
        continuation.previousPendingHash ||
        existing.request.pendingDataHash !== continuation.pendingDataHash)
    )
      throw reject();
    return existing;
  }
  const pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: org },
  });
  if (!pointer) throw reject();
  const { row, preparation } = await currentAuthority(
    db,
    org,
    pointer.authorityId,
    step === 'FINALIZE',
  );
  await toybacoScheduleAuthorityChain(db, schedule, row);
  if (
    schedule.payload.postPayloadHash !==
    (await toybacoPostPayloadHash(db, org, rootId))
  )
    throw reject();
  const roots = await db.$queryRawUnsafe(
    'SELECT id,"integrationId","parentPostId","publishDate",state::text,error FROM "Post" WHERE "organizationId"=$1 AND id IN ($2,$3) AND "deletedAt" IS NULL ORDER BY id FOR UPDATE NOWAIT',
    org,
    rootId,
    stepPostId,
  );
  const root = roots.find((p: any) => p.id === rootId),
    child = roots.find((p: any) => p.id === stepPostId);
  if (
    !root ||
    root.parentPostId ||
    root.integrationId !== schedule.payload.integrationId ||
    root.publishDate.getTime() !== schedule.payload.publishAt ||
    !child ||
    child.integrationId !== root.integrationId
  )
    throw reject();
  if (
    step === 'MAIN' &&
    (root.state !== 'QUEUE' || root.publishDate.getTime() > Date.now())
  )
    throw reject();
  if (step === 'COMMENT') {
    const main = checkedStep(
      await db.toybacoPostingStep.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: org,
            operationId: executionId({
              ...identity,
              step: 'MAIN',
              stepPostId: rootId,
              sequence: 0,
            }),
          },
        },
      }),
    );
    if (
      main.state !== 'completed' ||
      main.outcome !== 'published' ||
      main.request.scheduleHash !== schedule.scheduleHash ||
      main.request.saveRequestId !== schedule.payload.saveRequestId
    )
      throw reject();
    const oldAuthority = checkedAuthority(
      await db.toybacoPostingAuthority.findUnique({
        where: {
          organizationId_authorityId: {
            organizationId: org,
            authorityId: main.authorityId,
          },
        },
      }),
    );
    await toybacoScheduleAuthorityChain(db, schedule, oldAuthority);
    const seen = new Set([child.id]);
    let parent = child.parentPostId;
    while (parent !== rootId) {
      if (!parent || seen.has(parent) || seen.size > 1000) throw reject();
      seen.add(parent);
      const previous = await db.post.findFirst({
        where: {
          id: parent,
          organizationId: org,
          deletedAt: null,
          state: 'PUBLISHED',
          integrationId: root.integrationId,
        },
      });
      if (!previous) throw reject();
      parent = previous.parentPostId;
    }
  }
  const claimed = (kind: string, id: string) =>
    `TOYBACO_STEP_V2|${parsed[1]}|${parsed[2]}|${kind}|${encodeURIComponent(id)}|CLAIMED`;
  const required =
    step === 'MAIN'
      ? marker
      : step === 'FINALIZE'
        ? claimed(sequence === 1 ? 'MAIN' : 'FINALIZE', rootId)
        : `TOYBACO_TERMINAL_V2|${parsed[1]}|${parsed[2]}|PUBLISHED|`;
  if (
    root.error !== required ||
    (step === 'COMMENT' &&
      (root.state !== 'PUBLISHED' ||
        child.state !== 'QUEUE' ||
        child.error !== null ||
        child.id === rootId)) ||
    (step !== 'COMMENT' && stepPostId !== rootId)
  )
    throw reject();
  if (step === 'FINALIZE') {
    const main = await db.toybacoPostingStep.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: org,
          operationId: executionId({
            ...identity,
            step: 'MAIN',
            stepPostId: rootId,
            sequence: 0,
          }),
        },
      },
    });
    if (!main || main.state !== 'pending') throw reject();
  }
  const reservation = {
    ...identity,
    authorityId: row.authorityId,
    authorityHash: row.authorityHash,
    scheduleHash: schedule.scheduleHash,
    markerHash: hash(marker),
    previousPendingHash:
      step === 'FINALIZE' ? continuation.previousPendingHash : null,
    pendingDataHash: step === 'FINALIZE' ? continuation.pendingDataHash : null,
  };
  const request = executionRequest({
    ...reservation,
    railsAuthorityHash: row.payload.railsAuthorityHash,
    accountId: row.payload.accountId,
    ownerId: preparation.ownerId,
    actorId: preparation.ownerId,
    saveRequestId: schedule.payload.saveRequestId,
    reservationHash: hash(reservation),
  });
  if (step === 'FINALIZE') await previousPostingStep(db, request);
  return checkedStep(
    await db.toybacoPostingStep.create({
      data: {
        organizationId: org,
        operationId,
        rootId,
        rootGeneration,
        step,
        sequence,
        stepPostId,
        authorityId: row.authorityId,
        request,
        requestHash: hash(request),
        state: 'reserved',
        expectedMarker: step === 'COMMENT' ? null : required,
        claimedMarker: claimed(step, stepPostId),
      },
    }),
  );
}
function checkedStep(row: any) {
  if (
    !row ||
    hash(executionRequest(row.request)) !== row.requestHash ||
    executionId(row.request) !== row.operationId ||
    ![
      'reserved',
      'started',
      'pending',
      'uncertain',
      'completed',
      'aborted_before_dispatch',
    ].includes(row.state) ||
    [
      'organizationId',
      'rootId',
      'rootGeneration',
      'step',
      'stepPostId',
      'authorityId',
      'sequence',
    ].some((key) => row[key] !== row.request[key]) ||
    row.request.reservationHash !==
      hash(
        Object.fromEntries(
          [
            'organizationId',
            'rootId',
            'rootGeneration',
            'step',
            'stepPostId',
            'authorityId',
            'authorityHash',
            'scheduleHash',
            'markerHash',
            'sequence',
            'previousPendingHash',
            'pendingDataHash',
          ].map((key) => [key, row.request[key]]),
        ),
      )
  )
    throw reject();
  return row;
}
export async function startPostingStep(db: any, raw: any, rails: any) {
  const request = executionRequest(raw);
  await lock(db, request.organizationId);
  const where = {
    organizationId_operationId: {
      organizationId: request.organizationId,
      operationId: executionId(request),
    },
  };
  const row = checkedStep(await db.toybacoPostingStep.findUnique({ where }));
  if (row.requestHash !== hash(request)) throw reject();
  if (row.state !== 'reserved') return { row, execute: false };
  startEnabled();
  await currentAuthority(
    db,
    request.organizationId,
    request.authorityId,
    request.step === 'FINALIZE',
  );
  if (
    !rails ||
    rails.operationId !== row.operationId ||
    rails.requestHash !== row.requestHash ||
    rails.state !== 'started' ||
    rails.outcome !== null ||
    rails.evidenceHash !== null ||
    rails.execute !== false
  )
    throw reject();
  if (request.step === 'FINALIZE') {
    const main = await db.toybacoPostingStep.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: request.organizationId,
          operationId: executionId({
            ...request,
            step: 'MAIN',
            stepPostId: request.rootId,
            sequence: 0,
          }),
        },
      },
    });
    if (!main || main.state !== 'pending') throw reject();
    await previousPostingStep(db, request);
  }
  const updated = await db.toybacoPostingStep.updateMany({
    where: { ...where.organizationId_operationId, state: 'reserved' },
    data: { state: 'started', startedAt: new Date() },
  });
  if (updated.count !== 1) throw reject();
  const post = await db.post.updateMany({
    where: {
      id: request.stepPostId,
      organizationId: request.organizationId,
      deletedAt: null,
      error: row.expectedMarker,
    },
    data: { error: row.claimedMarker },
  });
  if (post.count !== 1) throw reject();
  return {
    row: checkedStep(await db.toybacoPostingStep.findUnique({ where })),
    execute: true,
  };
}
export async function abortPostingStep(db: any, raw: any) {
  const request = executionRequest(raw);
  await lock(db, request.organizationId);
  const where = {
    organizationId_operationId: {
      organizationId: request.organizationId,
      operationId: executionId(request),
    },
  };
  const row = checkedStep(await db.toybacoPostingStep.findUnique({ where }));
  if (
    row.requestHash !== hash(request) ||
    !['reserved', 'aborted_before_dispatch'].includes(row.state)
  )
    throw reject();
  const evidenceHash = hash({
    operationId: row.operationId,
    requestHash: row.requestHash,
    reservationHash: request.reservationHash,
    state: 'aborted_before_dispatch',
  });
  if (row.state === 'reserved')
    await db.toybacoPostingStep.update({
      where,
      data: {
        state: 'aborted_before_dispatch',
        outcome: 'not_sent',
        evidenceHash,
        terminalAt: new Date(),
      },
    });
  return { execution: request, outcome: 'not_sent', evidenceHash };
}
export async function recordPostingResult(
  db: any,
  raw: any,
  outcome: string,
  evidenceHash: string,
  pendingDataHash?: string,
) {
  const request = executionRequest(raw);
  await lock(db, request.organizationId);
  if (
    !['pending', 'published', 'rejected', 'uncertain'].includes(outcome) ||
    !hex(evidenceHash) ||
    (outcome === 'pending' && !hex(pendingDataHash))
  )
    throw reject();
  const where = {
    organizationId_operationId: {
      organizationId: request.organizationId,
      operationId: executionId(request),
    },
  };
  const row = checkedStep(await db.toybacoPostingStep.findUnique({ where }));
  if (row.requestHash !== hash(request)) throw reject();
  if (row.state === 'completed') {
    if (
      outcome === 'pending' &&
      request.step === 'MAIN' &&
      row.pendingEvidenceHash === evidenceHash
    )
      return row;
    if (row.outcome !== outcome || row.evidenceHash !== evidenceHash)
      throw reject();
    return row;
  }
  if (
    !['started', 'pending', 'uncertain'].includes(row.state) ||
    (outcome === 'pending' && request.step === 'COMMENT')
  )
    throw reject();
  if (
    outcome === 'pending' &&
    row.pendingEvidenceHash &&
    row.pendingEvidenceHash !== evidenceHash
  )
    throw reject();
  if (row.state === 'uncertain' && outcome === 'uncertain') {
    if (row.evidenceHash !== evidenceHash) throw reject();
    return row;
  }
  if (row.state === 'pending' && outcome === 'uncertain') return row;
  const terminal = ['published', 'rejected'].includes(outcome);
  const stagePending = outcome === 'pending' && request.step === 'FINALIZE';
  if (stagePending) await previousPostingStep(db, request, true);
  if (request.step === 'FINALIZE' && terminal) {
    const main = checkedStep(
      await db.toybacoPostingStep.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: request.organizationId,
            operationId: executionId({
              ...request,
              step: 'MAIN',
              stepPostId: request.rootId,
              sequence: 0,
            }),
          },
        },
      }),
    );
    if (
      main.state !== 'pending' &&
      (main.state !== 'completed' ||
        main.outcome !== outcome ||
        main.evidenceHash !== evidenceHash)
    )
      throw reject();
  }
  await db.toybacoPostingStep.update({
    where,
    data: {
      state: terminal || stagePending ? 'completed' : outcome,
      outcome: terminal || stagePending ? outcome : null,
      evidenceHash,
      ...(outcome === 'pending'
        ? { pendingEvidenceHash: evidenceHash, pendingDataHash }
        : {}),
      railsAcknowledged: false,
      terminalAt: terminal || stagePending ? new Date() : null,
    },
  });
  if (request.step === 'FINALIZE' && terminal)
    await db.toybacoPostingStep.updateMany({
      where: {
        organizationId: request.organizationId,
        rootId: request.rootId,
        rootGeneration: request.rootGeneration,
        step: 'MAIN',
        state: 'pending',
      },
      data: {
        state: 'completed',
        outcome,
        evidenceHash,
        railsAcknowledged: false,
        terminalAt: new Date(),
      },
    });
  if (request.step === 'MAIN' && terminal) {
    const siblings = await db.toybacoPostingStep.findMany({
      where: {
        organizationId: request.organizationId,
        rootId: request.rootId,
        rootGeneration: request.rootGeneration,
        step: 'FINALIZE',
      },
      orderBy: { sequence: 'asc' },
      take: 10001,
    });
    if (siblings.length > 10000) throw reject();
    for (const sibling of siblings) {
      checkedStep(sibling);
      if (!sameRoot(sibling.request, request)) throw reject();
      if (sibling.state === 'reserved')
        await abortPostingStep(db, sibling.request);
      else if (
        sibling.state === 'completed' &&
        sibling.outcome !== 'pending' &&
        (sibling.outcome !== outcome || sibling.evidenceHash !== evidenceHash)
      )
        throw reject();
    }
  }
  return checkedStep(await db.toybacoPostingStep.findUnique({ where }));
}

// A signed result is rebuilt only from the persisted outcome. It never calls a provider.
export async function postingResultDelivery(db: any, raw: any) {
  const request = executionRequest(raw);
  await lock(db, request.organizationId);
  const row = checkedStep(
    await db.toybacoPostingStep.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: request.organizationId,
          operationId: executionId(request),
        },
      },
    }),
  );
  if (
    row.requestHash !== hash(request) ||
    !['pending', 'uncertain', 'completed', 'aborted_before_dispatch'].includes(
      row.state,
    ) ||
    !hex(row.evidenceHash)
  )
    throw reject();
  const outcome =
    row.state === 'completed'
      ? row.outcome
      : row.state === 'aborted_before_dispatch'
        ? 'not_sent'
        : row.state;
  if (
    outcome === 'not_sent' &&
    row.evidenceHash !==
      hash({
        operationId: row.operationId,
        requestHash: row.requestHash,
        reservationHash: request.reservationHash,
        state: 'aborted_before_dispatch',
      })
  )
    throw reject();
  return { execution: request, outcome, evidenceHash: row.evidenceHash };
}
export async function acknowledgePostingResult(db: any, raw: any, rails: any) {
  const result = await postingResultDelivery(db, raw);
  const operationId = executionId(raw),
    requestHash = hash(raw);
  const expected =
    (result.outcome === 'pending' && raw.step === 'FINALIZE') ||
    result.outcome === 'not_sent'
      ? 'completed'
      : ['published', 'rejected'].includes(result.outcome)
        ? 'completed'
        : result.outcome;
  if (
    !rails ||
    rails.operationId !== operationId ||
    rails.requestHash !== requestHash ||
    rails.execute !== false ||
    rails.state !== expected ||
    rails.evidenceHash !== result.evidenceHash ||
    rails.outcome !==
      ((result.outcome === 'pending' && raw.step === 'FINALIZE') ||
      ['published', 'rejected', 'not_sent'].includes(result.outcome)
        ? result.outcome
        : null)
  )
    throw reject();
  await db.toybacoPostingStep.update({
    where: {
      organizationId_operationId: {
        organizationId: raw.organizationId,
        operationId,
      },
    },
    data: { railsAcknowledged: true },
  });
  return result;
}
export async function authoritySchedule(
  db: any,
  org: string,
  root: string,
  generation: string,
) {
  const schedule = await db.toybacoPostingSchedule.findUnique({
    where: {
      organizationId_rootId_rootGeneration: {
        organizationId: org,
        rootId: root,
        rootGeneration: generation,
      },
    },
  });
  if (!schedule) return null;
  if (
    schedule.scheduleHash !== hash(schedule.payload) ||
    schedule.payload.organizationId !== org ||
    schedule.payload.rootId !== root ||
    schedule.payload.rootGeneration !== generation ||
    schedule.payload.authorityId !== schedule.authorityId
  )
    throw reject();
  const pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: org },
  });
  if (!pointer) throw reject();
  const { row } = await currentAuthority(db, org, pointer.authorityId);
  await toybacoScheduleAuthorityChain(db, schedule, row);
  return schedule;
}

export async function pendingPostingStatus(
  db: any,
  raw: any,
  pendingHash: string,
  nextHash?: string,
) {
  const request = executionRequest(raw);
  await lock(db, request.organizationId);
  const where = {
    organizationId_operationId: {
      organizationId: request.organizationId,
      operationId: executionId(request),
    },
  };
  const row = checkedStep(await db.toybacoPostingStep.findUnique({ where }));
  if (
    row.requestHash !== hash(request) ||
    !hex(pendingHash) ||
    row.pendingDataHash !== pendingHash ||
    (request.step === 'MAIN'
      ? row.state !== 'pending'
      : request.step !== 'FINALIZE' ||
        row.state !== 'completed' ||
        row.outcome !== 'pending')
  )
    throw reject();
  const main = checkedStep(
    await db.toybacoPostingStep.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: request.organizationId,
          operationId: executionId(mainIdentity(request)),
        },
      },
    }),
  );
  if (main.state !== 'pending' || !sameRoot(main.request, request))
    throw reject();
  await currentAuthority(db, request.organizationId, request.authorityId, true);
  if (nextHash !== undefined) {
    if (!hex(nextHash)) throw reject();
    if (
      nextHash !== pendingHash &&
      (await db.toybacoPostingStep.count({
        where: {
          organizationId: request.organizationId,
          rootId: request.rootId,
          rootGeneration: request.rootGeneration,
          step: 'FINALIZE',
          sequence: request.sequence + 1,
        },
      }))
    )
      throw reject();
    await db.toybacoPostingStep.update({
      where,
      data: { pendingDataHash: nextHash },
    });
  }
  return {
    sequence: request.sequence + 1,
    previousPendingHash: row.pendingEvidenceHash,
    pendingDataHash: nextHash ?? pendingHash,
  };
}

export const PAID_UPGRADE_FIELDS = [
  'accountId',
  'organizationId',
  'operationId',
  'sourceAuthorityId',
  'sourceAuthorityHash',
  'expectedPointerHash',
  'journalHash',
  'periodHash',
  'sourceCoverageHash',
  'targetCoverageHash',
  'sourceBindingHash',
  'targetBindingHash',
  'sourcePrincipalHash',
  'selectionHash',
  'sourceRank',
  'targetRank',
  'sourcePostingLimit',
  'targetPostingLimit',
  'sourceScheduledLimit',
  'targetScheduledLimit',
  'expiresAt',
];
export const PAID_UPGRADE_APPLICATION_FIELDS = [
  'receiptHash',
  'contractAppliedHash',
  'targetPrincipalHash',
  'authorityId',
  'railsAuthorityHash',
];
export function paidUpgradeRequest(raw: any) {
  if (
    !keys(raw, PAID_UPGRADE_FIELDS) ||
    !id(raw.organizationId) ||
    !positive(raw.accountId) ||
    !PAID_UPGRADE_FIELDS.filter(
      (k) =>
        k.endsWith('Hash') || ['operationId', 'sourceAuthorityId'].includes(k),
    ).every((k) => hex(raw[k])) ||
    ![
      'sourceRank',
      'targetRank',
      'sourcePostingLimit',
      'targetPostingLimit',
      'sourceScheduledLimit',
      'targetScheduledLimit',
      'expiresAt',
    ].every((k) => positive(raw[k])) ||
    raw.sourceRank >= raw.targetRank ||
    raw.targetRank > 3 ||
    raw.targetPostingLimit < raw.sourcePostingLimit ||
    raw.targetScheduledLimit < raw.sourceScheduledLimit ||
    raw.targetPostingLimit > 10000 ||
    raw.targetScheduledLimit > 10000 ||
    raw.sourceBindingHash === raw.targetBindingHash ||
    raw.sourceCoverageHash === raw.targetCoverageHash
  )
    throw reject();
  return copy(raw);
}
export function paidUpgradeApplication(raw: any) {
  if (
    !keys(raw, PAID_UPGRADE_APPLICATION_FIELDS) ||
    !PAID_UPGRADE_APPLICATION_FIELDS.every((k) => hex(raw[k]))
  )
    throw reject();
  return copy(raw);
}
async function noPaidHandoff(db: any, org: string) {
  if(await db.toybacoPostingRenewal.count({where:{organizationId:org,state:'applied'}}))throw reject();
  if (
    await db.toybacoPostingPaidUpgrade.count({
      where: { organizationId: org, state: { in: ['pending', 'applied'] } },
    })
  )
    throw reject();
}
function checkedHandoff(row: any) {
  if (
    !row ||
    row.operationId !== row.request.operationId ||
    row.organizationId !== row.request.organizationId ||
    row.requestHash !== hash(paidUpgradeRequest(row.request)) ||
    row.receiptHash !== hash(row.receipt) ||
    row.receipt.version !== 1 ||
    row.receipt.requestHash !== row.requestHash ||
    row.receipt.operationId !== row.operationId ||
    row.receipt.organizationId !== row.organizationId ||
    row.receipt.rootManifestHash !== hash(row.receipt.roots) ||
    !Array.isArray(row.receipt.roots) ||
    row.receipt.roots.length > 10000 ||
    !['pending', 'applied', 'ready', 'withdrawn'].includes(row.state) ||
    (['applied', 'ready'].includes(row.state)
      ? !row.application ||
        hash(paidUpgradeApplication(row.application)) !== row.applicationHash
      : row.application !== null || row.applicationHash !== null)
  )
    throw reject();
  return row;
}
async function checkedPaidAuthority(db: any, row: any, depth = 0) {
  if (depth >= 2) throw reject();
  const p = row.payload;
  const handoff = checkedHandoff(
    await db.toybacoPostingPaidUpgrade.findUnique({
      where: {
        organizationId_operationId: {
          organizationId: row.organizationId,
          operationId: p.operationId,
        },
      },
    }),
  );
  if (
    !['applied', 'ready'].includes(handoff.state) ||
    handoff.receiptHash !== p.handoffReceiptHash ||
    handoff.request.sourceAuthorityId !== p.sourceAuthorityId ||
    handoff.request.sourceAuthorityHash !== p.sourceAuthorityHash ||
    handoff.application.authorityId !== p.authorityId ||
    handoff.application.railsAuthorityHash !== p.railsAuthorityHash ||
    handoff.application.targetPrincipalHash !== p.targetPrincipalHash ||
    handoff.application.contractAppliedHash !== p.contractAppliedHash ||
    hash(
      upgradedAuthority(
        handoff,
        await sourceAuthority(db, handoff.request),
        handoff.application,
      ),
    ) !== row.authorityHash
  )
    throw reject();
  const source = await sourceAuthority(db, handoff.request);
  if (source.payload.kind === 'paid_upgrade') {
    const previous = await checkedPaidAuthority(db, source, depth + 1);
    if (
      previous.state !== 'ready' ||
      previous.request.targetRank !== handoff.request.sourceRank ||
      previous.request.periodHash !== handoff.request.periodHash ||
      previous.request.targetCoverageHash !==
        handoff.request.sourceCoverageHash ||
      source.payload.targetPrincipalHash !==
        handoff.request.sourcePrincipalHash ||
      previous.request.targetBindingHash !== handoff.request.sourceBindingHash
    )
      throw reject();
  }
  if(isRenewalKind(source.payload.kind)){const renewal=await checkedRenewalAuthority(db,source);if(renewal.state!=='ready'||source.payload.kind!=='renewal_paid'||renewal.request.planRank!==handoff.request.sourceRank||renewal.request.periodHash!==handoff.request.periodHash||renewal.request.targetCoverageHash!==handoff.request.sourceCoverageHash||renewal.request.contractAppliedHash!==handoff.request.sourceBindingHash||source.payload.targetPrincipalHash!==handoff.request.sourcePrincipalHash)throw reject();}
  return handoff;
}
async function sourceAuthority(db: any, input: any) {
  const source = checkedAuthority(
    await db.toybacoPostingAuthority.findUnique({
      where: {
        organizationId_authorityId: {
          organizationId: input.organizationId,
          authorityId: input.sourceAuthorityId,
        },
      },
    }),
  );
  if (
    source.authorityHash !== input.sourceAuthorityHash ||
    source.payload.accountId !== input.accountId ||
    source.payload.expiresAt !== input.expiresAt ||
    source.payload.scheduledPostsPerAccount !== input.sourceScheduledLimit
  )
    throw reject();
  return source;
}
function upgradedAuthority(handoff: any, source: any, application: any) {
  return authorityRequest({
    ...source.payload,
    authorityId: application.authorityId,
    railsAuthorityHash: application.railsAuthorityHash,
    expectedPointerHash: handoff.request.expectedPointerHash,
    scheduledPostsPerAccount: handoff.request.targetScheduledLimit,
    kind: 'paid_upgrade',
    operationId: handoff.operationId,
    sourceAuthorityId: source.authorityId,
    sourceAuthorityHash: source.authorityHash,
    handoffReceiptHash: handoff.receiptHash,
    contractAppliedHash: application.contractAppliedHash,
    targetPrincipalHash: application.targetPrincipalHash,
  });
}
async function paidSource(db: any, input: any, expectPointer = true) {
  const source = await sourceAuthority(db, input);
  const pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (
    expectPointer &&
    (!pointer ||
      pointer.state !== 'ready' ||
      pointer.authorityId !== source.authorityId ||
      pointerHash(pointer) !== input.expectedPointerHash)
  )
    throw reject();
  const preparation = await authoritySnapshot(db, source, false);
  const parent =
    source.payload.kind === 'paid_upgrade'
      ? await checkedPaidAuthority(db, source)
      : null;
  const renewal=isRenewalKind(source.payload.kind)?await checkedRenewalAuthority(db,source):null;
  if(renewal&&(renewal.state!=='ready'||source.payload.kind!=='renewal_paid'||renewal.request.planRank!==input.sourceRank||renewal.request.periodHash!==input.periodHash||renewal.request.targetCoverageHash!==input.sourceCoverageHash))throw reject();
  if (
    input.selectionHash !== hash(preparation.keepIntegrationIds) ||
    input.sourcePostingLimit !==
      (parent
        ? parent.request.targetPostingLimit
        : renewal?renewal.request.postingAccountLimit:preparation.postingAccountLimit) ||
    input.sourcePrincipalHash !==
      (parent
        ? source.payload.targetPrincipalHash
        : renewal?source.payload.targetPrincipalHash:preparation.principalHash) ||
    input.sourceBindingHash !==
      (parent ? parent.request.targetBindingHash : renewal?renewal.request.contractAppliedHash:preparation.contractHash) ||
    (parent &&
      (parent.request.targetRank !== input.sourceRank ||
        parent.request.periodHash !== input.periodHash ||
        parent.request.targetCoverageHash !== input.sourceCoverageHash))
  )
    throw reject();
  return { source, pointer, preparation };
}
async function paidRootManifest(db: any, source: any, preparation: any) {
  const org = source.organizationId;
  const rows = await db.$queryRawUnsafe(
    'SELECT id,"parentPostId","integrationId","publishDate",state::text,error,"group" FROM "Post" WHERE "organizationId"=$1 AND "deletedAt" IS NULL ORDER BY id LIMIT 10001 FOR UPDATE NOWAIT',
    org,
  );
  if (rows.length > 10000) throw reject();
  const schedules = await db.toybacoPostingSchedule.findMany({
    where: { organizationId: org },
    take: 10001,
    orderBy: [{ rootId: 'asc' }, { rootGeneration: 'asc' }],
  });
  if (schedules.length > 10000) throw reject();
  const manifest = [];
  for (const post of rows.filter(
    (v: any) => !v.parentPostId && ['QUEUE', 'PUBLISHED'].includes(v.state),
  )) {
    const marker =
      /^TOYBACO_(?:WORKFLOW_V2\|(?:ENSURE|REPLACE)|PUBLISH_V2|TERMINAL_V2)\|([0-9]{13})\|([0-9a-f-]{36})\|/.exec(
        post.error || '',
      );
    if (!marker) {
      if (
        post.state === 'QUEUE' &&
        preparation.keepIntegrationIds.includes(post.integrationId)
      )
        throw reject();
      continue;
    }
    const generation = marker[1] + ':' + marker[2];
    const schedule = schedules.find(
      (v: any) => v.rootId === post.id && v.rootGeneration === generation,
    );
    if (!schedule) {
      if (
        post.state === 'QUEUE' &&
        preparation.keepIntegrationIds.includes(post.integrationId)
      )
        throw reject();
      continue;
    }
    const descendants = rows
      .filter((v: any) => v.group === post.group)
      .map((v: any) => ({
        id: v.id,
        parentPostId: v.parentPostId,
        state: v.state,
        error: v.error,
      }));
    if (
      post.state === 'PUBLISHED' &&
      !descendants.some((v: any) => v.parentPostId && v.state === 'QUEUE')
    )
      continue;
    await toybacoScheduleAuthorityChain(db, schedule, source);
    const membership = await db.userOrganization.findUnique({
      where: { id: preparation.ownerMembershipId },
      select: { userId: true },
    });
    const saved =
      membership &&
      (await db.toybacoPostSaveRequest.findUnique({
        where: {
          organizationId_actorId_requestId: {
            organizationId: org,
            actorId: membership.userId,
            requestId: schedule.payload.saveRequestId,
          },
        },
      }));
    if (
      !saved ||
      saved.payloadHash !== schedule.payload.savePayloadHash ||
      !Array.isArray(saved.postsJson) ||
      !saved.postsJson.some((v: any) => v.postId === post.id) ||
      schedule.payload.actorId !== preparation.ownerId
    )
      throw reject();
    if (
      schedule.payload.integrationId !== post.integrationId ||
      !preparation.keepIntegrationIds.includes(post.integrationId) ||
      schedule.payload.publishAt !== post.publishDate.getTime() ||
      schedule.payload.postPayloadHash !==
        (await toybacoPostPayloadHash(db, org, post.id))
    )
      throw reject();
    if (post.state === 'PUBLISHED') {
      const main = checkedStep(
        await db.toybacoPostingStep.findUnique({
          where: {
            organizationId_operationId: {
              organizationId: org,
              operationId: executionId({
                organizationId: org,
                rootId: post.id,
                rootGeneration: generation,
                step: 'MAIN',
                stepPostId: post.id,
                sequence: 0,
              }),
            },
          },
        }),
      );
      if (
        main.state !== 'completed' ||
        main.outcome !== 'published' ||
        main.request.scheduleHash !== schedule.scheduleHash
      )
        throw reject();
    }
    manifest.push({
      rootId: post.id,
      rootGeneration: generation,
      scheduleHash: schedule.scheduleHash,
      saveRequestId: schedule.payload.saveRequestId,
      postPayloadHash: schedule.payload.postPayloadHash,
      markerHash: hash(post.error),
      state: post.state,
      descendantsHash: hash(descendants),
    });
  }
  return manifest;
}
async function paidResult(db: any, row: any) {
  checkedHandoff(row);
  const pointer = await db.toybacoPostingAuthorityCurrent.findUnique({
    where: { organizationId: row.organizationId },
  });
  let current =
    !!row.application &&
    !!pointer &&
    pointer.authorityId === row.application.authorityId &&
    pointer.state === (row.state === 'ready' ? 'ready' : 'pending');
  let authority: any = null;
  if (row.application)
    authority = checkedAuthority(
      await db.toybacoPostingAuthority.findUnique({
        where: {
          organizationId_authorityId: {
            organizationId: row.organizationId,
            authorityId: row.application.authorityId,
          },
        },
      }),
    );
  if (current) {
    try {
      await authoritySnapshot(db, authority, false);
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      current = false;
    }
  }
  return {
    operationId: row.operationId,
    requestHash: row.requestHash,
    receiptHash: row.receiptHash,
    rootManifestHash: row.receipt.rootManifestHash,
    state: row.state,
    authorityId: authority?.authorityId ?? null,
    authorityHash: authority?.authorityHash ?? null,
    pointerHash: pointerHash(pointer),
    current,
    execute: false,
  };
}
export async function postingPaidUpgrade(
  db: any,
  operation: string,
  raw: any,
  applicationRaw: any = null,
) {
  const input = paidUpgradeRequest(raw);
  const application =
    applicationRaw === null ? null : paidUpgradeApplication(applicationRaw);
  if (
    !['prepare', 'apply', 'confirm', 'status', 'withdraw'].includes(
      operation,
    ) ||
    ['apply', 'confirm'].includes(operation) !== !!application
  )
    throw reject();
  if (['prepare', 'apply'].includes(operation)) {
    authorityEnabled();
    if (process.env.TOYBACO_POSTING_PAID_UPGRADE_ENABLED !== 'true')
      throw reject();
  }
  await lock(db, input.organizationId);
  const where = {
    organizationId_operationId: {
      organizationId: input.organizationId,
      operationId: input.operationId,
    },
  };
  let row = await db.toybacoPostingPaidUpgrade.findUnique({ where });
  if (row) {
    checkedHandoff(row);
    if (row.requestHash !== hash(input)) throw reject();
    if (
      application &&
      row.application &&
      row.applicationHash !== hash(application)
    )
      throw reject();
    if (
      operation === 'status' ||
      operation === 'prepare' ||
      row.state === 'ready' ||
      row.state === 'withdrawn'
    )
      return paidResult(db, row);
  } else {
    if (operation !== 'prepare') throw reject();
    await noPaidHandoff(db, input.organizationId);
    const { source, preparation } = await paidSource(db, input);
    if (
      await db.toybacoPostingStep.count({
        where: {
          organizationId: input.organizationId,
          state: { in: ['reserved', 'started', 'pending', 'uncertain'] },
        },
      })
    )
      throw reject();
    const roots = await paidRootManifest(db, source, preparation);
    const receipt = {
      version: 1,
      organizationId: input.organizationId,
      operationId: input.operationId,
      requestHash: hash(input),
      rootManifestHash: hash(roots),
      roots,
    };
    row = await db.toybacoPostingPaidUpgrade.create({
      data: {
        organizationId: input.organizationId,
        operationId: input.operationId,
        request: input,
        requestHash: hash(input),
        receipt,
        receiptHash: hash(receipt),
        state: 'pending',
      },
    });
    return paidResult(db, row);
  }
  if (operation === 'withdraw') {
    if (row.state !== 'pending') throw reject();
    await paidSource(db, input);
    row = await db.toybacoPostingPaidUpgrade.update({
      where,
      data: { state: 'withdrawn', resolvedAt: new Date() },
    });
    return paidResult(db, row);
  }
  if (operation === 'apply' && row.state === 'pending') {
    if (
      application.receiptHash !== row.receiptHash ||
      application.targetPrincipalHash === input.sourcePrincipalHash ||
      application.authorityId === input.sourceAuthorityId
    )
      throw reject();
    const { source, pointer, preparation } = await paidSource(db, input);
    const roots = await paidRootManifest(db, source, preparation);
    if (
      hash(roots) !== row.receipt.rootManifestHash ||
      (await db.toybacoPostingStep.count({
        where: {
          organizationId: input.organizationId,
          state: { in: ['reserved', 'started', 'pending', 'uncertain'] },
        },
      }))
    )
      throw reject();
    const payload = upgradedAuthority(row, source, application),
      authorityHash = hash(payload);
    await db.toybacoPostingAuthority.create({
      data: {
        organizationId: input.organizationId,
        authorityId: payload.authorityId,
        authorityHash,
        payload,
      },
    });
    for (const root of roots) {
      const payload = {
        ...root,
        organizationId: input.organizationId,
        operationId: input.operationId,
        handoffReceiptHash: row.receiptHash,
        sourceAuthorityId: source.authorityId,
        sourceAuthorityHash: source.authorityHash,
        targetAuthorityId: application.authorityId,
        targetAuthorityHash: authorityHash,
      };
      await db.toybacoPostingScheduleContinuation.create({
        data: {
          organizationId: input.organizationId,
          rootId: root.rootId,
          rootGeneration: root.rootGeneration,
          targetAuthorityId: application.authorityId,
          payload,
          continuationHash: hash(payload),
        },
      });
    }
    if (BigInt(pointer.generation) + BigInt(1) >= BigInt('9223372036854775807'))
      throw reject();
    await db.toybacoPostingAuthorityCurrent.update({
      where: { organizationId: input.organizationId },
      data: {
        authorityId: application.authorityId,
        generation: { increment: 1 },
        epoch: randomUUID(),
        state: 'pending',
      },
    });
    row = await db.toybacoPostingPaidUpgrade.update({
      where,
      data: {
        state: 'applied',
        application,
        applicationHash: hash(application),
      },
    });
    return paidResult(db, row);
  }
  if (operation === 'confirm' && row.state === 'applied') {
    if (!application || row.applicationHash !== hash(application))
      throw reject();
    const result = await paidResult(db, row);
    if (!result.current) throw reject();
    const source = await sourceAuthority(db, input),
      preparation = await authoritySnapshot(db, source, false);
    if (
      hash(await paidRootManifest(db, source, preparation)) !==
      row.receipt.rootManifestHash
    )
      throw reject();
    await db.toybacoPostingAuthorityCurrent.update({
      where: { organizationId: input.organizationId },
      data: { state: 'ready' },
    });
    row = await db.toybacoPostingPaidUpgrade.update({
      where,
      data: { state: 'ready', resolvedAt: new Date() },
    });
    return paidResult(db, row);
  }
  if (operation === 'apply' && row.state === 'applied')
    return paidResult(db, row);
  throw reject();
}

const RENEWAL_FIELDS = ['version','protocol','phase','kind','organizationId','operationId','sourceAuthorityId','sourceAuthorityHash','targetAuthorityId','targetAuthorityHash','handoffReceiptHash','contractAppliedHash','targetPrincipalHash','sourcePointerHash','preparationRequestId','expiresAt','targetAuthority','billingEvidenceHash','sourceCoverageHash','targetCoverageHash','sourceTermStart','sourceTermEnd','termStart','termEnd','firstFailedAt','dueAt','periodHash','planRank','postingAccountLimit','execute'];
export function isRenewalKind(value:any) { return value==='renewal_grace'||value==='renewal_paid'; }
export function renewalRequest(raw:any) {
  if(!keys(raw,RENEWAL_FIELDS)||raw.version!==1||raw.protocol!=='toybaco-posting-renewal-v1'||!['prepare','confirm','status'].includes(raw.phase)||!isRenewalKind(raw.kind)||raw.execute!==false||!id(raw.organizationId))throw reject();
  for(const field of ['operationId','sourceAuthorityId','sourceAuthorityHash','targetAuthorityId','targetAuthorityHash','handoffReceiptHash','contractAppliedHash','targetPrincipalHash','sourcePointerHash','preparationRequestId','billingEvidenceHash','sourceCoverageHash','periodHash'])if(!hex(raw[field]))throw reject();
  if(!Number.isInteger(raw.planRank)||raw.planRank<1||raw.planRank>3||!Number.isSafeInteger(raw.postingAccountLimit)||raw.postingAccountLimit<1||raw.postingAccountLimit>10000)throw reject();
  const target=authorityRequest(raw.targetAuthority);
  if(!['sourceTermStart','sourceTermEnd','termStart','termEnd','expiresAt'].every(k=>positive(raw[k]))||raw.sourceTermStart>=raw.sourceTermEnd||raw.termStart!==raw.sourceTermEnd||raw.termStart>=raw.termEnd||raw.targetAuthorityHash!==hash(target)||raw.sourceAuthorityId===raw.targetAuthorityId)throw reject();
  if(target.kind!==raw.kind||target.organizationId!==raw.organizationId||target.authorityId!==raw.targetAuthorityId||target.preparationRequestId!==raw.preparationRequestId||target.expiresAt!==raw.expiresAt||target.sourceAuthorityId!==raw.sourceAuthorityId||target.sourceAuthorityHash!==raw.sourceAuthorityHash||target.handoffReceiptHash!==raw.handoffReceiptHash||target.operationId!==raw.operationId||target.contractAppliedHash!==raw.contractAppliedHash||target.targetPrincipalHash!==raw.targetPrincipalHash||target.expectedPointerHash!==raw.sourcePointerHash)throw reject();
  if(raw.firstFailedAt!==null||raw.dueAt!==null){if(!positive(raw.firstFailedAt)||!positive(raw.dueAt)||raw.dueAt!==raw.firstFailedAt+604800||raw.firstFailedAt<raw.termStart||raw.firstFailedAt>=raw.termEnd)throw reject();}
  if(raw.kind==='renewal_grace'){
    if(raw.targetCoverageHash!==null||raw.firstFailedAt===null||raw.expiresAt!==Math.min(raw.dueAt,raw.termEnd))throw reject();
  } else if(!hex(raw.targetCoverageHash)||raw.expiresAt!==raw.termEnd)throw reject();
  return copy(raw);
}
function renewalRequestHash(input:any) { const {phase,...request}=input;return hash(request); }
function checkedRenewal(row:any) {
  const request=row?.request;
  if(!row||row.requestHash!==renewalRequestHash(renewalRequest(request))||row.organizationId!==request.organizationId||row.operationId!==request.operationId||row.receiptHash!==hash(row.receipt)||!keys(row.receipt,['version','organizationId','operationId','requestHash','rootManifestHash','roots','targetPointerHash'])||row.receipt.version!==1||row.receipt.organizationId!==row.organizationId||row.receipt.operationId!==row.operationId||row.receipt.requestHash!==row.requestHash||!Array.isArray(row.receipt.roots)||row.receipt.roots.length>10000||hash(row.receipt.roots)!==row.receipt.rootManifestHash||!hex(row.receipt.targetPointerHash)||!['applied','ready'].includes(row.state))throw reject();
  return row;
}
async function checkedRenewalAuthority(db:any,row:any) {
  const renewal=checkedRenewal(await db.toybacoPostingRenewal.findUnique({where:{organizationId_operationId:{organizationId:row.organizationId,operationId:row.payload.operationId}}}));
  if(hash(renewal.request.targetAuthority)!==row.authorityHash||row.authorityId!==renewal.request.targetAuthorityId)throw reject();
  const source=checkedAuthority(await db.toybacoPostingAuthority.findUnique({where:{organizationId_authorityId:{organizationId:row.organizationId,authorityId:renewal.request.sourceAuthorityId}}}));
  if(source.authorityHash!==renewal.request.sourceAuthorityHash)throw reject();
  return renewal;
}
async function renewalSource(db:any,input:any,expectPointer=true) {
  const source=checkedAuthority(await db.toybacoPostingAuthority.findUnique({where:{organizationId_authorityId:{organizationId:input.organizationId,authorityId:input.sourceAuthorityId}}}));
  const pointer=await db.toybacoPostingAuthorityCurrent.findUnique({where:{organizationId:input.organizationId}});
  if(source.authorityHash!==input.sourceAuthorityHash||source.payload.accountId!==input.targetAuthority.accountId||source.payload.preparationRequestId!==input.preparationRequestId||source.payload.preparationReceiptHash!==input.targetAuthority.preparationReceiptHash||source.payload.scheduledPostsPerAccount!==input.targetAuthority.scheduledPostsPerAccount)throw reject();
  if(expectPointer&&(!pointer||pointer.state!=='ready'||pointer.authorityId!==source.authorityId||pointerHash(pointer)!==input.sourcePointerHash))throw reject();
  // Old expiry is allowed only for this signed, explicitly typed renewal path.
  const preparation=await authoritySnapshot(db,source,false,true);
  const paidParent=source.payload.kind==='paid_upgrade'?await checkedPaidAuthority(db,source):null;
  const renewalParent=isRenewalKind(source.payload.kind)?await checkedRenewalAuthority(db,source):null;
  const contract=paidParent?paidParent.request.targetBindingHash:renewalParent?renewalParent.request.contractAppliedHash:preparation.contractHash;
  const principal=source.payload.kind?source.payload.targetPrincipalHash:preparation.principalHash;
  const limit=paidParent?paidParent.request.targetPostingLimit:renewalParent?renewalParent.request.postingAccountLimit:preparation.postingAccountLimit;
  if(input.contractAppliedHash!==contract||input.targetPrincipalHash!==principal||input.postingAccountLimit!==limit||(paidParent&&(paidParent.state!=='ready'||input.planRank!==paidParent.request.targetRank||input.sourceCoverageHash!==paidParent.request.targetCoverageHash))||(renewalParent&&input.planRank!==renewalParent.request.planRank))throw reject();
  if(isRenewalKind(source.payload.kind)){
    const previous=await checkedRenewalAuthority(db,source);
    if(previous.state!=='ready')throw reject();
    if(source.payload.kind==='renewal_grace'){
      if(input.kind!=='renewal_paid'||input.termStart!==previous.request.termStart||input.termEnd!==previous.request.termEnd||input.firstFailedAt!==previous.request.firstFailedAt||input.dueAt!==previous.request.dueAt||input.sourceCoverageHash!==previous.request.sourceCoverageHash)throw reject();
    }else if(input.sourceTermStart!==previous.request.termStart||input.sourceTermEnd!==previous.request.termEnd||input.sourceCoverageHash!==previous.request.targetCoverageHash)throw reject();
  }else if(source.payload.expiresAt!==input.sourceTermEnd)throw reject();
  return {source,pointer,preparation};
}
async function renewalRoots(db:any,source:any,preparation:any) {
  const roots=await paidRootManifest(db,source,preparation);
  const output=[];
  for(const root of roots){
    const schedule=await db.toybacoPostingSchedule.findUnique({where:{organizationId_rootId_rootGeneration:{organizationId:source.organizationId,rootId:root.rootId,rootGeneration:root.rootGeneration}}});
    const original=checkedAuthority(await db.toybacoPostingAuthority.findUnique({where:{organizationId_authorityId:{organizationId:source.organizationId,authorityId:schedule.authorityId}}}));
    if(original.authorityHash!==schedule.payload.authorityHash)throw reject();
    output.push({...root,originalAuthorityId:original.authorityId,originalAuthorityHash:original.authorityHash});
  }
  return output;
}
function renewalResponse(input:any,row:any) {
  return {version:1,protocol:input.protocol,requestHash:hash(input),operationId:input.operationId,sourceAuthorityId:input.sourceAuthorityId,targetAuthorityId:input.targetAuthorityId,targetAuthorityHash:input.targetAuthorityHash,sourcePointerHash:input.sourcePointerHash,targetPointerHash:row.receipt.targetPointerHash,receiptHash:row.receiptHash,rootManifestHash:row.receipt.rootManifestHash,state:input.phase==='confirm'?'ready':'prepared',execute:false};
}
export async function postingRenewal(db:any,raw:any) {
  const input=renewalRequest(raw);
  await lock(db,input.organizationId);
  const where={organizationId_operationId:{organizationId:input.organizationId,operationId:input.operationId}};
  let row=await db.toybacoPostingRenewal.findUnique({where});
  if(row){checkedRenewal(row);if(row.requestHash!==renewalRequestHash(input))throw reject();}
  if(input.phase==='prepare'&&!row){
    authorityEnabled();if(process.env.TOYBACO_POSTING_RENEWAL_ENABLED!=='true')throw reject();
    const now=Math.floor(Date.now()/1000);
    if(input.termStart>now||input.expiresAt<=now||(input.firstFailedAt!==null&&input.firstFailedAt>now))throw reject();
    await noPaidHandoff(db,input.organizationId);
    const {source,pointer,preparation}=await renewalSource(db,input);
    if(await db.toybacoPostingStep.count({where:{organizationId:input.organizationId,state:{in:['reserved','started','pending','uncertain']}}}))throw reject();
    const roots=await renewalRoots(db,source,preparation);
    const generation=BigInt(pointer.generation)+1n;if(generation>=9223372036854775807n)throw reject();
    const targetPointer={organizationId:input.organizationId,authorityId:input.targetAuthorityId,generation,epoch:randomUUID(),state:'pending'};
    const requestHash=renewalRequestHash(input);
    const receipt={version:1,organizationId:input.organizationId,operationId:input.operationId,requestHash,rootManifestHash:hash(roots),roots,targetPointerHash:pointerHash(targetPointer)};
    row=await db.toybacoPostingRenewal.create({data:{organizationId:input.organizationId,operationId:input.operationId,request:input,requestHash,receipt,receiptHash:hash(receipt),state:'applied'}});
    await db.toybacoPostingAuthority.create({data:{organizationId:input.organizationId,authorityId:input.targetAuthorityId,authorityHash:input.targetAuthorityHash,payload:input.targetAuthority}});
    for(const root of roots){
      const payload={...root,kind:input.kind,organizationId:input.organizationId,operationId:input.operationId,handoffReceiptHash:row.receiptHash,sourceAuthorityId:root.originalAuthorityId,sourceAuthorityHash:root.originalAuthorityHash,targetAuthorityId:input.targetAuthorityId,targetAuthorityHash:input.targetAuthorityHash};
      await db.toybacoPostingScheduleContinuation.create({data:{organizationId:input.organizationId,rootId:root.rootId,rootGeneration:root.rootGeneration,targetAuthorityId:input.targetAuthorityId,payload,continuationHash:hash(payload)}});
    }
    await db.toybacoPostingAuthorityCurrent.update({where:{organizationId:input.organizationId},data:targetPointer});
    return renewalResponse(input,row);
  }
  if(!row)throw reject();
  // Recovery never restores the source pointer or creates another operation.
  if(input.phase==='prepare'||input.phase==='status')return renewalResponse(input,row);
  const pointer=await db.toybacoPostingAuthorityCurrent.findUnique({where:{organizationId:input.organizationId}});
  if(!pointer||pointer.authorityId!==input.targetAuthorityId||pointerHash(pointer)!==row.receipt.targetPointerHash||pointer.state!==(row.state==='ready'?'ready':'pending'))throw reject();
  const {source,preparation}=await renewalSource(db,input,false);
  if(input.expiresAt<=Math.floor(Date.now()/1000)||hash(await renewalRoots(db,source,preparation))!==row.receipt.rootManifestHash)throw reject();
  if(row.state==='applied'){
    if(await db.toybacoPostingStep.count({where:{organizationId:input.organizationId,state:{in:['reserved','started','pending','uncertain']}}}))throw reject();
    await db.toybacoPostingAuthorityCurrent.update({where:{organizationId:input.organizationId},data:{state:'ready'}});
    row=await db.toybacoPostingRenewal.update({where,data:{state:'ready',resolvedAt:new Date()}});
  }
  return renewalResponse(input,row);
}
