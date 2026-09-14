'use client';

import { FC, useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { ContinueProviderProps } from '../with-continue-provider';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';

interface GmbItem {
  id: string;
  name: string;
  accountName: string;
  locationName: string;
  picture?: { data?: { url?: string } };
}

const LOOKUP_MESSAGES = {
  'access-not-ready': {
    title: 'Google との接続準備が完了していません',
    description: 'Google 側の API 利用設定により、店舗一覧を取得できません。トイバコの運営側で設定を確認する必要があります。連携を削除したり、Google にログインし直す必要はありません。',
  },
  'rate-limited': {
    title: 'Google へのアクセスが一時的に制限されています',
    description: '時間をおいてから店舗一覧を再取得してください。連携の削除や Google への再ログインは不要です。',
  },
  reauthenticate: {
    title: 'Google への接続を確認してください',
    description: 'Google が現在の接続情報を受け付けませんでした。チャンネル追加から Google アカウントを選び直せます。既存の連携を削除する必要はありません。',
  },
  'permission-denied': {
    title: '店舗一覧へのアクセスが許可されませんでした',
    description: 'Google ビジネスプロフィールの管理権限と接続許可をご確認ください。別の Google アカウントを使う場合は、チャンネル追加から選び直せます。',
  },
  unavailable: {
    title: '店舗一覧を取得できませんでした',
    description: '通信状況を確認して、もう一度お試しください。Google との連携は保持されています。',
  },
};
type LookupReason = keyof typeof LOOKUP_MESSAGES;
const safeReason = (value: any): LookupReason => typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(LOOKUP_MESSAGES, value) ? value as LookupReason : 'unavailable';
interface GmbLookupResult { locations: GmbItem[]; warnings: LookupReason[]; existingIds?: string[] }
function readLookup(data: any): GmbLookupResult {
  return { locations: readLocations(data?.locations), warnings: Array.isArray(data?.warnings)
    ? [...new Set<LookupReason>(data.warnings.map(safeReason))] : [] };
}

class GmbLookupError extends Error {
  constructor(readonly reason: LookupReason) { super(reason); }
}

export async function readGmbResponse(response: Response) {
  let body: any;
  try { body = await response.json(); } catch { throw new GmbLookupError('unavailable'); }
  if (!response.ok) {
    const reason = body?.error === 'TOYBACO_GBP_LOOKUP_FAILED' &&
      typeof body.reason === 'string' && Object.prototype.hasOwnProperty.call(LOOKUP_MESSAGES, body.reason)
      ? body.reason as LookupReason : 'unavailable';
    throw new GmbLookupError(reason);
  }
  return body;
}

function readLocations(data: any): GmbItem[] {
  if (!Array.isArray(data) || data.some(item => !item ||
    typeof item.id !== 'string' || typeof item.name !== 'string' ||
    typeof item.accountName !== 'string' || typeof item.locationName !== 'string')) {
    throw new GmbLookupError('unavailable');
  }
  return data;
}

export const GmbContinue: FC<ContinueProviderProps & {
  onClose?: () => void;
  initialError?: unknown;
  initialWarnings?: string[];
  allowLookup?: boolean;
  checkExisting?: boolean;
  returnToAppUrl?: string;
}> = ({
  onSave, existingId, initialData, isSaving: externalSaving, onClose,
  initialError, initialWarnings, allowLookup = true, checkExisting = false, returnToAppUrl,
}) => {
  const { integration } = useIntegration();
  const fetch = useFetch();
  const addProvider = useAddProvider();
  const [selection, setSelection] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(new Set<symbol>());
  const initialRef = useRef({ id: integration?.id, used: false });
  if (initialRef.current.id !== integration?.id) initialRef.current = { id: integration?.id, used: false };
  const load = useCallback(async () => {
    const withExisting = async (result: GmbLookupResult): Promise<GmbLookupResult> => {
      if (!checkExisting || !result.locations.length) return result;
      const response = await fetch('/integrations/list');
      const existing = await readGmbResponse(response);
      if (!Array.isArray(existing?.integrations)) throw new GmbLookupError('unavailable');
      return { ...result, existingIds: existing.integrations
        .filter((item: any) => item?.inBetweenSteps === false && typeof item.internalId === 'string')
        .map((item: any) => item.internalId) };
    };
    if (!initialRef.current.used && initialData !== undefined) {
      initialRef.current.used = true;
      if (initialError) throw new GmbLookupError(safeReason((initialError as any)?.reason));
      return withExisting(readLookup({ locations: initialData, warnings: initialWarnings }));
    }
    if (!allowLookup) throw new GmbLookupError('unavailable');
    const response = await fetch('/integrations/function', {
      method: 'POST', body: JSON.stringify({ name: 'toybacoLocations', id: integration?.id }),
    });
    return withExisting(readLookup(await readGmbResponse(response)));
  }, [allowLookup, checkExisting, fetch, initialData, initialError, initialWarnings, integration?.id]);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    integration?.id || initialData ? ['toybaco-gmb-locations', integration?.id || 'preview'] : null,
    load,
    { revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0,
      shouldRetryOnError: false, revalidateIfStale: false, revalidateOnMount: true }
  );
  const available = useMemo(() => (data?.locations || []).filter(item => !existingId.includes(item.id) && !data?.existingIds?.includes(item.id)), [data, existingId]);
  const currentError = saveError || error;
  const message = currentError instanceof GmbLookupError ? LOOKUP_MESSAGES[currentError.reason] : LOOKUP_MESSAGES.unavailable;
  const busy = saving || !!externalSaving;
  const loading = isLoading || isValidating;
  const empty = !!data && data.locations.length === 0;
  const allConnected = !!data?.locations.length && available.length === 0;
  const canChooseAccount = !currentError || (currentError instanceof GmbLookupError &&
    ['reauthenticate', 'permission-denied'].includes(currentError.reason));
  const selected = available.find(item => item.id === selection);

  const retry = async () => {
    if (loading || busy) return;
    setSaveError(null);
    setSelection(null);
    try { await mutate(); } catch { /* SWR owns the safe lookup error state. */ }
  };
  const save = async () => {
    if (!selected || savingRef.current.size > 0 || externalSaving || loading || error) return;
    const saveTicket = Symbol();
    savingRef.current.add(saveTicket);
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ id: selected.id, accountName: selected.accountName, locationName: selected.locationName });
    } catch (failure) { setSaveError(failure); }
    finally { savingRef.current.delete(saveTicket); setSaving(false); }
  };
  const backToAdd = () => {
    if (busy) return;
    onClose?.();
    void addProvider();
  };

  return (
    <section className="flex flex-col gap-6 text-textColor" data-toybaco-gbp-selection="" aria-busy={busy || loading}>
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-wide text-textColor/60">Google ビジネスプロフィール</span>
        <h2 className="text-xl font-semibold">連携する店舗を選ぶ</h2>
        <p className="text-sm leading-6 text-textColor/70">Google アカウントとの連携を保存しました。店舗を選ぶと、投稿や分析を利用できます。</p>
      </header>
      {!!data?.warnings.length && !currentError && !loading && <div role="status" className="rounded-xl border border-input bg-sixth p-4 text-sm leading-6">
        <p>一部の Google アカウントから店舗を取得できませんでした。表示されている店舗は選択できます。</p>
        {data.warnings.map(reason => <p key={reason} className="mt-2">{LOOKUP_MESSAGES[reason].description}</p>)}
      </div>}
      {!!currentError && !loading && (
        <div role="alert" className="rounded-xl border border-input bg-sixth p-5 flex flex-col gap-2">
          <h3 className="text-base font-semibold">{message.title}</h3>
          <p className="text-sm leading-6 text-textColor/70">{message.description}</p>
          {!!saveError && <p className="text-sm leading-6">店舗の設定は完了していません。選択内容と連携は保持されています。</p>}
        </div>
      )}
      {loading ? (
        <div role="status" className="rounded-xl border border-input p-6 text-sm leading-6">Google から店舗一覧を取得しています…</div>
      ) : error ? null : empty || allConnected ? (
        <div role="status" className="rounded-xl border border-input bg-sixth p-5 flex flex-col gap-2">
          <h3 className="text-base font-semibold">{allConnected ? '取得した店舗はすべて連携済みです' : 'この Google アカウントに店舗が見つかりませんでした'}</h3>
          <p className="text-sm leading-6 text-textColor/70">{allConnected
            ? '表示された店舗は連携済みです。画面を閉じて既存の店舗を利用するか、別の店舗を追加する場合は一覧を再取得してください。'
            : 'Google ビジネスプロフィールに店舗が登録されているか、このアカウントに管理権限があるかをご確認ください。別の Google アカウントも選び直せます。'}</p>
        </div>
      ) : (
        <div role="radiogroup" aria-label="連携する店舗" className="flex flex-col gap-2 max-h-[360px] overflow-y-auto">
          {available.map(item => (
            <button key={item.id} type="button" role="radio" aria-checked={selection === item.id}
              disabled={busy} onClick={() => { setSelection(item.id); setSaveError(null); }}
              className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left min-h-[72px] transition-colors ${selection === item.id ? 'border-primary bg-seventh' : 'border-input hover:bg-sixth'}`}>
              {item.picture?.data?.url ? <img src={item.picture.data.url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                : <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-input"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg></span>}
              <span className="flex-1 text-sm font-medium break-words">{item.name}</span>
              <span aria-hidden="true" className={`h-4 w-4 shrink-0 rounded-full border ${selection === item.id ? 'border-primary bg-primary' : 'border-input'}`} />
            </button>
          ))}
        </div>
      )}
      <footer className="flex flex-col gap-3 border-t border-input pt-4">
        {!loading && !error && available.length > 0 && (
          <button type="button" disabled={!selected || busy} onClick={() => void save()}
            className="min-h-[44px] rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? '店舗を設定しています…' : 'この店舗を連携する'}
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          {allowLookup && <button type="button" disabled={loading || busy} onClick={() => void retry()}
            className="min-h-[44px] rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50">店舗一覧を再取得</button>}
          {onClose && <button type="button" disabled={busy} onClick={onClose}
            className="min-h-[44px] rounded-lg px-4 py-2 text-sm">{allConnected ? '閉じる' : '後で設定する'}</button>}
        </div>
        {!allowLookup && returnToAppUrl && <a href={returnToAppUrl} className="min-h-[44px] rounded-lg border border-input px-4 py-3 text-center text-sm">トイバコへ戻って設定を続ける</a>}
        {allowLookup && canChooseAccount && onClose && <button type="button" disabled={busy} onClick={backToAdd}
          className="min-h-[44px] text-left text-sm underline underline-offset-4">別の Google アカウントを使う：チャンネル追加に戻る</button>}
      </footer>
    </section>
  );
};
