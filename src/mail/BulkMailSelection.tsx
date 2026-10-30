import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Account, RendererMail } from "../../shared/types";
import { MAX_MAIL_BATCH, type BulkMailAction, type MailBatchResponse, type MailBatchResult, type MailIdentity } from "../../shared/bulk-mail";
import { createPortal } from "react-dom";
import type { Api } from "../api";
import { Dialog } from "../ui/Dialog";
import { MailPrivacy, Redact, PrivacyContext } from "../ui/Privacy";
import { accountLabel } from "../mail-ui";
import { BulkSelectionContext, isSelectAllShortcut, ownsKeyboard, selectionKey, selectRange } from "./bulk-selection";

const actions: [BulkMailAction, string][] = [["read", "Mark as read"], ["unread", "Mark as unread"],
  ["archive", "Archive"], ["inbox", "Move to Inbox"], ["archive", "Done"],
  ["snooze", "Snooze"], ["pin", "Pin"], ["unpin", "Unpin"], ["trash", "Move to Trash"]];
// Matches the server: Sent mail permits only local pins and Trash.
const sentActions = new Set<BulkMailAction>(["pin", "unpin", "trash"]);
type Outcome = { results: MailBatchResult[]; items: RendererMail[]; refreshFailed?: boolean };

export function BulkMailSelection({ messages, accounts, scope, selectedId, onSelect, api, reload, disabled, syncing = false, onBlockingChange, selectionShortcut, toggleLabel = "X", active = true, children }: {
  messages: RendererMail[]; accounts: Account[]; scope: string; selectedId?: string;
  onSelect: (id: string) => void; api: Api; reload: () => Promise<unknown>;
  selectionShortcut?: (event: globalThis.KeyboardEvent) => "toggle" | "range" | null; toggleLabel?: string;
  disabled: boolean; syncing?: boolean; active?: boolean; onBlockingChange: (blocking: boolean) => void; children: ReactNode;
}) {
  const [selection, setSelection] = useState<{ scope: string; items: MailIdentity[] }>({ scope, items: [] });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmation, setConfirmation] = useState<MailIdentity[] | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [pending, setPending] = useState(false);
  const [limit, setLimit] = useState(false);
  const lock = useRef(false);
  const anchor = useRef<string | null>(null);
  const anchorScope = useRef(scope);
  const { on: privacy } = useContext(PrivacyContext);
  const available = new Set(messages.map(selectionKey));
  const items = selection.scope === scope ? selection.items.filter(item => available.has(selectionKey(item))) : [];
  const selected = new Set(items.map(selectionKey));
  const blocked = disabled || pending || !!confirmation || snoozing;
  // Selecting is local, so it stays available during sync; only actions wait.
  const actionsBlocked = blocked || syncing;
  const membership = JSON.stringify(messages.map(selectionKey));
  useEffect(() => {
    setSelection(current => ({ scope, items: current.scope === scope ? current.items.filter(item => available.has(selectionKey(item))) : [] }));
    // Sync refreshes keep a still-listed range anchor and an open dialog whose targets all remain.
    const moved = anchorScope.current !== scope;
    anchorScope.current = scope;
    if (moved || (anchor.current && !available.has(anchor.current))) anchor.current = null;
    const lost = (targets: MailIdentity[]) => targets.some(item => !available.has(selectionKey(item)));
    if (moved || lost(selection.items) || (confirmation && lost(confirmation))) { setConfirmation(null); setSnoozing(false); setLimit(false); }
  }, [scope, membership]);
  useEffect(() => {
    onBlockingChange(pending || !!confirmation || snoozing);
    return () => onBlockingChange(false);
  }, [pending, confirmation, snoozing, onBlockingChange]);
  const clear = () => { setSelection({ scope, items: [] }); anchor.current = null; setLimit(false); };
  const choose = (next: MailIdentity[]) => setSelection({ scope, items: next.map(({ id, accountId }) => ({ id, accountId })) });
  const toggle = (item: MailIdentity, range: boolean) => {
    if (blocked) return;
    const key = selectionKey(item);
    if (range) {
      anchor.current ??= messages.find(mail => mail.id === selectedId) ? selectionKey(messages.find(mail => mail.id === selectedId)!) : key;
      const next = selectRange(messages, anchor.current ?? key, key);
      setLimit(Math.abs(messages.findIndex(m => selectionKey(m) === (anchor.current ?? key)) - messages.findIndex(m => selectionKey(m) === key)) >= MAX_MAIL_BATCH);
      choose(next);
    } else {
      anchor.current = key;
      if (selected.has(key)) choose(items.filter(value => selectionKey(value) !== key));
      else if (items.length < MAX_MAIL_BATCH) choose([...items, item]);
      else setLimit(true);
    }
  };
  const all = () => { if (!blocked) { choose(messages.slice(0, MAX_MAIL_BATCH)); setLimit(messages.length > MAX_MAIL_BATCH); anchor.current = messages[0] ? selectionKey(messages[0]) : null; } };
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!active || blocked || event.nativeEvent.isComposing || target.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return;
    const rowId = target.closest('[data-mail-id]')?.getAttribute('data-mail-id');
    const cursor = messages.findIndex(mail => mail.id === (rowId ?? selectedId));
    if (event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey && items.length) {
      event.preventDefault(); event.stopPropagation(); clear();
    } else if ((selectionShortcut ? selectionShortcut(event.nativeEvent) === "toggle" : event.key.toLowerCase() === "x" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) && !event.repeat && cursor >= 0) {
      event.preventDefault(); event.stopPropagation(); toggle(messages[cursor], false);
    } else if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key) && (!selectionShortcut || selectionShortcut(event.nativeEvent) === "range") && cursor >= 0) {
      event.preventDefault(); event.stopPropagation();
      const next = messages[Math.max(0, Math.min(messages.length - 1, cursor + (event.key === "ArrowUp" ? -1 : 1)))];
      anchor.current ??= selectionKey(messages[cursor]);
      toggle(next, true); onSelect(next.id);
    }
  };
  // Select all works from anywhere on a mail list page, not only with list focus.
  const selectAll = useRef(all);
  selectAll.current = all;
  useEffect(() => {
    if (!active) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isSelectAllShortcut(event) || ownsKeyboard(event.target)) return;
      event.preventDefault();
      selectAll.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active]);
  const execute = async (action: BulkMailAction, submitted = items, until?: number) => {
    if (lock.current || disabled || syncing || !submitted.length) return;
    lock.current = true; setPending(true); setConfirmation(null); setSnoozing(false); clear();
    let results: MailBatchResult[];
    try {
      const response = await api<MailBatchResponse>("/messages/batch", "POST", { items: submitted, operation: { action, ...(until ? { until } : {}) } });
      results = submitted.map(item => response.results.find(result => selectionKey(result) === selectionKey(item)) ?? { ...item, status: "unknown" });
    } catch {
      results = submitted.map(item => ({ ...item, status: "unknown" }));
    }
    const result = { results, items: submitted.map(item => messages.find(mail => selectionKey(mail) === selectionKey(item))).filter((mail): mail is RendererMail => !!mail) };
    setOutcome(result);
    try { await reload(); } catch { setOutcome({ ...result, refreshFailed: true }); }
    finally { lock.current = false; setPending(false); }
  };
  const sentOnly = items.length > 0 && items.every(item => messages.find(mail => selectionKey(mail) === selectionKey(item))?.direction === "sent");
  const sentNote = useId();
  const label = (id: string) => {
    const index = accounts.findIndex(account => account.id === id);
    return index < 0 ? "Unavailable account" : accountLabel(accounts[index], index, privacy, accounts);
  };
  const resultMail = new Map(outcome?.items.map(mail => [selectionKey(mail), mail]));
  return <BulkSelectionContext.Provider value={active ? { selected, disabled: blocked, toggle } : null}>
    <div className="bulk-mail" onKeyDownCapture={keydown}>
      {active && <div className="bulk-bar" role="group" aria-label="Select and triage messages" aria-description={`${toggleLabel} toggles selection. Shift and arrow keys or Shift-click select a range. Escape clears selection.`}>
        <button className="button" disabled={blocked || !messages.length} onClick={all}>Select all visible (up to {MAX_MAIL_BATCH})</button>
        <span role="status" aria-live="polite" aria-atomic="true">{items.length} messages selected{limit ? `; selection limited to ${MAX_MAIL_BATCH}` : ""}</span>
        {!!items.length && <>
          <span>{[...new Set(items.map(item => item.accountId))].map(label).join(", ")}</span>
          <button className="button" disabled={blocked} onClick={clear}>Clear selection</button>
          {sentOnly && <span id={sentNote}>Sent mail supports Pin, Unpin and Move to Trash only.</span>}
          {actions.map(([action, text], index) => <button key={index} className="button" disabled={actionsBlocked || sentOnly && !sentActions.has(action)}
            aria-describedby={sentOnly && !sentActions.has(action) ? sentNote : undefined} onClick={() => {
            if (action === "trash") setConfirmation(items.map(item => ({ ...item })));
            else if (action === "snooze") setSnoozing(true);
            else void execute(action);
          }}>{text}</button>)}
        </>}
        {!!items.length && syncing && !pending && <span role="status">Waiting for sync…</span>}
        {pending && <span role="status">Applying message actions…</span>}
      </div>}
      {active && outcome && <div className="bulk-result" role="status">
        <p>{outcome.results.filter(item => item.status === "done").length} done, {outcome.results.filter(item => item.status === "failed").length} failed, {outcome.results.filter(item => item.status === "unknown").length} unknown.</p>
        {outcome.results.some(item => item.status !== "done") && <>
          <p>Failed items were not applied. Check your provider and sync before acting on unknown items. No actions were retried.</p>
          <details><summary>See failed and unknown messages</summary><ul>{outcome.results.map((item, index) => item.status !== "done" &&
            <li key={selectionKey(item)}>Message {index + 1}, {label(item.accountId)}: {item.status}
              {resultMail.get(selectionKey(item)) && <MailPrivacy mail={resultMail.get(selectionKey(item))!}><span> · <Redact text={resultMail.get(selectionKey(item))!.subject || "(no subject)"} /></span></MailPrivacy>}
            </li>)}</ul></details>
        </>}
        {outcome.refreshFailed && <p>Refreshing mail failed. Refresh separately to check the cache.</p>}
        <button className="button" onClick={() => setOutcome(null)}>Dismiss results</button>
      </div>}
      <div inert={pending || !!confirmation || snoozing}>{children}</div>
      {confirmation && createPortal(<Dialog title="Move messages to Trash" onClose={() => setConfirmation(null)}>
        <p>Move exactly {confirmation.length} messages to Trash? Recovery depends on your provider.</p>
        <div className="dialog-actions"><button className="button" onClick={() => setConfirmation(null)}>Cancel</button>
          <button className="button" disabled={disabled || syncing} onClick={() => void execute("trash", confirmation)}>Move {confirmation.length} messages to Trash</button></div>
        {syncing && <p role="status">Waiting for sync…</p>}
      </Dialog>, document.body)}
      {snoozing && createPortal(<Dialog title="Snooze selected messages" onClose={() => setSnoozing(false)}>
        <form onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("until") as HTMLInputElement;
          const until = new Date(field.value).getTime();
          if (!(until > Date.now() && until <= Date.now() + 366 * 86400000)) { field.setCustomValidity("Choose a future time within the next year."); field.reportValidity(); return; }
          void execute("snooze", items, until); }}>
          <label>Snooze until <input required name="until" type="datetime-local" onChange={event => event.currentTarget.setCustomValidity("")} /></label>
          <p>Choose a future time within the next year.</p><button className="button" disabled={disabled || syncing} type="submit">Snooze {items.length} messages</button>
          {syncing && <p role="status">Waiting for sync…</p>}
        </form>
      </Dialog>, document.body)}
    </div>
  </BulkSelectionContext.Provider>;
}
