'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { toybacoPostingSnapshot, toybacoPostingServerSnapshot, toybacoSubscribePosting, toybacoPostingDocumentId } from '@gitroom/frontend/components/layout/toybaco.posting.context';

type Mode = 'checking' | 'shared' | 'legacy' | 'unavailable';
type Policy = { mode: Mode; binding: string; initialOpen: boolean; isCurrent: () => boolean };
const DraftContext = createContext<Policy>({ mode: 'checking', binding: '', initialOpen: false, isCurrent: () => false });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Result = { id: number; editor_id: string; draft_digest: string; state: string; current: boolean; error_code?: string; content?: string; needs_review?: boolean };
type State = { available: boolean; remaining: number; store_info_required: boolean; result: Result | null };
type Operation = { nonce: string; draft: string; instruction: string; original: string; digest: string; id?: number };
type Fetcher = ReturnType<typeof useFetch>;

async function readJson(request: Fetcher, url: string, body: unknown, controllers: Set<AbortController>) {
  const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await request(url, { signal: controller.signal, cache: 'no-store',
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('unavailable');
    const value = await response.json();
    if (controller.signal.aborted) throw new Error('expired');
    return value;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}

export function toybacoDraftState(value: any, editorId: string): State {
  if (!value || typeof value.available !== 'boolean' || typeof value.store_info_required !== 'boolean' ||
      !Number.isSafeInteger(value.remaining) || value.remaining < 0 || !Object.prototype.hasOwnProperty.call(value, 'result')) throw new Error('invalid_state');
  const result = value.result;
  if (result !== null && (!result || !Number.isSafeInteger(result.id) || result.id <= 0 || result.editor_id !== editorId ||
      !UUID.test(result.editor_id) || !/^[0-9a-f]{64}$/.test(result.draft_digest) || typeof result.current !== 'boolean' ||
      !['queued', 'running', 'completed', 'failed'].includes(result.state) ||
      (result.content !== undefined && (typeof result.content !== 'string' || [...result.content].length > 500 ||
      !result.content.trim() || typeof result.needs_review !== 'boolean')))) throw new Error('invalid_result');
  return value;
}

export function toybacoDraftHtml(content: string) {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return '<p>' + escaped.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>') + '</p>';
}

export function ToybacoPostingDraftProvider({ children, initialOpen = false }: { children: React.ReactNode; initialOpen?: boolean }) {
  const request = useFetch(); const user = useUser();
  const provider = user?.providerName;
  const posting = useSyncExternalStore(toybacoSubscribePosting, toybacoPostingSnapshot, toybacoPostingServerSnapshot);
  const binding = [posting.generation, posting.documentId, posting.owner?.id, posting.owner?.orgId, posting.context?.accountId].join(':');
  const [policy, setPolicy] = useState<{ binding: string; mode: Mode }>({ binding: '', mode: 'checking' });
  const requestRef = useRef(request); requestRef.current = request;
  const current = useCallback(() => {
    const now = toybacoPostingSnapshot();
    return now.phase === 'ready' && [now.generation, now.documentId, now.owner?.id, now.owner?.orgId, now.context?.accountId].join(':') === binding;
  }, [binding]);
  useEffect(() => {
    if (provider && provider !== 'GENERIC') { setPolicy({ binding, mode: 'legacy' }); return; }
    if (!current()) return;
    const controllers = new Set<AbortController>(); let active = true;
    setPolicy({ binding, mode: 'checking' });
    readJson(requestRef.current, '/toybaco/post-drafts/policy', undefined, controllers).then(value => {
      if (!active || !current()) return;
      if (typeof value?.shared !== 'boolean' || value.organization_id !== posting.owner?.orgId || !Number.isSafeInteger(value.account_id) || value.account_id <= 0 ||
          (posting.context?.accountId && String(value.account_id) !== posting.context.accountId)) throw new Error('store_changed');
      setPolicy({ binding, mode: value.shared ? 'shared' : 'legacy' });
    }).catch(() => { if (active && current()) setPolicy({ binding, mode: 'unavailable' }); });
    return () => { active = false; controllers.forEach(controller => controller.abort()); };
  }, [binding, current, posting.phase, posting.owner?.orgId, posting.context?.accountId, provider]);
  const mode = policy.binding === binding && (posting.phase === 'ready' || user?.providerName !== 'GENERIC') ? policy.mode : 'checking';
  return <DraftContext.Provider value={{ mode, binding, initialOpen, isCurrent: current }}>{children}</DraftContext.Provider>;
}

export function ToybacoLegacyPostingAi({ children }: { children: React.ReactNode }) {
  const context = useContext(DraftContext);
  return context.mode === 'legacy' ? <>{children}</> : null;
}

type EditorProps = { value: string; plainText: string; slotKey: string; first: boolean; apply: (html: string) => string | undefined };
export function ToybacoPostingDraft(props: EditorProps) {
  const context = useContext(DraftContext);
  if (context.mode === 'legacy') return null;
  return <PostingDraftSession key={context.binding + ':' + props.slotKey} {...props} context={context} />;
}

function PostingDraftSession(props: EditorProps & { context: Policy }) {
  const { mode, isCurrent } = props.context;
  const request = useFetch(); const latest = useRef(props); latest.current = props;
  const requestRef = useRef(request); requestRef.current = request;
  const [editorId] = useState(toybacoPostingDocumentId);
  const [open, setOpen] = useState(props.first && props.context.initialOpen);
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [adopted, setAdopted] = useState<string | null>(null);
  const operation = useRef<Operation | null>(null);
  const active = useRef(true); const epoch = useRef(0); const working = useRef(false); const controllers = useRef(new Set<AbortController>());
  const startedAt = useRef(0);
  const alive = useCallback(() => active.current && latest.current.context.isCurrent() && latest.current.context.mode === 'shared', []);
  useEffect(() => { active.current = true; const requests = controllers.current; return () => { active.current = false; epoch.current += 1; working.current = false; requests.forEach(controller => controller.abort()); }; }, []);
  const send = useCallback(async (body: Record<string, unknown>) => {
    const lifetime = epoch.current;
    if (!alive() || lifetime !== epoch.current) throw new Error('context_changed');
    const value = await readJson(requestRef.current, '/toybaco/post-drafts', { ...body, editor_id: editorId }, controllers.current);
    if (!alive() || lifetime !== epoch.current) throw new Error('context_changed');
    const next = toybacoDraftState(value, editorId);
    if (next.result && operation.current && (next.result.draft_digest !== operation.current.digest ||
        (operation.current.id && next.result.id !== operation.current.id))) throw new Error('result_changed');
    if (next.result && operation.current) operation.current.id = next.result.id;
    const unconfirmed = !!operation.current && next.result === null;
    setState(next); setUnknown(unconfirmed); setMessage(unconfirmed ? '受付を確認できません。同じ操作で再試行できます。' : ''); return next;
  }, [alive, editorId]);
  const finish = useCallback((lifetime: number) => {
    if (lifetime === epoch.current) { working.current = false; if (active.current) setBusy(false); }
  }, []);
  const action = useCallback(async (run: (lifetime: number) => Promise<void>) => {
    if (working.current || !alive()) return;
    working.current = true; setBusy(true);
    const lifetime = epoch.current;
    try { await run(lifetime); } catch { if (alive() && lifetime === epoch.current) { setUnknown(true); setMessage('状態を確認できません。入力は残っています。'); } }
    finally { finish(lifetime); }
  }, [alive, finish]);
  const refresh = useCallback(() => action(async () => { await send({ action: 'state', request_id: operation.current?.id || null }); }), [action, send]);
  useEffect(() => { if (open && mode === 'shared' && isCurrent()) void refresh(); }, [open, mode, isCurrent, refresh]);
  const pending = state?.result && ['queued', 'running'].includes(state.result.state);
  useEffect(() => {
    if (!pending || unknown || busy || !alive()) return;
    if (Date.now() - startedAt.current > 300000) { setUnknown(true); setMessage('作成状況を確認してください。'); return; }
    const timer = setTimeout(() => { void refresh(); }, 3000);
    return () => clearTimeout(timer);
  }, [pending, busy, unknown, props.context.mode, alive, refresh]);
  function start(text: string, retry = false) {
    void action(async lifetime => {
      if (!retry) {
        if (pending || unknown || !state?.available || state.remaining < 1) return;
        const original = latest.current.value; const draft = latest.current.plainText;
        if (!(draft.trim() || text.trim()) || draft.length > 4000 || text.length > 1000) return;
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(draft));
        if (!alive() || lifetime !== epoch.current) return;
        if (latest.current.value !== original) { setMessage('本文が変わりました。もう一度作成してください。'); return; }
        operation.current = { nonce: toybacoPostingDocumentId(), draft, instruction: text, original,
          digest: Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('') };
        setAdopted(null); startedAt.current = Date.now();
      }
      const item = operation.current; if (!item) return;
      await send({ action: 'start', nonce: item.nonce, draft: item.draft, instruction: item.instruction });
    });
  }
  function cancel() {
    void action(async () => {
      const next = await send({ action: 'state', request_id: operation.current?.id || null });
      if (next.result && ['queued', 'running'].includes(next.result.state)) await send({ action: 'cancel', request_id: next.result.id });
    });
  }
  function adopt() {
    void action(async () => {
      const item = operation.current; if (!item?.id) return;
      const next = await send({ action: 'state', request_id: item.id });
      if (!alive() || next.result?.state !== 'completed' || !next.result.current || !next.result.content || latest.current.value !== item.original) {
        setMessage('本文が変わりました。文案を確認して、必要な部分をコピーしてください。'); return;
      }
      const applied = latest.current.apply(toybacoDraftHtml(next.result.content));
      if (applied !== undefined) { setAdopted(applied); setMessage('本文に反映しました。'); }
    });
  }
  const result = state?.result;
  const generated = result?.state === 'completed' && result.current && result.content && !result.error_code;
  const changed = !!operation.current && props.value !== operation.current.original;
  const canStart = props.context.mode === 'shared' && state?.available && state.remaining > 0 && !busy && !pending && !unknown;
  const button = 'min-h-[44px] rounded-[8px] border border-newBorder px-[12px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
  return <section data-toybaco-shared-posting-ai="" className="mx-[12px] my-[8px] rounded-[12px] border border-newBorder bg-newBgColor p-[12px] text-textColor">
    <div className="flex flex-wrap items-center gap-[8px]">
      <button type="button" data-toybaco-composer-ai={props.first ? '' : undefined} className={button} onClick={() => setOpen(!open)} aria-expanded={open}>トイバコAIで文案を作る</button>
      {state && <span className="text-[11px] opacity-70">返信と共通・残り{state.remaining}回</span>}
    </div>
    {open && <div className="mt-[8px] flex flex-col gap-[10px]">
      {props.context.mode !== 'shared' && <p role="status" className="text-[12px]">{props.context.mode === 'checking' ? '利用状態を確認しています。' : 'AIに接続できません。画面を開き直してください。'}</p>}
      {state?.store_info_required && <p role="status" className="text-[12px]">先に店舗情報を確認してください。</p>}
      {state && !state.available && !state.store_info_required && <p role="status" className="text-[12px]">AIは現在準備中です。</p>}
      <label className="text-[12px]">伝えたいこと<textarea aria-label="AIへの依頼" value={instruction} maxLength={1000}
        onChange={event => setInstruction(event.target.value)} placeholder="例：来週から秋のメニュー。親しみやすい案内に" rows={2}
        className="mt-[4px] block w-full rounded-[8px] border border-newBorder bg-newBgColorInner p-[10px] text-[13px]" /></label>
      <div className="flex flex-wrap gap-[8px]">
        <button type="button" className={button + ' bg-[#1F3A5F] text-white'} disabled={!canStart || !(props.plainText.trim() || instruction.trim())}
          onClick={() => start(instruction)}>文案を作る · 1回</button>
        {[['短く', '短く読みやすく整えてください。'], ['丁寧に', '丁寧で自然な文に整えてください。'], ['親しみやすく', '親しみやすく自然な文に整えてください。']].map(([label, text]) =>
          <button type="button" key={label} className={button} disabled={!canStart || !props.plainText.trim()} onClick={() => { setInstruction(text); start(text); }}>{label}</button>)}
      </div>
      {pending && !unknown && <p role="status" className="text-[12px]">文案を作っています。<button type="button" disabled={busy} onClick={cancel} className="ml-[12px] underline">中止</button></p>}
      {state?.remaining === 0 && <p role="status" className="text-[12px]">今月のAIを使い切りました。プラン・追加パックは共通メニューで確認できます。</p>}
      {result?.state === 'failed' && !message && <p role="status" className="text-[12px]">{result.error_code === 'cancelled' ? '作成を中止しました。' : '作成できませんでした。入力と店舗情報を確認してください。'}</p>}
      {result?.state === 'completed' && (!result.current || result.error_code) && <p role="status" className="text-[12px]">文案の有効期限か店舗情報が変わりました。必要なら新しく作成してください。</p>}
      {generated && <div className="rounded-[10px] border border-newBorder bg-newBgColorInner p-[12px]">
        <p className="whitespace-pre-wrap text-[14px] leading-[1.8]" data-toybaco-post-draft-preview="">{result.content}</p>
        <p className="mt-[8px] text-[11px] opacity-70">{result.needs_review ? '日付・料金などを確認してください。' : '内容を確認してから使ってください。'}</p>
        <button type="button" className={button + ' mt-[8px] bg-[#1F3A5F] text-white'} disabled={busy || changed || adopted !== null} onClick={adopt}>この文案を使う</button>
        {changed && adopted === null && <p className="mt-[6px] text-[12px]">編集中の本文を残しています。必要な部分をコピーしてください。</p>}
      </div>}
      {adopted !== null && <button type="button" className={button} disabled={props.value !== adopted || busy || !isCurrent()}
        onClick={() => { const item = operation.current; if (item && latest.current.value === adopted && alive()) { latest.current.apply(item.original); setAdopted(null); setMessage('元の本文に戻しました。'); } }}>元に戻す</button>}
      {message && <p role="status" className="text-[12px]">{message}</p>}
      {unknown && <div className="flex flex-wrap gap-[8px]"><button type="button" className={button} disabled={busy} onClick={refresh}>状態を確認</button>
        {operation.current && <button type="button" className={button} disabled={busy} onClick={() => start('', true)}>同じ操作を再試行</button>}</div>}
    </div>}
  </section>;
}
