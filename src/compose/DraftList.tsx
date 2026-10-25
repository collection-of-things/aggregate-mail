import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Account, Draft, DraftSummary } from "../../shared/types";
import type { Api } from "../api";
import { accountLabel } from "../mail-ui";
import { ProviderIcon } from "../mail/Avatar";
import { PrivacyContext, Redact } from "../ui/Privacy";
import { Trash } from "../ui/icons";
import { useMailSearch } from "../use-mail-search";
import { relative } from "../mail/format";

export function DraftList({ accounts, api, accountFilter, query, refreshKey, active, onOpen, onAccount, onDeleted, search: suppliedSearch }: {
  accounts: Account[]; api: Api; accountFilter: string; query: string;
  refreshKey?: number | string; active: boolean; onOpen: (draft: Draft) => void;
  onAccount?: (id: string) => void;
  onDeleted?: () => void;
  search?: ReturnType<typeof useMailSearch>;
}) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const localSearch = useMailSearch(suppliedSearch ? "" : query, accounts, [], api, typeof refreshKey === "string" ? refreshKey : undefined);
  const search = suppliedSearch ?? localSearch;
  const searching = Boolean(query.trim());
  const live = useRef(false);
  const deletionEpoch = useRef(0);
  const list = useRef<HTMLElement>(null);
  const refresh = useRef<HTMLButtonElement>(null);
  const focusAfterDelete = useRef<number | null>(null);
  useEffect(() => {
    if (opening || focusAfterDelete.current === null) return;
    const rows = list.current?.querySelectorAll<HTMLButtonElement>(".draft-row");
    const index = focusAfterDelete.current;
    focusAfterDelete.current = null;
    (rows?.[Math.min(index, rows.length - 1)] || refresh.current)?.focus();
  }, [drafts, opening]);
  const generation = useRef(0);
  const lock = useRef<AbortController | null>(null);
  const contextKey = JSON.stringify([query, accountFilter, refreshKey, accounts.map(a => a.id)]);
  const current = useRef({ active, contextKey, onOpen });
  useLayoutEffect(() => { current.current = { active, contextKey, onOpen }; });
  useLayoutEffect(() => {
    generation.current++;
    lock.current?.abort(); lock.current = null; setOpening(false);
    return () => { generation.current++; lock.current?.abort(); lock.current = null; };
  }, [contextKey, active]);
  const { on: privateText } = useContext(PrivacyContext);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    if (!active || searching) return;
    let stopped = false;
    const epoch = deletionEpoch.current;
    setLoading(true); setError("");
    void Promise.all(accounts.map((account) => api<DraftSummary[]>(
      `/accounts/${encodeURIComponent(account.id)}/drafts`,
    ))).then((lists) => {
      if (!lists.every(Array.isArray)) throw new Error();
      if (!stopped && epoch === deletionEpoch.current) { setDrafts(lists.flat().sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))); setLoaded(true); setUnavailable(false); }
    }).catch(() => {
      if (!stopped && epoch === deletionEpoch.current) { setUnavailable(true); setError("Drafts could not be loaded. Try refreshing."); }
    }).finally(() => { if (!stopped && epoch === deletionEpoch.current) setLoading(false); });
    return () => { stopped = true; };
  }, [accounts, api, attempt, refreshKey, active, searching]);
  const open = async (summary: DraftSummary) => {
    if (lock.current || !current.current.active) return;
    const controller = new AbortController();
    const started = ++generation.current;
    const key = contextKey;
    lock.current = controller; setOpening(true); setError("");
    const valid = () => live.current && !controller.signal.aborted && started === generation.current &&
      current.current.active && current.current.contextKey === key;
    try {
      const draft = await api<Draft>(`/accounts/${encodeURIComponent(summary.accountId)}/drafts/${encodeURIComponent(summary.id)}`, "GET", undefined, controller.signal);
      if (!valid()) return;
      if (draft.id !== summary.id || draft.accountId !== summary.accountId || draft.revision !== summary.revision) {
        setError("This draft changed. Refresh before opening it."); return;
      }
      current.current.onOpen(draft);
    } catch {
      if (valid()) setError("This draft could not be opened. Refresh to check whether it changed or was removed.");
    } finally {
      if (lock.current === controller) { lock.current = null; if (live.current) setOpening(false); }
    }
  };
  const discard = async (summary: DraftSummary, index: number) => {
    if (!active || lock.current) return;
    if (!confirm(summary.sendUnknown
      ? "Discard this saved draft? This message may already have been sent."
      : "Discard this draft from this device?")) return;
    const controller = new AbortController(); lock.current = controller; setOpening(true); setError("");
    try {
      const result = await api<{ ok?: boolean }>(`/accounts/${encodeURIComponent(summary.accountId)}/drafts/${encodeURIComponent(summary.id)}`, "DELETE", {
        revision: summary.revision, ...(summary.sendUnknown ? { confirmUnknown: true } : {}),
      });
      if (result.ok !== true) throw new Error("Deletion not confirmed");
      if (live.current) {
        deletionEpoch.current++;
        setLoading(false);
        focusAfterDelete.current = index;
        setDrafts(current => current.filter(draft => draft.accountId !== summary.accountId || draft.id !== summary.id));
        if (searching) search.refresh();
        onDeleted?.();
      }
    } catch {
      if (live.current) setError("Draft deletion could not be confirmed. Refresh to check its saved state before trying again.");
    } finally { lock.current = null; if (live.current) setOpening(false); }
  };
  const available = searching ? search.drafts : drafts;
  const pending = searching ? search.pending : loading;
  const problem = error || (searching ? search.error : "");
  const visible = available.filter(draft => accounts.some(account => account.id === draft.accountId) &&
    (accountFilter === "all" || draft.accountId === accountFilter));
  return <>
    <div className="draft-tab-bar">
    {onAccount && <nav className="draft-account-tabs" aria-label="Draft accounts">
      {[{ id: "all", label: "All" }, ...accounts.map((account, index) => ({ id: account.id, label: accountLabel(account, index, privateText, accounts) }))].map(({ id, label }) => (
        <button type="button" key={id} aria-pressed={accountFilter === id} disabled={!active || opening}
          onClick={() => onAccount(id)}>
          <span className="draft-account-label">{label}</span>
          {(searching ? !pending && !search.error : loaded && !unavailable) && <span className="tab-count">{id === "all" ? available.length : available.filter((draft) => draft.accountId === id).length}</span>}
        </button>
      ))}
    </nav>}
    {active && <button className="draft-refresh" ref={refresh} type="button" disabled={pending || opening} onClick={() => { setError(""); if (searching) search.refresh(); else setAttempt(value => value + 1); }}>Refresh</button>}
    </div>
    <section ref={list} className="draft-list" aria-label="Saved drafts" aria-busy={pending || opening}>
    <div className={`draft-list-heading${pending || unavailable ? "" : searching ? "" : " visually-hidden"}`} aria-live="polite"><span>{pending ? "Loading drafts…" : unavailable ? loaded ? `${visible.length} cached ${visible.length === 1 ? "draft" : "drafts"} · Count unavailable until refresh` : "Draft count unavailable" : `${visible.length} ${visible.length === 1 ? "draft" : "drafts"} · Saved on this device`}</span>
      </div>
    {problem && <p className="draft-list-error" role="alert">{problem}</p>}
    {!pending && !problem && !visible.length && <p className="work-empty">{query ? "No matching drafts." : "No saved drafts in this account."}</p>}
    <ul>{visible.map((draft, index) => {
      const accountIndex = accounts.findIndex((account) => account.id === draft.accountId);
      const account = accounts[accountIndex];
      return <li key={`${draft.accountId}:${draft.id}`}>
        <button type="button" className="draft-row" disabled={opening || !active} onClick={() => void open(draft)}>
          <span className="draft-row-identity">
            <span className="draft-row-recipient">{privateText ? "Hidden recipients" : draft.to || "No recipient"}</span>
            <span className="draft-row-account"><ProviderIcon provider={account.provider} /><Redact text={accountLabel(account, accountIndex, privateText, accounts)} /></span>
          </span>
          <span className="draft-row-content">
            <strong>{privateText ? `Draft ${index + 1}` : draft.subject || "No subject"}</strong>
            <span className="draft-row-addresses">From: {privateText ? "Hidden sender" : account.email} · To: {privateText ? "Hidden recipients" : draft.to || "No recipient"}{!!draft.cc?.length && ` · Cc: ${privateText ? draft.cc.length : draft.cc.join(", ")}`}</span>
            <span className="draft-row-preview">{privateText ? "Preview hidden" : draft.preview || "No message yet"}</span>
            {draft.sendUnknown && <span className="draft-warning">Send status unknown. May already have been sent.</span>}
          </span>
          <span className="draft-row-meta"><time dateTime={new Date(draft.updatedAt).toISOString()} title={new Date(draft.updatedAt).toLocaleString()}>{relative(draft.updatedAt)}</time>
            {!!draft.attachmentCount && <span>{draft.attachmentCount} {draft.attachmentCount === 1 ? "attachment" : "attachments"}</span>}</span>
        </button>
        <button type="button" className="draft-row-delete" aria-label="Delete draft" title="Delete draft"
          disabled={opening || !active} onClick={() => void discard(draft, index)}><Trash size={15} /></button>
      </li>;
    })}</ul>
  </section></>;
}
