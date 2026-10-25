import { createGoogleMeeting, googleRSVP, GoogleCalendarWriteError, calendarWindowId, syncGoogleCalendar } from "./google-calendar.js";
import { trackMailWork } from "./mail-actions.js";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import type { CalendarEvent } from "../shared/calendar.js";
import { CALENDAR_RANGE_DAYS, EVENT_MAX_DAYS } from "../shared/calendar.js";
import { CalendarBusyError, checkedSession, hasSession, localBusy } from "./calendar-busy.js";
import { openCommitment } from "../shared/commitment-dates.js";
import { validDate } from "../shared/commitment-dates.js";
import { all, get, put, remove, transaction } from "./store.js";

class CalendarError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const fail = (status: number, message: string): never => { throw new CalendarError(status, message); };
const dayMs = 86400000;
const instant = z.iso.datetime({ offset: true });
const day = z.string().refine(validDate, "Choose a valid calendar date.");
const https = z.url({ protocol: /^https$/ }).max(2000);
const eventInput = z.object({
  title: z.string().trim().min(1).max(300),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  accountId: z.string().min(1).max(200).optional(),
  location: z.string().trim().max(300).optional(),
  description: z.string().max(5000).optional(),
  meetLink: https.optional(),
  attendees: z.array(z.email().max(320)).max(50).default([]),
  sourceMailId: z.string().min(1).max(300).optional(),
}).strict();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const bounds = (input: { start: string; end: string; allDay: boolean }) => {
  const parse = input.allDay ? day : instant;
  if (!parse.safeParse(input.start).success || !parse.safeParse(input.end).success)
    fail(400, input.allDay ? "All-day events need start and end dates." : "Timed events need start and end times.");
  const start = Date.parse(input.allDay ? `${input.start}T00:00:00Z` : input.start);
  const end = Date.parse(input.allDay ? `${input.end}T00:00:00Z` : input.end);
  if (!(end > start)) fail(400, "The event must end after it starts.");
  if (end - start > EVENT_MAX_DAYS * dayMs) fail(400, `Events can last at most ${EVENT_MAX_DAYS} days.`);
  return { start, end };
};
// An edit may keep a source email that has since left the cache.
function checked(value: unknown, current?: CalendarEvent) {
  const input = eventInput.parse(value);
  bounds(input);
  if (input.accountId && !get("account", input.accountId)) fail(400, "Choose a connected account.");
  const mail = input.sourceMailId ? get("mail", input.sourceMailId) : undefined;
  if (input.sourceMailId && !mail && input.sourceMailId !== current?.sourceMailId) fail(400, "The linked email is no longer available.");
  if (input.sourceMailId && (!input.accountId || (mail ? mail.accountId : current?.accountId) !== input.accountId)) fail(400, "The linked email belongs to another account.");
  const seen = new Set<string>();
  const attendees = input.attendees.filter((email) => !seen.has(email.toLowerCase()) && Boolean(seen.add(email.toLowerCase()))).map((email) => ({ email }));
  return { ...input, accountId: input.accountId, sourceMailId: input.sourceMailId, meetLink: input.meetLink, attendees, location: input.location || undefined, description: input.description || undefined };
}
const fields = ["title", "start", "end", "allDay", "accountId", "location", "description", "meetLink", "sourceMailId"] as const;
const same = (event: CalendarEvent, input: ReturnType<typeof checked>) =>
  fields.every((key) => event[key] === input[key]) && JSON.stringify(event.attendees) === JSON.stringify(input.attendees);
// Overlap uses UTC day edges for all-day events; the renderer filters exact local days.
const span = (event: CalendarEvent) => event.allDay
  ? { start: Date.parse(`${event.start}T00:00:00Z`) - dayMs / 2, end: Date.parse(`${event.end}T00:00:00Z`) + dayMs / 2 }
  : { start: Date.parse(event.start), end: Date.parse(event.end) };

const rangeInput = z.object({ from: instant, to: instant }).strict();
function calendarRange(value: unknown) {
  const range = rangeInput.parse(value);
  const start = Date.parse(range.from), end = Date.parse(range.to);
  if (!(end > start) || end - start > CALENDAR_RANGE_DAYS * dayMs) fail(400, `Request at most ${CALENDAR_RANGE_DAYS} days.`);
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), start, end };
}

