// toybaco_media_purge_v1: 論理削除したメディアの S3 object を消す(PZ-9)。
// workflow の bundle からも読むため、外部 import と時計の直接参照を持たない純関数と定数だけを置く。
// 値を変えると走行中の V1 workflow の再生結果が変わるため、変更時は V2 を別名で足す。

const DAY_MS = 24 * 60 * 60 * 1000;

export const TOYBACO_MEDIA_PURGE_WORKFLOW_V1 = 'toybacoMediaPurgeWorkflowV1';
export const TOYBACO_MEDIA_PURGE_WORKFLOW_V1_ID = 'toybaco-media-purge-workflow-v1';
// 1 日 1 回。30 回(約 30 日)ごとに continueAsNew する。1 回あたり約 10 event。
export const TOYBACO_MEDIA_PURGE_INTERVAL_MS = DAY_MS;
export const TOYBACO_MEDIA_PURGE_RUNS_PER_HISTORY = 30;
// 論理削除からこの期間を過ぎたものだけを対象にする。
export const TOYBACO_MEDIA_PURGE_GRACE_MS = 30 * DAY_MS;
// 1 回に読む Media 行と、1 回に消す(dry-run では数える)object の上限。
export const TOYBACO_MEDIA_PURGE_SCAN_LIMIT = 200;
export const TOYBACO_MEDIA_PURGE_OBJECT_LIMIT = 50;

// 実削除は、参照の検索と S3 の削除の間の競合を閉じるまで、どの値でも行わない。参照を数えた後、消す前に
// 同じ media の id・URL を使う投稿が保存されると、その参照を見落として使用中の object を消す(投稿の保存は
// image を JSON で書くだけで、purge と共通の lock も、削除の対象を使わせない印も無い)。delete を有効にする
// 変更では、削除の対象の claim と参照の作成を DB の lock か状態で排他にし、claim した media への新しい参照を
// 拒んでから、この値を true にする(試験も一緒に変える)。
export const TOYBACO_MEDIA_PURGE_DELETE_ENABLED = false;

// env が delete を求めたか(拒んだことを log に 1 行出すため)。前後の空白と大文字小文字は問わない。
export function toybacoMediaPurgeDeleteRequested(mode: string | null | undefined) {
  return String(mode ?? '').trim().toLowerCase() === 'delete';
}

// 既定は dry-run。delete は TOYBACO_MEDIA_PURGE_DELETE_ENABLED が true になるまで受けない。
export function toybacoMediaPurgeDryRun(mode: string | null | undefined) {
  return !(TOYBACO_MEDIA_PURGE_DELETE_ENABLED && mode === 'delete');
}

// delete を求められたが拒んだ時の固定語の log。
export const TOYBACO_MEDIA_PURGE_DELETE_REFUSED_LOG = 'toybaco_media_purge event=delete_refused reason=reference_race';

// upload 側(r2.uploader.ts / cloudflare.storage.ts)は bucket の直下に「乱数 + 拡張子」で置く。
// その形の key だけを扱い、別の host・階層・query・符号化を含む path は読めないものとして消さない。
const OBJECT_KEY = /^[A-Za-z0-9]{8,64}\.[a-z0-9]{2,5}$/;

export function toybacoMediaObjectKey(
  path: string | null | undefined,
  bucketUrl: string | null | undefined
) {
  if (typeof path !== 'string' || typeof bucketUrl !== 'string' || !bucketUrl) return null;
  const base = bucketUrl.replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(base) || !path.startsWith(base + '/')) return null;
  const key = path.slice(base.length + 1);
  return OBJECT_KEY.test(key) ? key : null;
}

export type ToybacoMediaPurgeCursor = { deletedAtMs: number; id: string };

export type ToybacoMediaPurgeResult = {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  bytes: number;
  deleted: number;
  failed: number;
  referenced: number;
  absent: number;
  unreadable: number;
  next: ToybacoMediaPurgeCursor | null;
};

// 固定語の log。dry-run は件数と bytes の合計だけを出す。
export function toybacoMediaPurgeLogLine(result: ToybacoMediaPurgeResult) {
  return result.dryRun
    ? `toybaco_media_purge dry_run=true candidates=${result.candidates} bytes=${result.bytes}`
    : `toybaco_media_purge dry_run=false deleted=${result.deleted} bytes=${result.bytes} failed=${result.failed}`;
}
