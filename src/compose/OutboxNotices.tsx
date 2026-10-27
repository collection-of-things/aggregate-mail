import { useEffect, useRef, useState } from "react";
import type { Draft, OutboxStatus } from "../../shared/types";
import type { Api } from "../api";

export function OutboxNotices({ api, enabled, blocked, refreshKey = 0, onEdit, onNotice, onChanged }: {
  api: Api; enabled: boolean; blocked: boolean; refreshKey?: number;
  onEdit: (draft: Draft) => void; onNotice: (text: string, kind?: "info" | "error") => void; onChanged: () => void;
}) {
  const [entries, setEntries] = useState<OutboxStatus[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errorReported = useRef(false);
  const refresh = async () => {
    const response = await api<OutboxStatus[]>("/outbox");
    const next = Array.isArray(response) ? response : [];
    entriesRef.current = next; setEntries(next); setNow(Date.now()); errorReported.current = false;
  };
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const response = await api<OutboxStatus[]>("/outbox");
        const next = Array.isArray(response) ? response : [];
        if (!stopped) { entriesRef.current = next; setEntries(next); setNow(Date.now()); errorReported.current = false; }
      } catch {
        if (!stopped && !errorReported.current) { errorReported.current = true; onNotice("Outbox status unavailable. Check it before sending again.", "error"); }
      } finally { running = false; }
    };
    // Poll quickly only while a countdown or submission is in progress.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (stopped) return;
      const active = entriesRef.current.some(entry => entry.state === "pending" && !entry.review || entry.state === "submitting");
      timer = setTimeout(() => { void poll().finally(schedule); }, active ? 500 : 5000);
    };
    void poll().finally(schedule);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, enabled, onNotice, refreshKey]);
  const act = async (entry: OutboxStatus, action: "edit" | "send" | "discard") => {
    if (lock.current || blocked) return;
    if (action === "discard" && entry.state !== "sent" && !confirm(entry.state === "unknown"
      ? "Discard this local copy? It may already have been sent. Check your provider."
      : "Discard this unsent message from this device?")) return;
    lock.current = true; setBusy(true);
    try {
      if (action === "edit") {
        const draft = await api<Draft>(`/outbox/${entry.id}/edit`, "POST", {});
        onEdit(draft);
        onNotice(entry.state === "pending" ? "Send cancelled before submission. Exact draft restored." : "Draft restored. Check your provider before resending an unknown outcome.");
      } else if (action === "send") await api(`/outbox/${entry.id}/send`, "POST", {});
      else await api(`/outbox/${entry.id}`, "DELETE", { confirmUnknown: entry.state === "unknown" });
      await refresh(); onChanged();
    } catch { onNotice("Outbox action could not be confirmed. Refresh and review its status before trying again.", "error"); }
    finally { lock.current = false; setBusy(false); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      // Native text undo and modal keyboard ownership always take precedence.
      if (blocked || event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey ||
        !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" ||
        document.querySelector('[role="dialog"]') ||
        (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      const entry = [...entries].reverse().find(entry => entry.state === "pending" && !entry.review);
      if (entry) { event.preventDefault(); void act(entry, "edit"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!entries.length) return null;
  return <section aria-label="Outbox" className="outbox-notices">
    {entries.map(entry => <div className="toast" key={entry.id}>
      <div className="toast-body">
        <strong className="toast-title">Outbox</strong>
        <p className="toast-text" role="status" aria-atomic="true">
          {entry.state === "pending" ? entry.review ? "Not sent. Review this saved message." : `Sending in ${Math.max(0, Math.ceil((entry.dueAt - now) / 1000))} seconds.`
            : entry.state === "submitting" ? "Submitting. Undo is no longer available."
            : entry.state === "sent" ? entry.warning || "Provider accepted this message. There is no recall."
            : entry.state === "failed" ? "Provider rejected this message before acceptance. Edit before trying again."
            : "Send status unknown. Check your provider. Resending may send a duplicate."}
        </p>
        <div className="toast-actions">
          {entry.state === "pending" && !entry.review && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "edit")} aria-keyshortcuts="Control+z Meta+z" title="Undo send (Ctrl/Cmd+Z outside editors)">Undo send</button>}
          {entry.state === "pending" && entry.review && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "send")}>Send now</button>}
          {entry.state !== "submitting" && entry.state !== "sent" && (entry.review || entry.state !== "pending") && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "edit")}>Edit</button>}
          {entry.state !== "submitting" && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "discard")}>{entry.state === "sent" ? "Dismiss" : "Discard"}</button>}
        </div>
      </div>
    </div>)}
  </section>;
}
