import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';

// This transaction lock is shared by writers/claims and exclusive for a hold.
// It is deliberately separate from the external provider call: an existing
// CLAIMED marker must drain before a hold can be committed.
export async function toybacoRetentionLock(database: any, orgId: string, exclusive = false) {
  if (!validId(orgId)) throw new ForbiddenException('店舗を確認できません。');
  await database.$queryRawUnsafe(
    exclusive
      ? "SELECT 1::integer AS locked FROM pg_advisory_xact_lock(hashtextextended('toybaco:posting-retention:' || $1, 0))"
      : "SELECT 1::integer AS locked FROM pg_advisory_xact_lock_shared(hashtextextended('toybaco:posting-retention:' || $1, 0))",
    orgId
  );
}

const LIMIT = 10000;
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= LIMIT && value.every(validId) && new Set(value).size === value.length;
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
export function toybacoRetentionPolicy(orgId: string, request: any) {
  if (!request || !validId(orgId) || (typeof request.transitionId !== 'string' || !/^[0-9a-f]{64}$/.test(request.transitionId)) ||
      !validIds(request.keepIntegrationIds) || !Number.isInteger(request.scheduledPostsPerAccount) ||
      request.scheduledPostsPerAccount < 0 || request.scheduledPostsPerAccount > LIMIT) {
    throw new ForbiddenException('保留する契約条件を確認できません。');
  }
  const policy: { organizationId: string; transitionId: string; keepIntegrationIds: string[];
    scheduledPostsPerAccount: number; previousTransitionId?: string; previousReceiptHash?: string } = {
    organizationId: orgId,
    transitionId: request.transitionId,
    keepIntegrationIds: [...request.keepIntegrationIds].sort(),
    scheduledPostsPerAccount: request.scheduledPostsPerAccount,
  };
  if (request.previousTransitionId !== undefined || request.previousReceiptHash !== undefined) {
    if (!digest(request.previousTransitionId) || !digest(request.previousReceiptHash) || request.previousTransitionId === request.transitionId) {
      throw new ForbiddenException('直前の契約変更を確認できません。');
    }
    policy.previousTransitionId = request.previousTransitionId;
    policy.previousReceiptHash = request.previousReceiptHash;
  }
  return { ...policy, policyHash: hash(policy) };
}

export function toybacoCheckedRetention(value: any, orgId: string) {
  if (!value) return null;
  const policy = toybacoRetentionPolicy(orgId, value.policy);
  if (value.organizationId !== orgId || value.policy.organizationId !== orgId || value.transitionId !== policy.transitionId ||
      value.policyHash !== policy.policyHash || value.policy.policyHash !== policy.policyHash ||
      Object.keys(value.policy).sort().join('|') !== Object.keys(policy).sort().join('|') || !validIds(value.keepIntegrationIds) ||
      !validIds(value.keepPostIds) || !validIds(value.heldPostIds) ||
      value.keepIntegrationIds.some((id: string) => !policy.keepIntegrationIds.includes(id)) ||
      value.keepPostIds.some((id: string) => value.heldPostIds.includes(id)) ||
      value.receiptHash !== hash([policy.policyHash, value.keepIntegrationIds, value.keepPostIds, value.heldPostIds])) {
    throw new ForbiddenException('保留状態の再確認が必要です。');
  }
  return value;
}