const parentId = z.string().min(1).max(300);
const sessionTimes = z.object({ start: instant, end: instant, busy: z.boolean(), timeZone: z.string().min(1).max(100).refine(value => {
  try { if (/^[+-]/.test(value)) return false; new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}) });
const sessionCreate = sessionTimes.extend({ id: z.uuid(), commitmentId: parentId, commitmentRevision: revision }).strict();
const sessionEdit = sessionTimes.extend({ revision, commitmentRevision: revision }).strict();
function parentState(id: string, binding?: CalendarEvent) {
  const parent = get("commitment", id);
  const account = parent && get("account", parent.accountId), mail = parent && get("mail", parent.sourceMailId);
  const available = !!parent && openCommitment(parent) && !!account && !!mail && mail.accountId === parent.accountId &&
    (!binding || binding.accountId === parent.accountId && binding.sourceMailId === parent.sourceMailId);
  return { parent, available, reason: available ? undefined : "Task is closed or its source/account is unavailable or changed. Scheduling is paused; local finish and removal remain available." };
}
function schedulingParent(id: string, expected: number, binding?: CalendarEvent) {
  const current = parentState(id, binding);
  if (!current.available || !current.parent) return fail(409, current.reason!);
  if (current.parent.revision !== expected) return fail(409, "Task changed. Refresh and review it before scheduling.");
  return current.parent;
}
function savedSession(id: string, expected?: number) {
  const event = get("calendarEvent", id);
  if (!event || !hasSession(event)) return fail(404, "Work session not found.");
  checkedSession(event);
  if (expected !== undefined && event.revision !== expected) return fail(409, "Work session changed. Read its saved state before continuing.");
  return event;
}
function checkSessionTimes(input: z.infer<typeof sessionTimes>, excludeId?: string) {
  const interval = bounds({ ...input, allDay: false });
  // Read and validate all local metadata even for Free. Free explicitly permits overlap.
  const busy = localBusy(input.timeZone, excludeId);
  if (input.busy && busy.some(value => Date.parse(value.start) < interval.end && Date.parse(value.end) > interval.start))
    fail(409, "This time overlaps a busy local event. Google calendars are excluded. Choose another time or Free.");
}

export function mountCalendar(app: express.Express) {
  const router = express.Router();
  router.get("/calendar/work-sessions", (req, res) => {
    const { commitmentId } = z.object({ commitmentId: parentId }).strict().parse(req.query);
    const state = parentState(commitmentId);
    const sessions = all("calendarEvent").filter(event => hasSession(event) && checkedSession(event).commitmentId === commitmentId && event.workSession!.status !== "removed");
    const available = state.available && sessions.every(event => parentState(commitmentId, event).available);
    res.json({ sessions: sessions.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)), available, reason: available ? undefined : state.reason || "Session source/account changed. Review saved work before scheduling." });
  });
  router.get("/calendar/work-sessions/:id", (req, res) => { res.json(savedSession(req.params.id)); });
  router.post("/calendar/work-sessions", (req, res) => {
    const input = sessionCreate.parse(req.body);
    const creationInput = createHash("sha256").update(JSON.stringify([input.id, input.commitmentId, input.commitmentRevision, new Date(input.start).toISOString(), new Date(input.end).toISOString(), input.busy, input.timeZone])).digest("hex");
    const result = transaction(() => {
      const current = get("calendarEvent", input.id);
      if (current) {
        if (!hasSession(current) || checkedSession(current).creationInput !== creationInput) return fail(409, "This UUID already belongs to different saved work. Read the saved record.");
        return { event: current, status: 200 };
      }
      const parent = schedulingParent(input.commitmentId, input.commitmentRevision);
      checkSessionTimes(input);
      const event: CalendarEvent = { id: input.id, source: "local", title: parent.text.slice(0, 300), accountId: parent.accountId, sourceMailId: parent.sourceMailId,
        start: new Date(input.start).toISOString(), end: new Date(input.end).toISOString(), allDay: false, attendees: [], revision: 1, updatedAt: Date.now(),
        workSession: { commitmentId: parent.id, status: "planned", busy: input.busy, creationInput } };
      put("calendarEvent", event.id, event); return { event, status: 201 };
    });
    res.status(result.status).json(result.event);
  });
  router.patch("/calendar/work-sessions/:id", (req, res) => {
    const input = sessionEdit.parse(req.body);
    const event = transaction(() => {
      const current = savedSession(req.params.id, input.revision), session = checkedSession(current);
      if (session.status !== "planned") return fail(409, "Only a planned session can move. Removed sessions cannot be restored.");
      schedulingParent(session.commitmentId, input.commitmentRevision, current); checkSessionTimes(input, current.id);
      const next: CalendarEvent = { ...current, start: new Date(input.start).toISOString(), end: new Date(input.end).toISOString(), workSession: { ...session, busy: input.busy }, revision: current.revision + 1, updatedAt: Date.now() };
      put("calendarEvent", next.id, next); return next;
    }); res.json(event);
  });
  const transitionSession = (id: string, expected: number, status: "finished" | "removed") => transaction(() => {
    const current = savedSession(id, expected), session = checkedSession(current);
    if (session.status === "removed" || status === "finished" && session.status !== "planned") return fail(409, "This session is already finished or removed. Read its saved state.");
    const next: CalendarEvent = { ...current, workSession: { ...session, status }, revision: current.revision + 1, updatedAt: Date.now() };
    put("calendarEvent", next.id, next); return next;
  });
  router.post("/calendar/work-sessions/:id/finish", (req, res) => { const input = z.object({ revision }).strict().parse(req.body); res.json(transitionSession(req.params.id, input.revision, "finished")); });
  router.delete("/calendar/work-sessions/:id", (req, res) => { const input = z.object({ revision }).strict().parse(req.body); res.json(transitionSession(req.params.id, input.revision, "removed")); });
  router.get("/calendar/operations", (req, res) => {
    const { eventId } = z.object({ eventId: z.string().min(1).max(300) }).strict().parse(req.query);
    res.json(all("calendarOperation").filter((op) => op.eventId === eventId && get("account", op.accountId) && op.kind.startsWith("google-")).map(({ id, state, kind, requestId, response, result, sourceMailId, sourceFingerprint }) => ({ id, state, kind, requestId, response, result, sourceMailId, sourceFingerprint })));
  });
  router.post("/calendar/events/:id/google", async (req, res) => {
    const input = z.object({ revision, reconcile: z.boolean().optional() }).strict().parse(req.body);
    const event = get("calendarEvent", req.params.id);
    if (event && hasSession(event)) return fail(409, "Work sessions stay local and cannot notify Google.");
    if (!event?.accountId) return fail(409, "Choose a connected Gmail account on this event first.");
    res.json(await trackMailWork(() => createGoogleMeeting(event.accountId!, event.id, input.revision, input.reconcile)));
  });
  router.post("/calendar/google/:accountId/rsvp", async (req, res) => {
    const input = z.object({ eventId: z.string().max(200), response: z.enum(["accepted", "tentative", "declined"]), requestId: z.uuid(), reconcile: z.boolean().optional() }).strict().parse(req.body);
    const matches = new Map<string, CalendarEvent>();
    for (const cache of all("googleCalendarWindow")) if (cache.accountId === req.params.accountId && !cache.stale) for (const event of cache.events) if (event.id === input.eventId) matches.set(event.id, event);
    const event = matches.get(input.eventId);
    if (!event) return fail(409, "Sync this account before responding.");
    res.json(await trackMailWork(() => googleRSVP(req.params.accountId, event, input.response, input.requestId, input.reconcile)));
  });
  router.get("/calendar/events", (req, res) => {
    const { from, to, start, end } = calendarRange(req.query);
    const events = all("calendarEvent").filter((event) => { if (hasSession(event) && checkedSession(event).status === "removed") return false; const value = span(event); return value.start < end && value.end > start; });
    const google = all("account").filter((account) => account.provider === "gmail").map((account) => {
      const connection = get("googleCalendar", account.id);
      const cache = get("googleCalendarWindow", calendarWindowId(account.id, from, to));
      if (cache) events.push(...cache.events);
      return { accountId: account.id, status: !connection ? "not-connected" : connection.error === "api-disabled" ? "api-disabled" : !connection.access ? "needs-consent" : "connected",
        calendars: connection?.calendars || [], selectedIds: connection?.selectedIds, syncedAt: cache?.syncedAt || 0,
        stale: !cache || cache.stale || !connection?.access || !!connection.error, error: connection?.error || cache?.error };
    });
    events.sort((a, b) => span(a).start - span(b).start || a.id.localeCompare(b.id));
    res.json({ events, google });
  });
  router.post("/calendar/google/:accountId/sync", async (req, res) => {
    const { from, to } = calendarRange(req.body);
    const account = get("account", req.params.accountId);
    if (!account || account.provider !== "gmail") return fail(404, "Choose a Gmail account.");
    if (!get("googleCalendar", account.id)?.access) return fail(409, "Connect Google Calendar and grant calendar access first.");
    const ok = await trackMailWork(() => syncGoogleCalendar(account, from, to));
    res.json({ ok });
  });
  router.patch("/calendar/google/:accountId", (req, res) => {
    const { selectedIds } = z.object({ selectedIds: z.array(z.string().min(1).max(1024)).max(20) }).strict().parse(req.body);
    const account = get("account", req.params.accountId);
    const connection = get("googleCalendar", req.params.accountId);
    if (!account || account.provider !== "gmail" || !connection?.access) return fail(409, "Connect Google Calendar first.");
    if (selectedIds.some((id) => !connection.calendars.some((value) => value.id === id))) return fail(400, "Choose calendars from this account.");
    transaction(() => {
      put("googleCalendar", account.id, { ...connection, selectedIds: [...new Set(selectedIds)], generation: randomUUID() });
      for (const cache of all("googleCalendarWindow")) if (cache.accountId === account.id) remove("googleCalendarWindow", calendarWindowId(account.id, cache.from, cache.to));
    });
    res.json({ ok: true });
  });
  // A caller-chosen UUID makes an uncertain create safe to repeat with the same input.
  router.post("/calendar/events", (req, res) => {
    const { id = randomUUID(), ...rest } = z.object({ id: z.uuid().optional() }).passthrough().parse(req.body);
    const input = checked(rest);
    const result = transaction(() => {
      const current = get("calendarEvent", id);
      if (current && hasSession(current)) return fail(409, "Use the work session controls for this saved UUID.");
      if (current) return same(current, input) && current.revision === 1 ? { event: current, status: 200 } : fail(409, "This event was already saved with different details. Refresh the calendar.");
      const event: CalendarEvent = { ...input, id, source: "local", revision: 1, updatedAt: Date.now() };
      put("calendarEvent", event.id, event);
      return { event, status: 201 };
    });
    res.status(result.status).json(result.event);
  });
  router.patch("/calendar/events/:id", (req, res) => {
    const { revision: expected, ...rest } = z.object({ revision }).passthrough().parse(req.body);
    const event = transaction(() => {
      const current = get("calendarEvent", req.params.id);
      if (!current) return fail(404, "Event not found.");
      if (hasSession(current)) return fail(409, "Use the work session controls. Sessions cannot be changed through ordinary events.");
      const input = checked(rest, current);
      if (current.source !== "local") return fail(409, "Edit synced events in their own calendar.");
      if (current.revision !== expected) return fail(409, "Event changed. Refresh before saving.");
      if (current.uid && input.accountId !== current.accountId) return fail(409, "An invited event cannot change accounts.");
      const next: CalendarEvent = { ...current, ...input, id: current.id, source: "local", revision: expected + 1, updatedAt: Date.now() };
      put("calendarEvent", next.id, next);
      return next;
    });
    res.json(event);
  });
  router.delete("/calendar/events/:id", (req, res) => {
    const { revision: expected } = z.object({ revision }).strict().parse(req.body);
    transaction(() => {
      const current = get("calendarEvent", req.params.id);
      if (!current) return fail(404, "Event not found.");
      if (hasSession(current)) return fail(409, "Use the work session controls. Sessions cannot be changed through ordinary events.");
      if (current.source !== "local") return fail(409, "Delete synced events in their own calendar.");
      if (current.revision !== expected) return fail(409, "Event changed. Refresh before deleting.");
      remove("calendarEvent", current.id);
    });
    res.json({ ok: true });
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof CalendarError || error instanceof CalendarBusyError || error instanceof GoogleCalendarWriteError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: "Invalid calendar request. Check fields, times and time zone." });
    else next(error);
  });
  app.use("/api", router);
}
