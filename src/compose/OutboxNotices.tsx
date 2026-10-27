import { ScheduleTime } from "./ScheduleTime";
import { followUpPreset } from "../../shared/follow-up-presets";
import { useEffect, useRef, useState } from "react";
import type { Draft, OutboxStatus } from "../../shared/types";
import type { Api } from "../api";

export function OutboxNotices({ api, enabled, blocked, refreshKey = 0, scheduledOnly = false, onScheduled, onEdit, onNotice, onChanged }: {
  api: Api; enabled: boolean; blocked: boolean; refreshKey?: number; scheduledOnly?: boolean; onScheduled?: () => void;
  onEdit: (draft: Draft) => void; onNotice: (text: string, kind?: "info" | "error") => void; onChanged: () => void;
}) {
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [at, setAt] = useState(() => followUpPreset("tomorrow", Date.now())!);
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
      const active = entriesRef.current.some(entry => entry.state === "pending" && !entry.review && (entry.scheduledFor === undefined || entry.dueAt - Date.now() < 60000) || entry.state === "submitting");
      timer = setTimeout(() => { void poll().finally(schedule); }, active ? 500 : 5000);
    };
    void poll().finally(schedule);
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, enabled, onNotice, refreshKey]);
  const act = async (entry: OutboxStatus, action: "edit" | "send" | "discard" | "cancel" | "reschedule") => {
    if (lock.current || blocked) return;
    if (action === "discard" && entry.state !== "sent" && !confirm(entry.state === "unknown"
      ? "Discard this local copy? It may already have been sent. Check your provider."
      : "Discard this unsent message from this device?")) return;
    lock.current = true; setBusy(true);
    try {
      if (action === "reschedule") {
        await api(`/outbox/${entry.id}/reschedule`, "POST", { at });
        setRescheduling(null); onNotice("Schedule saved. Emc² must stay running and online.");
      } else if (action === "edit" || action === "cancel") {
        const draft = await api<Draft>(`/outbox/${entry.id}/edit`, "POST", {});
        if (action === "edit") onEdit(draft);
        onNotice(action === "cancel" ? "Schedule cancelled. The exact draft is saved in Drafts." : entry.state === "pending" ? "Send cancelled before submission. Exact draft restored." : "Draft restored. Check your provider before resending an unknown outcome.");
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
      if (scheduledOnly || blocked || event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey ||
        !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" ||
        document.querySelector('[role="dialog"]') ||
        (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      const entry = [...entries].reverse().find(entry => entry.state === "pending" && !entry.review && entry.scheduledFor === undefined);
      if (entry) { event.preventDefault(); void act(entry, "edit"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const visible = entries.filter(entry => scheduledOnly === (entry.scheduledFor !== undefined));
  const scheduled = entries.filter(entry => entry.scheduledFor !== undefined);
  if (!visible.length && !(scheduled.length && !scheduledOnly && onScheduled)) return scheduledOnly ? <p role="status">No scheduled messages.</p> : null;
  return <section aria-label={scheduledOnly ? "Scheduled messages" : "Outbox"} className="outbox-notices">
    {!scheduledOnly && scheduled.length > 0 && onScheduled && <div className="toast"><div className="toast-body">
      <p className="toast-text" role="status">{scheduled.some(entry => entry.state === "unknown" || entry.state === "failed" || entry.state === "pending" && entry.review) ? "Scheduled mail needs review. Nothing held will be sent automatically." : `${scheduled.length} scheduled messages and outcomes.`}</p>
      <button type="button" disabled={blocked || busy} onClick={onScheduled}>Open Scheduled</button>
    </div></div>}
    {visible.map(entry => <div className="toast" key={entry.id}>
      <div className="toast-body">
        <strong className="toast-title">{scheduledOnly ? "Scheduled message" : "Outbox"}</strong>
        {scheduledOnly && <p>Scheduled for {new Date(entry.dueAt).toLocaleString()}. Created {new Date(entry.createdAt).toLocaleString()}.</p>}
        <p className="toast-text" role="status" aria-atomic="true">
          {entry.state === "pending" ? entry.review ? "Not sent. Review this saved message." : scheduledOnly ? "Waiting for the scheduled time. Emc² must be running and online." : `Sending in ${Math.max(0, Math.ceil((entry.dueAt - now) / 1000))} seconds.`
            : entry.state === "submitting" ? "Submitting. Undo is no longer available."
            : entry.state === "sent" ? entry.warning || "Provider accepted this message. There is no recall."
            : entry.state === "failed" ? "Provider rejected this message before acceptance. Edit before trying again."
            : "Send status unknown. Check your provider. Resending may send a duplicate."}
        </p>
        <div className="toast-actions">
          {!scheduledOnly && entry.state === "pending" && !entry.review && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "edit")} aria-keyshortcuts="Control+z Meta+z" title="Undo send (Ctrl/Cmd+Z outside editors)">Undo send</button>}
          {entry.state === "pending" && entry.review && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "send")}>Send now</button>}
          {entry.state !== "submitting" && entry.state !== "sent" && (scheduledOnly || entry.review || entry.state !== "pending") && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "edit")}>Edit</button>}
          {scheduledOnly && entry.state === "pending" && <>
            <button type="button" disabled={blocked || busy} onClick={() => { setAt(entry.dueAt > Date.now() ? entry.dueAt : followUpPreset("tomorrow", Date.now())!); setRescheduling(entry.id); }}>Reschedule</button>
            <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "cancel")}>Cancel schedule</button>
          </>}
          {entry.state !== "submitting" && <button type="button" disabled={blocked || busy} onClick={() => void act(entry, "discard")}>{entry.state === "sent" ? "Dismiss" : "Discard"}</button>}
        </div>
        {rescheduling === entry.id && <form onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) void act(entry, "reschedule"); }}>
          <ScheduleTime at={at} onChange={setAt} disabled={blocked || busy} />
          <button type="submit" disabled={blocked || busy}>Save schedule</button>
          <button type="button" disabled={busy} onClick={() => setRescheduling(null)}>Cancel reschedule</button>
        </form>}
      </div>
    </div>)}
  </section>;
}