const RECEIPT_FIELDS = ['organizationId', 'transitionId', 'policyHash', 'receiptHash', 'policy', 'keepIntegrationIds', 'keepPostIds', 'heldPostIds'];
function receiptData(value: any) {
  return Object.fromEntries(RECEIPT_FIELDS.map(key => [key, value[key]]));
}
function checkedHistory(row: any, orgId: string) {
  if (!row || row.organizationId !== orgId || !Number.isInteger(row.generation) || row.generation < 1 || row.generation > LIMIT ||
      !row.receipt || Object.keys(row.receipt).sort().join('|') !== [...RECEIPT_FIELDS].sort().join('|')) {
    throw new ForbiddenException('契約変更の履歴を確認できません。');
  }
  const receipt = toybacoCheckedRetention(row.receipt, orgId);
  if (receipt.transitionId !== row.transitionId || receipt.receiptHash !== row.receiptHash ||
      (row.generation === 1) !== (receipt.policy.previousTransitionId === undefined)) {
    throw new ForbiddenException('契約変更の履歴が一致しません。');
  }
  return row;
}
export async function toybacoRetentionHistory(database: any, orgId: string, transitionId: string) {
  if (!digest(transitionId)) throw new ForbiddenException('契約変更を確認できません。');
  const row = await database.toybacoPostingRetentionHistory.findUnique({ where: { organizationId_transitionId: { organizationId: orgId, transitionId } } });
  if (!row) return null;
  checkedHistory(row, orgId);
  if (row.generation > 1) {
    const parent = checkedHistory(await database.toybacoPostingRetentionHistory.findUnique({
      where: { organizationId_transitionId: { organizationId: orgId, transitionId: row.receipt.policy.previousTransitionId } },
    }), orgId);
    if (parent.generation !== row.generation - 1 || parent.receiptHash !== row.receipt.policy.previousReceiptHash) {
      throw new ForbiddenException('直前の契約変更の履歴が一致しません。');
    }
  }
  return row;
}
export async function toybacoRetentionCurrent(database: any, orgId: string) {
  const current = toybacoCheckedRetention(await database.toybacoPostingRetention.findUnique({ where: { organizationId: orgId } }), orgId);
  if (!current) {
    if (await database.toybacoPostingRetentionHistory.count({ where: { organizationId: orgId } })) {
      throw new ForbiddenException('現在の契約変更の記録がありません。');
    }
    return null;
  }
  const history = await toybacoRetentionHistory(database, orgId, current.transitionId);
  if (!history || history.receiptHash !== current.receiptHash || history.receipt.policyHash !== current.policyHash) {
    throw new ForbiddenException('現在の契約変更と履歴が一致しません。');
  }
  // A stale pointer may not revive an earlier generation after a later stop.
  const latest = await database.toybacoPostingRetentionHistory.findFirst({ where: { organizationId: orgId }, orderBy: { generation: 'desc' } });
  if (!latest || latest.transitionId !== current.transitionId || latest.generation !== history.generation) {
    throw new ForbiddenException('現在の契約変更の世代が一致しません。');
  }
  return current;
}

export async function toybacoRetentionWrite(database: any, orgId: string, draftOnly: boolean) {
  await toybacoRetentionLock(database, orgId);
  const receipt = await toybacoRetentionCurrent(database, orgId);
  if (receipt && !draftOnly) throw new ForbiddenException('契約変更の保留処理中です。原稿は下書きとして編集できます。');
}

export async function toybacoRetentionPublish(database: any, orgId: string, rootPostId: string) {
  await toybacoRetentionLock(database, orgId);
  const receipt = await toybacoRetentionCurrent(database, orgId);
  const post = await database.post.findFirst({
    where: { id: rootPostId, organizationId: orgId, parentPostId: null, deletedAt: null },
    select: { integrationId: true },
  });
  if (!post || (receipt && (!receipt.keepPostIds.includes(rootPostId) || !receipt.keepIntegrationIds.includes(post.integrationId)))) {
    throw new ForbiddenException('この予約は保留されています。');
  }
  const active = await database.$queryRawUnsafe(
    'SELECT "id" FROM "Integration" WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL AND "disabled" = false FOR UPDATE',
    post.integrationId, orgId
  );
  if (active.length !== 1) throw new ForbiddenException('この投稿先は停止しています。');
}

