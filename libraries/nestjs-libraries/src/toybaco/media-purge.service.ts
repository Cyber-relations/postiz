import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  TOYBACO_MEDIA_PURGE_DELETE_REFUSED_LOG,
  TOYBACO_MEDIA_PURGE_GRACE_MS,
  TOYBACO_MEDIA_PURGE_OBJECT_LIMIT,
  TOYBACO_MEDIA_PURGE_SCAN_LIMIT,
  ToybacoMediaPurgeCursor,
  ToybacoMediaPurgeResult,
  toybacoMediaObjectKey,
  toybacoMediaPurgeDeleteRequested,
  toybacoMediaPurgeDryRun,
  toybacoMediaPurgeLogLine,
} from '@gitroom/nestjs-libraries/toybaco/media-purge';

// toybaco_media_purge_v1: 論理削除から 30 日を過ぎ、どこからも参照されていないメディアの S3 object を消す。
// 参照の判定は保守的にする。DB の全 table の文字列・JSON 列を見て、media の id か object key を含む行があれば消さない
// (deletedAt を持つ table は削除されていない行、Media は削除されていないか 30 日以内に削除した行だけを参照に数える)。
// 判定の読み取りに 1 つでも失敗したら、その回は何も消さない。log には件数だけを出し、key や URL は出さない。

