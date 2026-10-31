import { useEffect, useRef, useState } from "react";
import type { CalendarEvent, CalendarResponse } from "../../shared/calendar";
import type { Draft, Mail } from "../../shared/types";
import type { InvitationResponse } from "../../shared/invitations";
import type { Api } from "../api";
import { Address, Redact } from "../ui/Privacy";
import { eventWhen } from "./EventPanel";

type Operation = { state: "unknown" | "complete"; kind?: string; requestId?: string; response?: CalendarResponse; result?: CalendarEvent; sourceMailId?: string; sourceFingerprint?: string };
const answers = [["Accept", "ACCEPTED", "accepted"], ["Maybe", "TENTATIVE", "tentative"], ["Decline", "DECLINED", "declined"]] as const;
export function CalendarActions({ event, api, google, accountAvailable = false, invitation, onOpenDraft, onChanged, onReviewResult }: {
  event: CalendarEvent; api: Api; google: boolean; accountAvailable?: boolean; invitation?: { mailId: string; fingerprint: string }; onOpenDraft?: (draft: Draft) => void; onChanged?: () => unknown; onReviewResult?: (event: CalendarEvent) => void;
}) {
  const lock = useRef(false);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const [operation, setOperation] = useState<Operation>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Operation[]>(`/calendar/operations?eventId=${encodeURIComponent(event.id)}`).then((ops) => { if (active) { setOperation(ops.find((op) => op.state === "unknown") || ops.find((op) => op.kind === "google-insert")); setLoaded(true); } }).catch(() => { if (active) setNotice("Calendar action status unavailable. Reopen this event before notifying people."); });
    return () => { active = false; };
  }, [api, event.id]);
  const run = async (task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setPending(true); setNotice("");
    try { await task(); } catch (error) { setNotice(error instanceof Error ? error.message : "Action could not be confirmed. Review saved drafts and calendar status."); }
    finally { lock.current = false; setPending(false); }
  };
  const prepare = (method: "REQUEST" | "CANCEL") => run(async () => {
    const draft = await api<Draft>(`/calendar/events/${encodeURIComponent(event.id)}/invitation`, "POST", { revision: event.revision, method });
    setNotice("Draft prepared. Review it and press Send to notify attendees."); onOpenDraft?.(draft); onChanged?.();
  });
  const googleWrite = (response?: "accepted" | "tentative" | "declined") => run(async () => {
    const reconcile = operation?.state === "unknown";
    const request = reconcile ? operation : { state: "unknown" as const, requestId: crypto.randomUUID(), response, sourceMailId: invitation?.mailId, sourceFingerprint: invitation?.fingerprint };
    // Keep the submitted identity even if the HTTP response is lost. Checking never writes again.
    setOperation(request);
    const answer = answers.find(([, , value]) => value === request?.response);
    const result = await api<Operation>(event.source === "local" ? `/calendar/events/${encodeURIComponent(event.id)}/google` : invitation ? `/calendar/invitations/${encodeURIComponent(invitation.mailId)}/google-rsvp` : `/calendar/google/${encodeURIComponent(event.accountId!)}/rsvp`, "POST",
      event.source === "local" ? { revision: event.revision, reconcile } : invitation ? { fingerprint: invitation.fingerprint, response: answer?.[1], requestId: request?.requestId, reconcile } : { eventId: event.id, response: request?.response, requestId: request?.requestId, reconcile });
    setOperation(result);
    setNotice(result.state === "unknown" ? "Google outcome unknown. Do not resend. Check the submitted action to reconcile." : "Google accepted the calendar change and attendee notification request.");
    onChanged?.();
  });
  return <div className="calendar-actions">
    {event.myResponse && <p role="status">Your response: {event.myResponse}</p>}
    {event.cancelled && <p role="status">Cancelled event</p>}
    {notice && <p role="status">{notice}</p>}
    {!event.cancelled && event.source === "local" && <>
      {!accountAvailable && <p>Choose a connected account in Edit event before preparing an invitation.</p>}
      <div className="form-actions"><button type="button" disabled={pending || !accountAvailable || !onOpenDraft} onClick={() => void prepare("REQUEST")}>Prepare invitation draft</button>
      <button type="button" disabled={pending || !accountAvailable || !onOpenDraft} onClick={() => void prepare("CANCEL")}>Prepare cancellation draft</button></div>
    </>}
    {operation?.kind === "google-insert" && operation.state === "complete" && operation.result && onReviewResult && <button type="button" onClick={() => onReviewResult(operation.result!)}>Review created Google event</button>}
    {operation?.state === "unknown" ? <><p role="alert">A Google action has an unknown outcome. No automatic retry is allowed.</p><button type="button" disabled={pending || !!invitation && (operation.sourceMailId !== invitation.mailId || operation.sourceFingerprint !== invitation.fingerprint)} onClick={() => void googleWrite()}>Check submitted Google action</button></>
      : event.source === "local" && google && !event.cancelled ? <button type="button" disabled={pending || !loaded || operation?.state === "complete"} onClick={() => void googleWrite()}>Create on Google and notify attendees</button>
      : event.source === "google" && google ? <div className="form-actions">{answers.map(([label, , value]) => <button type="button" key={value} disabled={pending || !loaded} onClick={() => void googleWrite(value)}>{label} on Google and notify organizer</button>)}</div> : null}
  </div>;
}
type InvitationState = { invitation: Mail["invitation"]; fingerprint: string; eligible: boolean; google?: CalendarEvent; review?: { token: string; current?: CalendarEvent } };
export function InvitationPanel({ mail, api, onOpenDraft, onChanged }: { mail: Mail; api: Api; onOpenDraft?: (draft: Draft) => void; onChanged?: () => unknown }) {
  const [state, setState] = useState<InvitationState>();
  const [notice, setNotice] = useState(""), [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [reviewed, setReviewed] = useState(false);
  const cached = mail.invitation;
  useEffect(() => {
    let active = true;
    setReviewed(false); setState(undefined);
    if (cached) void api<InvitationState>(`/calendar/invitations/${encodeURIComponent(mail.id)}`).then((value) => { if (active) setState(value); }).catch(() => { if (active) setNotice("Invitation identity unavailable. Reopen the email before responding."); });
    return () => { active = false; };
  }, [api, mail.id, cached]);
  const presented = state ? state.invitation : cached;
  if (!presented) return null;
  const run = async (answer?: InvitationResponse) => {
    if (lock.current || !state?.eligible || state.review?.current && !reviewed) return;
    lock.current = true; setPending(true); setNotice("");
    try {
      if (answer) {
        const draft = await api<Draft>(`/calendar/invitations/${encodeURIComponent(mail.id)}/reply`, "POST", { fingerprint: state.fingerprint, response: answer, ...(reviewed ? { reviewToken: state.review?.token } : {}) });
        setNotice("Response saved locally. Review the reply draft and press Send to notify the organizer."); onOpenDraft?.(draft);
      } else {
        await api(`/calendar/invitations/${encodeURIComponent(mail.id)}/apply`, "POST", { fingerprint: state.fingerprint, ...(reviewed ? { reviewToken: state.review?.token } : {}) });
        setNotice("Calendar message applied to the matching local event.");
      }
      onChanged?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Calendar response could not be confirmed. No automatic retry was made."); }
    finally { lock.current = false; setPending(false); }
  };
  return <section className="invitation-panel" aria-label="Calendar invitation">
    {presented.status !== "ok" ? <p role="status">Unsupported calendar message ({presented.reason}). No date or response is guessed.</p> : <>
      <h3>Received calendar details</h3>
      <h2><Redact text={presented.invitation.title} /></h2><p>{eventWhen(presented.invitation)}</p>
      <p>Organizer: <Address value={presented.invitation.organizer} /></p>
      {presented.invitation.location && <p><Redact text={presented.invitation.location} /></p>}
      {presented.invitation.notes && <p><Redact text={presented.invitation.notes} /></p>}
      {presented.invitation.meetLink && <p><Redact text={presented.invitation.meetLink} /></p>}
      {state && !state.eligible && <p role="status">This account and sender do not identify a supported RSVP. No reply is authorized.</p>}
      <p role="note">Sender identity is unverified. The sender and organizer fields can be forged.</p>
      {presented.invitation.attendees.map(person => <p key={person.email}><Address value={person.email} />: {person.response}</p>)}
      {state?.review?.current && <div aria-label="Current local event">
        <h3>Current local event</h3>
        <p><Redact text={state.review.current.title} /></p><p>{eventWhen(state.review.current)}</p>
        <p><Redact text={state.review.current.location || ""} /></p><p><Redact text={state.review.current.description || ""} /></p>
        <p>Organizer: <Address value={state.review.current.organizer || ""} /></p>
        {state.review.current.attendees.map(person => <p key={person.email}><Address value={person.email} />: {person.response}</p>)}
        <p><Redact text={state.review.current.meetLink || ""} /></p>
        {state.review.current.myResponse && <p>Your response: {state.review.current.myResponse}</p>}
        <p>{state.review.current.cancelled ? "Cancelled" : "Active"}</p>
        <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed this event and the proposed changes from an unverified sender.</label>
      </div>}
      {state?.google?.myResponse && <p>Your Google response: {state.google.myResponse}</p>}
      {presented.invitation.method === "REQUEST" ? <>
        {state?.eligible && state.google ? <CalendarActions key={`${state.google.id}:${state.fingerprint}`} event={state.google} api={api} google invitation={{ mailId: mail.id, fingerprint: state.fingerprint }} onChanged={onChanged} /> : <p>No unique cached Google event matches. You can prepare a local response draft.</p>}
        <p>Local response saves an Emc² event and opens a reply for review. Nothing is sent automatically.</p>
        <div className="form-actions">{answers.map(([label, value]) => <button key={value} type="button" disabled={pending || !state?.eligible || !onOpenDraft || !!state?.review?.current && !reviewed} onClick={() => void run(value)}>{label} and prepare reply draft</button>)}</div>
      </> : <><p>{presented.invitation.method === "CANCEL" ? "Cancellation received. Review before applying it." : "Attendee response received. Review before applying it."}</p><button type="button" disabled={pending || !state?.eligible || !reviewed} onClick={() => void run()}>Apply to matching local event</button></>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
