import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CalendarEvent, WorkSessionList } from "../../shared/calendar";
import { sessionLabel } from "../../shared/calendar";
import type { Commitment } from "../../shared/workspace";
import { openCommitment } from "../../shared/commitment-dates";
import type { RendererState as State } from "../../shared/types";
import { ApiError, type Api } from "../api";
import { Dialog } from "../ui/Dialog";
import { PrivacyContext, Redact } from "../ui/Privacy";
import { accountLabel } from "../mail-ui";
import { blankEvent, eventFields, moveStart, sameEventFields, sessionInput, type EventFields } from "./events";
import { eventWhen } from "./EventPanel";

type Editor = { id: string; parent?: Commitment; parentId: string; accountId?: string; sourceMailId?: string; existing?: CalendarEvent; fields: EventFields; initial: EventFields; busy: boolean; initialBusy: boolean };
type Operation = { id: string; parentId: string; accountId?: string; sourceMailId?: string; path: string; method: string; body: unknown; result?: CalendarEvent };
const base = "/calendar/work-sessions";

// Workbench owns this hook even when the detail or source pane changes.
export function useWorkSessions(api: Api, parentId: string | undefined, accountKey: string, onChanged: () => Promise<unknown>) {
  const key = `${accountKey}:${parentId || ""}`, current = useRef(key); current.current = key;
  const live = useRef(true), reads = useRef(0), lock = useRef(false);
  const [snapshot, setSnapshot] = useState<{ key: string; value: WorkSessionList }>();
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [operation, setOperation] = useState<Operation>();
  const [recovered, setRecovered] = useState<CalendarEvent | null>();
  const [phase, setPhase] = useState<"idle" | "pending" | "unknown" | "review">("idle");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const read = ++reads.current;
    if (!parentId) return false;
    try {
      const value = await api<WorkSessionList>(`${base}?commitmentId=${encodeURIComponent(parentId)}`);
      if (!value || !Array.isArray(value.sessions) || typeof value.available !== "boolean") throw new Error();
      if (!live.current || current.current !== key || read !== reads.current) return false;
      setSnapshot({ key, value }); setError(""); return true;
    } catch {
      if (live.current && current.current === key && read === reads.current) { setSnapshot(undefined); setError("Work sessions could not be refreshed. Scheduling is paused."); }
      return false;
    }
  }, [api, key, parentId]);
  useEffect(() => { live.current = true; void refresh(); return () => { ++reads.current; }; }, [refresh]);
  useEffect(() => () => { live.current = false; }, []);
  const value = snapshot?.key === key ? snapshot.value : undefined;
  const locked = phase !== "idle" || !!operation;
  const dirty = !!editor && (!sameEventFields(editor.fields, editor.initial) || editor.busy !== editor.initialBusy);
  const open = (parent: Commitment | undefined, existing?: CalendarEvent) => {
    if (lock.current || locked || editor || !existing && (!parent || !value?.available || !openCommitment(parent))) return;
    let fields = existing ? eventFields(existing) : blankEvent(Date.now());
    if (!existing) {
      const end = new Date(new Date(`${fields.startDate}T${fields.startTime}`).getTime() + 60 * 60000);
      fields = { ...fields, endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`, endTime: `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}` };
    }
    setEditor({ id: existing?.id || crypto.randomUUID(), parent, parentId: existing?.workSession?.commitmentId || parent!.id,
      accountId: existing?.accountId || parent?.accountId, sourceMailId: existing?.sourceMailId || parent?.sourceMailId, existing, fields, initial: fields, busy: existing?.workSession?.busy ?? true, initialBusy: existing?.workSession?.busy ?? true });
    setMessage("");
  };
  const close = () => { if (!lock.current && !locked) { setEditor(undefined); setMessage(""); } };
  const run = async (op: Operation) => {
    if (lock.current || locked) return;
    lock.current = true; setOperation(op); setPhase("pending"); setMessage(""); setRecovered(undefined);
    // An old list response cannot overwrite the post-write read.
    ++reads.current;
    let acknowledged = false;
    try {
      const saved = await api<CalendarEvent>(op.path, op.method, op.body);
      if (!live.current) return;
      if (saved.id !== op.id || saved.workSession?.commitmentId !== op.parentId || saved.accountId !== op.accountId || saved.sourceMailId !== op.sourceMailId) throw new Error();
      acknowledged = true; setOperation({ ...op, result: saved });
      const refreshed = await refresh();
      const calendarRefreshed = await onChanged();
      if (!live.current) return;
      if (!refreshed || calendarRefreshed === false) { setPhase("review"); setMessage("Session saved; refresh unavailable. Check saved session before continuing."); return; }
      setPhase("idle"); setOperation(undefined); setEditor(undefined); setMessage("Session saved locally. Task and email are unchanged.");
    } catch (failure) {
      if (!live.current) return;
      setPhase(acknowledged ? "review" : "unknown");
      if (acknowledged) { setMessage("Session saved; refresh unavailable. Check saved session before continuing."); return; }
      setMessage(failure instanceof ApiError && [400, 404, 409].includes(failure.status)
        ? `${failure.message} Read and review saved session before continuing.`
        : "Session outcome unknown. Input and revision are frozen. Check saved session; do not submit again.");
    } finally { lock.current = false; }
  };
  const save = async () => {
    if (!editor || locked || !editor.parent || !value?.available || editor.parentId !== parentId) return;
    const result = sessionInput(editor.fields, editor.busy);
    if ("error" in result) { setMessage(result.error!); return; }
    await run({ id: editor.id, parentId: editor.parentId, accountId: editor.accountId, sourceMailId: editor.sourceMailId,
      path: editor.existing ? `${base}/${encodeURIComponent(editor.id)}` : base, method: editor.existing ? "PATCH" : "POST",
      body: { ...result.input, commitmentRevision: editor.parent.revision, ...(editor.existing ? { revision: editor.existing.revision } : { id: editor.id, commitmentId: editor.parentId }) } });
  };
  const transition = (event: CalendarEvent, status: "finish" | "remove") => run({ id: event.id, parentId: event.workSession!.commitmentId,
    accountId: event.accountId, sourceMailId: event.sourceMailId, path: `${base}/${encodeURIComponent(event.id)}${status === "finish" ? "/finish" : ""}`, method: status === "finish" ? "POST" : "DELETE", body: { revision: event.revision } });
  const recover = async () => {
    if (!operation || lock.current) return;
    lock.current = true; setPhase("pending");
    try {
      let saved: CalendarEvent | null;
      try { saved = await api<CalendarEvent>(`${base}/${encodeURIComponent(operation.id)}`); }
      catch (failure) { if (failure instanceof ApiError && failure.status === 404 && !operation.result) saved = null; else throw failure; }
      if (!live.current) return;
      if (saved && (saved.id !== operation.id || saved.workSession?.commitmentId !== operation.parentId || saved.accountId !== operation.accountId || saved.sourceMailId !== operation.sourceMailId)) throw new Error();
      if (!await refresh()) throw new Error();
      if (!live.current) return;
      setRecovered(saved); setPhase("review"); setMessage("Review saved session. Recovery used reads only. No action was retried.");
    } catch { if (live.current) { setPhase("unknown"); setMessage("Saved session could not be confirmed. Input and revision remain frozen. Check saved session again."); } }
    finally { lock.current = false; }
  };
  const acknowledge = () => {
    if (lock.current || recovered === undefined) return;
    setOperation(undefined); setEditor(undefined); setRecovered(undefined); setPhase("idle"); setMessage(""); void onChanged();
  };
  return { value, error, editor, operation, recovered, phase, message, locked, dirty, refresh, open, close, save, transition, recover, acknowledge,
    setFields: (fields: EventFields) => { if (!locked) setEditor(current => current && ({ ...current, fields })); },
    setBusy: (busy: boolean) => { if (!locked) setEditor(current => current && ({ ...current, busy })); } };
}
export type Sessions = ReturnType<typeof useWorkSessions>;
export function SessionActions({ event, parent, sessions, disabled = false }: { event: CalendarEvent; parent?: Commitment; sessions: Sessions; disabled?: boolean }) {
  return <div className="form-actions">
    {event.workSession?.status === "planned" && <><button type="button" disabled={disabled || sessions.locked || !sessions.value?.available || !parent} onClick={() => sessions.open(parent, event)}>Edit session</button>
      <button type="button" disabled={sessions.locked} onClick={() => void sessions.transition(event, "finish")}>Finish session</button></>}
    {event.workSession?.status !== "removed" && <button type="button" disabled={sessions.locked} onClick={() => void sessions.transition(event, "remove")}>Remove session</button>}
  </div>;
}
export function WorkSessions({ parent, sessions, disabled }: { parent: Commitment; sessions: Sessions; disabled: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null), wasDialogOpen = useRef(false);
  const dialogOpen = !!sessions.editor || !!sessions.operation;
  useEffect(() => {
    if (wasDialogOpen.current && !dialogOpen && document.activeElement === document.body) heading.current?.focus({ preventScroll: true });
    wasDialogOpen.current = dialogOpen;
  }, [dialogOpen]);
  return <section className="work-sessions" aria-label="Work sessions">
    <h3 ref={heading} tabIndex={-1}>Local work sessions</h3>
    <p className="work-meta">Local calendar conflicts only. Google calendars are excluded. Free sessions do not block offered times.</p>
    {sessions.error && <p role="alert">{sessions.error}</p>}
    {!sessions.value && !sessions.error && <p role="status">Loading work sessions…</p>}
    {sessions.value && !sessions.value.available && <p role="alert">{sessions.value.reason}</p>}
    {sessions.message && !sessions.operation && !sessions.editor && <p role="status">{sessions.message}</p>}
    {!!sessions.value?.sessions.length && <ul>{sessions.value.sessions.map(event => <li key={event.id} data-session-id={event.id}>
      <p>{eventWhen(event)}</p><p className="work-meta">{sessionLabel(event)}</p><SessionActions event={event} parent={parent} sessions={sessions} disabled={disabled} />
    </li>)}</ul>}
    {sessions.value && !sessions.value.sessions.length && <p className="work-meta">No local work sessions.</p>}
  </section>;
}
export function SessionDialog({ sessions, state, parent }: { sessions: Sessions; state: State; parent?: Commitment }) {
  const { on: privacy } = useContext(PrivacyContext);
  const editor = sessions.editor, op = sessions.operation;
  if (!editor && !op) return null;
  const accountId = editor?.accountId || op?.accountId, sourceId = editor?.sourceMailId || op?.sourceMailId;
  const index = state.accounts.findIndex(account => account.id === accountId);
  const mail = state.messages.find(mail => mail.id === sourceId && mail.accountId === accountId);
  const schedulable = !!editor && !!parent && parent.id === editor.parentId && parent.revision === editor.parent?.revision && openCommitment(parent) && index >= 0 && !!mail && sessions.value?.available;
  const fields = editor?.fields;
  return <Dialog title={op && !editor ? "Review work session" : editor?.existing ? "Edit work session" : "Plan work"} onClose={sessions.close} className="event-dialog session-dialog">
    <p><Redact text={editor?.parent?.text || editor?.existing?.title || "Local work session"} /></p>
    <p className="work-meta"><Redact text={index < 0 ? "Account unavailable" : accountLabel(state.accounts[index], index, privacy)} /> · From email: <Redact text={mail?.subject || "Source unavailable in cache"} /></p>
    <p className="note">Saves only this local session. Task dates, status, history and email stay independent. Local calendar conflicts only. Google calendars are excluded.</p>
    {sessions.message && <p role={sessions.phase === "unknown" ? "alert" : "status"}>{sessions.message}</p>}
    {editor && !schedulable && <p role="alert">Task or source changed or is unavailable. Scheduling is paused. Close and review saved work.</p>}
    {fields && <form className="settings-form work-form session-form" aria-label="Local work session" onSubmit={event => { event.preventDefault(); if (schedulable) void sessions.save(); }}>
      <fieldset disabled={sessions.locked || !schedulable} className="event-fields"><div className="work-form-dates">
        <label>Start date<input type="date" required value={fields.startDate} onChange={event => sessions.setFields(moveStart(fields, event.target.value, fields.startTime))} /></label>
        <label>Start time<input type="time" required value={fields.startTime} onChange={event => sessions.setFields(moveStart(fields, fields.startDate, event.target.value))} /></label>
        <label>End date<input type="date" required value={fields.endDate} onChange={event => sessions.setFields({ ...fields, endDate: event.target.value })} /></label>
        <label>End time<input type="time" required value={fields.endTime} onChange={event => sessions.setFields({ ...fields, endTime: event.target.value })} /></label>
      </div><p className="work-meta">Device time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
      <label><input type="checkbox" checked={editor.busy} onChange={event => sessions.setBusy(event.target.checked)} />Busy</label>
      <p className="work-meta">Clear Busy to choose Free. Free allows overlap and does not block offered times.</p></fieldset>
      <div className="form-actions"><button type="button" onClick={sessions.close} disabled={sessions.locked}>Cancel</button><button className="button" disabled={sessions.locked || !schedulable}>Save session locally</button></div>
    </form>}
    {op && <div className="session-recovery">
      <button type="button" disabled={sessions.phase === "pending"} onClick={() => void sessions.recover()}>Check saved session</button>
      {sessions.recovered !== undefined && <><p>{sessions.recovered ? `${sessionLabel(sessions.recovered)} · revision ${sessions.recovered.revision}` : "No session exists at the retained UUID. No replacement was created."}</p>
        {sessions.recovered && <p>{eventWhen(sessions.recovered)}</p>}<button type="button" disabled={sessions.phase === "pending"} onClick={sessions.acknowledge}>I reviewed saved session</button></>}
    </div>}
  </Dialog>;
}