export async function toybacoApplyPostingRetention(database: any, orgId: string, request: any, validateRoot: any, holdRoot: any) {
  const policy = toybacoRetentionPolicy(orgId, request);
  await toybacoRetentionLock(database, orgId, true);
  const previous = await toybacoRetentionCurrent(database, orgId);
  const historical = await toybacoRetentionHistory(database, orgId, policy.transitionId);
  if (historical) {
    if (historical.receipt.policyHash !== policy.policyHash) throw new ForbiddenException('同じ契約変更の内容が一致しません。');
    return historical.receipt;
  }
  let generation = 1;
  if (previous) {
    if (policy.previousTransitionId !== previous.transitionId || policy.previousReceiptHash !== previous.receiptHash ||
        policy.keepIntegrationIds.some((id: string) => !previous.keepIntegrationIds.includes(id)) ||
        policy.scheduledPostsPerAccount > previous.policy.scheduledPostsPerAccount) {
      throw new ForbiddenException('直前の保留より利用範囲を増やせません。');
    }
    generation = (await toybacoRetentionHistory(database, orgId, previous.transitionId)).generation + 1;
    if (generation > LIMIT) throw new ForbiddenException('契約変更の履歴を確認してください。');
    const held = await database.post.findMany({ where: { organizationId: orgId, id: { in: previous.heldPostIds }, deletedAt: null }, select: { id: true, state: true, parentPostId: true, error: true } });
    if (held.some((row: any) => row.parentPostId !== null || row.state !== 'DRAFT' || row.error !== null)) {
      throw new ForbiddenException('直前の予約停止の完了確認が必要です。');
    }
  } else if (policy.previousTransitionId !== undefined) {
    throw new ForbiddenException('直前の保留がありません。');
  }
  const integrations = await database.integration.findMany({
    where: { organizationId: orgId, deletedAt: null }, select: { id: true }, take: LIMIT + 1,
  });
  if (integrations.length > LIMIT) throw new ForbiddenException('接続一覧を確認できません。');
  const available = new Set(integrations.map((row: any) => row.id));
  const keptIntegrations = policy.keepIntegrationIds.filter(id => available.has(id));
  const inflight = await database.post.count({ where: {
    organizationId: orgId, deletedAt: null,
    OR: [{ error: { startsWith: 'TOYBACO_STEP_V2|' } },
      { AND: [{ error: { startsWith: 'TOYBACO_PUBLISH_V2|' } }, { error: { endsWith: '|CLAIMED' } }] }],
  } });
  if (inflight) throw new ForbiddenException('実行中の投稿が完了してから再試行してください。');
  // Ordering stays in PostgreSQL so timestamps differing only in microseconds
  // cannot be reordered by JavaScript Date's millisecond precision.
  const roots = await database.$queryRawUnsafe(
    'SELECT "id", "group", "integrationId", "state"::text AS "state", "error" FROM "Post" WHERE "organizationId" = $1 AND "deletedAt" IS NULL AND "parentPostId" IS NULL AND "state" = \'QUEUE\' ORDER BY "publishDate", "id" LIMIT 10001 FOR UPDATE',
    orgId
  );
  if (roots.length > LIMIT) throw new ForbiddenException('予約一覧を確認できません。');
  const allowed = new Set(keptIntegrations), counts = new Map<string, number>();
  if (previous && roots.some((row: any) => !previous.keepPostIds.includes(row.id) || !previous.keepIntegrationIds.includes(row.integrationId))) {
    throw new ForbiddenException('前の世代にない予約の確認が必要です。');
  }
  const keepPostIds: string[] = [], heldPostIds: string[] = previous ? [...previous.heldPostIds] : [];
  for (const root of roots) {
    const group = await validateRoot(database, orgId, root);
    const count = counts.get(root.integrationId) || 0;
    if (allowed.has(root.integrationId) && count < policy.scheduledPostsPerAccount) {
      counts.set(root.integrationId, count + 1);
      keepPostIds.push(root.id);
    } else {
      await holdRoot(database, orgId, root, group);
      heldPostIds.push(root.id);
    }
  }
  if (heldPostIds.length > LIMIT) throw new ForbiddenException('保留予約の履歴上限を確認してください。');
  const data = {
    organizationId: orgId, transitionId: policy.transitionId, policyHash: policy.policyHash,
    policy, keepIntegrationIds: keptIntegrations, keepPostIds, heldPostIds,
    receiptHash: hash([policy.policyHash, keptIntegrations, keepPostIds, heldPostIds]),
  };
  await database.toybacoPostingRetentionHistory.create({ data: {
    organizationId: orgId, transitionId: policy.transitionId, generation, receiptHash: data.receiptHash, receipt: receiptData(data),
  } });
  if (!previous) {
    await database.toybacoPostingRetention.create({ data });
    return data;
  }
  const changed = await database.toybacoPostingRetention.updateMany({
    where: { organizationId: orgId, transitionId: previous.transitionId, receiptHash: previous.receiptHash }, data,
  });
  if (changed.count !== 1) throw new ForbiddenException('現在の契約変更を更新できません。');
  return data;
}