export type ToybacoMediaStore = {
  // 既に無い(削除マーカーを含む)なら null。権限やネットワークの失敗は throw する。
  head(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
};

type ModelField = { name: string; dbName?: string | null; kind: string; type: string; isList?: boolean };
type Model = { name: string; dbName?: string | null; fields: ModelField[] };
type MediaRow = { id: string; path: string; thumbnail: string | null; deletedAt: Date | string | null };

type PurgeDeps = {
  prisma: {
    media: { findMany(args: unknown): Promise<MediaRow[]> };
    $queryRawUnsafe(sql: string, ...values: unknown[]): Promise<Array<{ term: string; id?: string }>>;
  };
  store: ToybacoMediaStore | null;
  env: Record<string, string | undefined>;
  nowMs: number;
  cursor: ToybacoMediaPurgeCursor | null;
  models: Model[] | null | undefined;
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MEDIA_ID = /^[A-Za-z0-9-]{8,64}$/;

// AWS S3(task role の認証)だけを扱う。bucket の公開 URL が bucket 名と region から決まる形と一致しなければ扱わない。
export function toybacoMediaS3Store(env: Record<string, string | undefined>): ToybacoMediaStore | null {
  const bucket = env.CLOUDFLARE_BUCKETNAME || '';
  const region = env.S3_REGION || env.CLOUDFLARE_REGION || '';
  const endpoint = env.S3_ENDPOINT || '';
  if (
    env.STORAGE_PROVIDER !== 'cloudflare' ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !/^[a-z]{2}-[a-z]+-\d$/.test(region) ||
    endpoint !== `https://s3.${region}.amazonaws.com` ||
    env.CLOUDFLARE_BUCKET_URL !== `https://${bucket}.s3.${region}.amazonaws.com`
  ) {
    return null;
  }
  const client = new S3Client({ endpoint, region, requestChecksumCalculation: 'WHEN_REQUIRED' });
  return {
    async head(key: string) {
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const size = Number(response.ContentLength);
        return Number.isFinite(size) && size >= 0 ? size : 0;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        const name = (err as { name?: string })?.name;
        if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async delete(key: string) {
      // versioning の bucket では削除マーカーが付き、旧版は bucket の lifecycle が消す。
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

// terms(media id と object key)のうち、どこかの table の生きている行に含まれるものを返す。行の中身は DB の外に出さない。
export async function toybacoMediaReferencedTerms(
  prisma: PurgeDeps['prisma'],
  models: Model[] | null | undefined,
  terms: string[],
  cutoff: Date
) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('ReferenceSchemaUnavailable');
  }
  const found = new Set<string>();
  for (const model of models) {
    const remaining = terms.filter((term) => !found.has(term));
    if (remaining.length === 0) break;
    const table = model.dbName || model.name;
    const columns = model.fields
      .filter((field) => field.kind === 'scalar' && !field.isList && (field.type === 'String' || field.type === 'Json'))
      .map((field) => field.dbName || field.name);
    if (columns.length === 0) continue;
    if (!IDENTIFIER.test(table) || !columns.every((column) => IDENTIFIER.test(column))) {
      throw new Error('ReferenceSchemaUnreadable');
    }
    const deletedAt = model.fields.find(
      (field) => field.name === 'deletedAt' && field.kind === 'scalar' && field.type === 'DateTime'
    );
    const deletedColumn = deletedAt ? deletedAt.dbName || deletedAt.name : null;
    if (deletedColumn && !IDENTIFIER.test(deletedColumn)) {
      throw new Error('ReferenceSchemaUnreadable');
    }
    const isMedia = model.name === 'Media';
    const live = isMedia
      ? `(m."${deletedColumn}" IS NULL OR m."${deletedColumn}" > $2)`
      : deletedColumn
      ? `m."${deletedColumn}" IS NULL`
      : 'TRUE';
    const match = columns.map((column) => `strpos(m."${column}"::text, t.term) > 0`).join(' OR ');
    const sql =
      `SELECT t.term AS term FROM unnest($1::text[]) AS t(term) ` +
      `WHERE EXISTS (SELECT 1 FROM "${table}" m WHERE ${live} AND (${match}))`;
    const rows = isMedia
      ? await prisma.$queryRawUnsafe(sql, remaining, cutoff)
      : await prisma.$queryRawUnsafe(sql, remaining);
    for (const row of rows) {
      if (typeof row?.term === 'string') found.add(row.term);
    }
  }
  return found;
}

function emptyResult(dryRun: boolean, next: ToybacoMediaPurgeCursor | null): ToybacoMediaPurgeResult {
  return { dryRun, scanned: 0, candidates: 0, bytes: 0, deleted: 0, failed: 0, referenced: 0, absent: 0, unreadable: 0, next };
}

function cursorOf(row: MediaRow): ToybacoMediaPurgeCursor {
  return { deletedAtMs: new Date(row.deletedAt as Date).getTime(), id: row.id };
}

export async function toybacoPurgeDeletedMedia(deps: PurgeDeps): Promise<ToybacoMediaPurgeResult> {
  const { prisma, store, env, nowMs, cursor, models } = deps;
  const dryRun = toybacoMediaPurgeDryRun(env.TOYBACO_MEDIA_PURGE_MODE);
  if (dryRun && toybacoMediaPurgeDeleteRequested(env.TOYBACO_MEDIA_PURGE_MODE)) {
    // 参照の競合を閉じるまで delete にしない(media-purge.ts の TOYBACO_MEDIA_PURGE_DELETE_ENABLED)。
    console.log(TOYBACO_MEDIA_PURGE_DELETE_REFUSED_LOG);
  }
  const bucketUrl = env.CLOUDFLARE_BUCKET_URL;
  if (!store || !bucketUrl) {
    console.log('toybaco_media_purge event=unavailable');
    return emptyResult(dryRun, cursor);
  }
  const result = emptyResult(dryRun, null);
  const cutoff = new Date(nowMs - TOYBACO_MEDIA_PURGE_GRACE_MS);
  const after = cursor ? new Date(cursor.deletedAtMs) : null;
  const rows = await prisma.media.findMany({
    where: {
      deletedAt: { not: null, lte: cutoff },
      ...(after
        ? { OR: [{ deletedAt: { gt: after } }, { deletedAt: after, id: { gt: cursor!.id } }] }
        : {}),
    },
    orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
    take: TOYBACO_MEDIA_PURGE_SCAN_LIMIT,
    select: { id: true, path: true, thumbnail: true, deletedAt: true },
  });

  // 1. 既に無い object を除き、残っている object を上限まで集める。
  const pending: Array<{ row: MediaRow; objects: Array<{ key: string; bytes: number }> }> = [];
  let pendingObjects = 0;
  let last: MediaRow | null = null;
  for (const row of rows) {
    if (pendingObjects >= TOYBACO_MEDIA_PURGE_OBJECT_LIMIT) break;
    last = row;
    result.scanned += 1;
    const keys: string[] = [];
    const main = toybacoMediaObjectKey(row.path, bucketUrl);
    const thumbnail = row.thumbnail ? toybacoMediaObjectKey(row.thumbnail, bucketUrl) : null;
    if (!main || (row.thumbnail && !thumbnail) || !MEDIA_ID.test(row.id) || !row.deletedAt) {
      result.unreadable += 1;
      continue;
    }
    keys.push(main);
    if (thumbnail && thumbnail !== main) keys.push(thumbnail);
    const objects: Array<{ key: string; bytes: number }> = [];
    let readable = true;
    for (const key of keys) {
      try {
        const size = await store.head(key);
        if (size === null) {
          result.absent += 1;
        } else {
          objects.push({ key, bytes: size });
        }
      } catch (err) {
        readable = false;
        break;
      }
    }
    if (!readable) {
      result.unreadable += 1;
      continue;
    }
    if (objects.length) {
      pending.push({ row, objects });
      pendingObjects += objects.length;
    }
  }
  // 上限で途中まで、または読み切れない数の行があったなら続きから。全部を見終えたら次は先頭から回り直す
  // (参照されていたものも、参照が消えた後の周回で拾う)。
  const examinedAll = result.scanned === rows.length;
  const next =
    last && (!examinedAll || rows.length === TOYBACO_MEDIA_PURGE_SCAN_LIMIT) ? cursorOf(last) : null;

  // 2. 参照の判定。同じ object を指す Media 行(この回の外の行も含む)の id も検索語にし、どれか 1 つでも
  //    参照されていればその object は消さない。読めなければ何も消さず、同じ位置から次回やり直す。
  const objects = new Map<string, number>();
  const owners = new Map<string, Set<string>>();
  for (const { row, objects: rowObjects } of pending) {
    for (const object of rowObjects) {
      objects.set(object.key, object.bytes);
      owners.set(object.key, (owners.get(object.key) || new Set<string>()).add(row.id));
    }
  }
  let referenced: Set<string>;
  try {
    if (objects.size) {
      const siblings = await prisma.$queryRawUnsafe(
        `SELECT t.term AS term, m."id" AS id FROM unnest($1::text[]) AS t(term) ` +
          `JOIN "Media" m ON strpos(m."path", t.term) > 0 OR strpos(coalesce(m."thumbnail", ''), t.term) > 0`,
        [...objects.keys()]
      );
      for (const sibling of siblings as Array<{ term: string; id?: string }>) {
        if (!owners.has(sibling.term) || typeof sibling.id !== 'string' || !MEDIA_ID.test(sibling.id)) {
          throw new Error('ReferenceOwnerUnreadable');
        }
        owners.get(sibling.term)!.add(sibling.id);
      }
    }
    const terms = [...new Set([...objects.keys(), ...[...owners.values()].flatMap((ids) => [...ids])])];
    referenced = terms.length ? await toybacoMediaReferencedTerms(prisma, models, terms, cutoff) : new Set();
  } catch (err) {
    console.error('toybaco_media_purge event=reference_check_failed');
    return { ...result, unreadable: result.unreadable + pending.length, next: cursor };
  }

  // 3. 参照の無い object だけを、1 回ずつ数える(dry-run)か消す。
  for (const [key, bytes] of objects) {
    if (referenced.has(key) || [...owners.get(key)!].some((id) => referenced.has(id))) {
      result.referenced += 1;
      continue;
    }
    if (dryRun) {
      result.candidates += 1;
      result.bytes += bytes;
      continue;
    }
    try {
      await store.delete(key);
      result.deleted += 1;
      result.bytes += bytes;
    } catch (err) {
      result.failed += 1;
    }
  }
  result.next = next;
  console.log(toybacoMediaPurgeLogLine(result));
  return result;
}