// Non-executable second-database receipt. The caller must authenticate the Rails
// preparation separately; these hashes are not current execution authority.
const PREPARATION_FIELDS = ['version', 'organizationId', 'requestId', 'accountId', 'ownerId', 'actorId',
  'ownerMembershipId', 'principalHash', 'railsReceiptHash', 'contractHash', 'selectionRevision',
  'holdTransitionId', 'holdReceiptHash', 'holdGeneration', 'inventoryHash', 'identityHash', 'requestedIntegrationIds',
  'keepIntegrationIds', 'postingAccountLimit'];
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function toybacoPreparationHash(value: any) { return hash(canonical(value)); }
function mappedIdentity(namespace: string, name: string) {
  const bytes = Uint8Array.from(namespace.replace(/-/g, '').match(/../g)!.map(byte => parseInt(byte, 16)));
  const hex = createHash('sha1').update(bytes).update(name).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const raw = hex.join('');
  return [raw.slice(0, 8), raw.slice(8, 12), raw.slice(12, 16), raw.slice(16, 20), raw.slice(20)].join('-');
}
function sortedIds(value: any) { return validIds(value) && JSON.stringify(value) === JSON.stringify([...value].sort()); }
export function toybacoPreparationRequest(orgId: string, value: any) {
  const positive = (id: any) => Number.isSafeInteger(id) && id > 0;
  if (!value || Object.keys(value).sort().join('|') !== [...PREPARATION_FIELDS].sort().join('|') ||
      value.version !== 2 || !positive(value.accountId) || !positive(value.ownerId) || value.actorId !== value.ownerId ||
      value.organizationId !== orgId || !validId(value.ownerMembershipId) ||
      orgId !== mappedIdentity('2ce137d1-b153-5df8-a334-f97cb11ad413', 'chatwoot-account:' + value.accountId) ||
      !['requestId', 'principalHash', 'railsReceiptHash', 'contractHash', 'selectionRevision', 'holdTransitionId',
        'holdReceiptHash', 'inventoryHash', 'identityHash'].every(key => digest(value[key])) ||
      !Number.isInteger(value.holdGeneration) || value.holdGeneration < 1 || value.holdGeneration > LIMIT ||
      !Number.isInteger(value.postingAccountLimit) || value.postingAccountLimit < 1 || value.postingAccountLimit > LIMIT ||
      !sortedIds(value.requestedIntegrationIds) || !value.requestedIntegrationIds.length || !sortedIds(value.keepIntegrationIds) ||
      value.keepIntegrationIds.length > value.postingAccountLimit ||
      value.requestedIntegrationIds.some((id: string) => !value.keepIntegrationIds.includes(id)) || JSON.stringify(value).length > 65536) {
    throw new ForbiddenException('再開の準備内容を確認できません。');
  }
  return Object.fromEntries(PREPARATION_FIELDS.map(key => [key, Array.isArray(value[key]) ? [...value[key]] : value[key]]));
}
function preparationReceipt(row: any, request: any, now: number) {
  const payloadHash = toybacoPreparationHash(request);
  const receipt = row?.receipt;
  if (!row || row.organizationId !== request.organizationId || row.requestId !== request.requestId ||
      row.payloadHash !== payloadHash || toybacoPreparationHash(row.request) !== payloadHash ||
      !receipt || Object.keys(receipt).sort().join('|') !== ['execute', 'organizationId', 'payloadHash', 'preparedAt', 'receiptHash', 'requestId', 'state', 'version'].sort().join('|') ||
      receipt.version !== 2 || receipt.organizationId !== request.organizationId || receipt.requestId !== request.requestId ||
      receipt.payloadHash !== payloadHash || receipt.state !== 'prepared' || receipt.execute !== false ||
      !Number.isSafeInteger(receipt.preparedAt) || receipt.preparedAt < 1 || receipt.preparedAt > now ||
      row.createdAt.getTime() !== receipt.preparedAt || row.receiptHash !== receipt.receiptHash ||
      receipt.receiptHash !== toybacoPreparationHash(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptHash')))) {
    throw new ForbiddenException('再開準備の履歴が一致しません。');
  }
  return receipt;
}

async function preparationSnapshot(database: any, request: any) {
  const orgId = request.organizationId;
  const current = await toybacoRetentionCurrent(database, orgId);
  const history = current && await toybacoRetentionHistory(database, orgId, current.transitionId);
  if (!current || current.transitionId !== request.holdTransitionId || current.receiptHash !== request.holdReceiptHash ||
      history.generation !== request.holdGeneration || request.requestedIntegrationIds.some((id: string) => current.keepIntegrationIds.includes(id)) ||
      JSON.stringify([...current.keepIntegrationIds, ...request.requestedIntegrationIds].sort()) !== JSON.stringify(request.keepIntegrationIds)) {
    throw new ForbiddenException('現在の保留世代を確認できません。');
  }
  const ownerId = mappedIdentity('c2b69454-2577-5ca4-a2ed-b06c9909691a', 'chatwoot-user:' + request.ownerId);
  const owners = await database.$queryRawUnsafe(`SELECT u.id AS user_id, uo.id AS membership_id, uo.role::text AS role
    FROM "User" u JOIN "UserOrganization" uo ON uo."userId" = u.id
    JOIN "Organization" o ON o.id = uo."organizationId"
    WHERE u."providerName" = 'GENERIC'::"Provider" AND u."providerId" = $1 AND u.id = $2
      AND u.activated = true AND u."deletedAt" IS NULL AND uo."organizationId" = $3
      AND uo.disabled = false AND o."deletedAt" IS NULL LIMIT 2 FOR UPDATE OF u, uo, o NOWAIT`,
    'cw:' + request.ownerId, ownerId, orgId);
  if (owners.length !== 1 || owners[0].role !== 'ADMIN' || owners[0].membership_id !== request.ownerMembershipId) {
    throw new ForbiddenException('現在の管理者を確認できません。');
  }
  // SQL text casts preserve the same PG wire values as the Rails read-only
  // snapshot (including microseconds); no credential or message body is read.
  const targets = await database.$queryRawUnsafe(`SELECT id, "internalId", "providerIdentifier",
    CASE WHEN disabled THEN 't' ELSE 'f' END AS disabled, "createdAt"::text AS "createdAt"
    FROM "Integration" WHERE "organizationId" = $1 AND "deletedAt" IS NULL ORDER BY id LIMIT 10001 FOR UPDATE NOWAIT`, orgId);
  const identity = await toybacoPostingIdentityEpochs(database, [
    { kind: 'Organization', entityId: orgId }, { kind: 'User', entityId: ownerId },
    { kind: 'UserOrganization', entityId: owners[0].membership_id },
    ...targets.map((row: any) => ({ kind: 'Integration', entityId: row.id })),
  ]);
  if (identity.identityHash !== request.identityHash) throw new ForbiddenException('本人や接続先が変わりました。準備をやり直してください。');
  const posts = await database.$queryRawUnsafe(`SELECT p.id, p."integrationId" AS integration_id,
    (EXTRACT(EPOCH FROM p."publishDate") * 1000000)::bigint::text AS publish_at_us, p.state::text AS state, p.error
    FROM "Post" p JOIN "Integration" i ON i.id = p."integrationId" AND i."organizationId" = p."organizationId"
    WHERE p."organizationId" = $1 AND p."deletedAt" IS NULL AND i."deletedAt" IS NULL
      AND p."parentPostId" IS NULL AND (p.state = 'QUEUE' OR p.id IN (SELECT jsonb_array_elements_text($2::jsonb)))
    ORDER BY p."publishDate", p.id LIMIT 10001 FOR UPDATE OF p NOWAIT`, orgId, JSON.stringify(current.heldPostIds));
  const held = new Set(current.heldPostIds), kept = new Set(current.keepPostIds), available = new Set(targets.map((row: any) => row.id));
  if (targets.length > LIMIT || posts.length > LIMIT || request.keepIntegrationIds.some((id: string) => !available.has(id))) {
    throw new ForbiddenException('接続や予約の一覧を確認できません。');
  }
  const inventory = posts.map((row: any) => {
    const stopped = held.has(row.id), time = Number(row.publish_at_us);
    if (!Number.isSafeInteger(time) || (stopped ? row.state !== 'DRAFT' || row.error !== null :
      row.state !== 'QUEUE' || !kept.has(row.id) || !current.keepIntegrationIds.includes(row.integration_id))) {
      throw new ForbiddenException('予約の停止完了を確認できません。');
    }
    return { id: row.id, integration_id: row.integration_id, publish_at_us: time, held: stopped };
  });
  if (toybacoPreparationHash([receiptData(current), inventory, targets]) !== request.inventoryHash) {
    throw new ForbiddenException('接続先が変わりました。選択を確認してください。');
  }
}

export async function toybacoPreparePostingRelease(database: any, orgId: string, value: any) {
  const request = toybacoPreparationRequest(orgId, value);
  await database.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
  const [isolation] = await database.$queryRawUnsafe("SELECT current_setting('transaction_isolation') AS isolation");
  if (isolation?.isolation !== 'read committed') throw new ForbiddenException('準備処理の実行環境を確認できません。');
  await toybacoRetentionLock(database, orgId, true);
  const where = { organizationId_requestId: { organizationId: orgId, requestId: request.requestId } };
  const existing = await database.toybacoPostingPreparation.findUnique({ where });
  const now = Date.now();
  if (existing) return preparationReceipt(existing, request, now); // History only, never reactivates a pointer.
  await preparationSnapshot(database, request);
  const payloadHash = toybacoPreparationHash(request);
  const outcome = { version: 2, organizationId: orgId, requestId: request.requestId, payloadHash,
    preparedAt: now, state: 'prepared', execute: false };
  const receipt = { ...outcome, receiptHash: toybacoPreparationHash(outcome) };
  const row = await database.toybacoPostingPreparation.create({ data: { organizationId: orgId,
    requestId: request.requestId, payloadHash, request, receiptHash: receipt.receiptHash, receipt, createdAt: new Date(now) } });
  return preparationReceipt(row, request, now);
}

// Internal snapshot primitive. Call only inside a dedicated transaction after
// locking and authorizing the current business rows; these epochs grant no rights.
export async function toybacoPostingIdentityEpochs(database: any, subjects: unknown) {
  const kinds = ['Integration', 'Organization', 'User', 'UserOrganization'];
  if (!Array.isArray(subjects) || !subjects.length || subjects.length > LIMIT + 3 ||
      subjects.some(item => !item || Object.keys(item).sort().join('|') !== 'entityId|kind' ||
        !kinds.includes(item.kind) || !validId(item.entityId)) || database.$transaction !== undefined) {
    throw new ForbiddenException('投稿の本人・接続世代を確認できません。');
  }
  const requested = subjects.map(item => ({ kind: item.kind, entityId: item.entityId }))
    .sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
  if (new Set(requested.map(item => `${item.kind}:${item.entityId}`)).size !== requested.length) {
    throw new ForbiddenException('投稿の本人・接続世代を確認できません。');
  }
  const [isolation] = await database.$queryRawUnsafe("SELECT current_setting('transaction_isolation') AS isolation");
  if (isolation?.isolation !== 'read committed') throw new ForbiddenException('最新の投稿状態でやり直してください。');
  await database.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
  const rows = await database.$queryRawUnsafe(`SELECT e.kind, e."entityId", e.generation::text AS generation, e.epoch::text AS epoch
    FROM public."ToybacoPostingIdentityEpoch" e
    JOIN unnest($1::text[], $2::text[]) AS requested(kind, entity_id) ON e.kind=requested.kind AND e."entityId"=requested.entity_id
    ORDER BY e.kind COLLATE "C", e."entityId" COLLATE "C" FOR UPDATE OF e NOWAIT`,
    requested.map(item => item.kind), requested.map(item => item.entityId));
  if (rows.length !== requested.length || rows.some((row: any, index: number) => row.kind !== requested[index].kind ||
      row.entityId !== requested[index].entityId || typeof row.generation !== 'string' || typeof row.epoch !== 'string' || !/^[1-9][0-9]{0,18}$/.test(row.generation) ||
      BigInt(row.generation) >= BigInt('9223372036854775807') || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.epoch))) {
    throw new ForbiddenException('投稿の本人・接続世代の再確認が必要です。');
  }
  const identities = rows.map((row: any) => ({ kind: row.kind, entityId: row.entityId, generation: row.generation, epoch: row.epoch }));
  return { version: 1, identities, identityHash: toybacoPreparationHash(identities), execute: false };
}
