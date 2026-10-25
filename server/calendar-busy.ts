import { z } from "zod";
import type { CalendarEvent } from "../shared/calendar.js";
import type { BusyPeriod } from "../shared/availability.js";
import { validDate } from "../shared/commitment-dates.js";
import { all } from "./store.js";

export class CalendarBusyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const hasSession = (event: CalendarEvent) => Object.hasOwn(event, "workSession");
const metadata = z.object({ commitmentId: z.string().min(1).max(300), busy: z.boolean(), status: z.enum(["planned", "finished", "removed"]), creationInput: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function checkedSession(event: CalendarEvent) {
  const parsed = metadata.safeParse(event.workSession);
  if (!parsed.success || event.source !== "local" || event.allDay || !event.accountId || !event.sourceMailId || event.attendees.length ||
    [event.remoteId, event.calendarId, event.calendarName, event.htmlLink, event.meetLink, event.uid, event.organizer, event.sequence, event.myResponse, event.cancelled].some(value => value !== undefined) ||
    !z.iso.datetime({ offset: true }).safeParse(event.start).success || !z.iso.datetime({ offset: true }).safeParse(event.end).success || !(Date.parse(event.end) > Date.parse(event.start)))
    throw new CalendarBusyError(409, "Work session metadata is unavailable. Scheduling is paused; review saved work.");
  return parsed.data;
}
// Earliest instant of a date in the chosen zone, including midnight DST changes.
// A skipped calendar date has no boundary and is rejected.
export function zonedDayStart(day: string, timeZone: string) {
  z.string().refine(validDate).parse(day);
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "iso8601", year: "numeric", month: "2-digit", day: "2-digit" });
  const local = (at: number) => {
    const parts = Object.fromEntries(format.formatToParts(at).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const nominal = Date.parse(`${day}T00:00:00Z`);
  let low = nominal - 36 * 3600000, high = nominal + 36 * 3600000;
  while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (local(mid) < day) low = mid; else high = mid; }
  if (local(high) !== day) throw new CalendarBusyError(400, "This calendar date does not exist in the chosen time zone.");
  return new Date(high).toISOString();
}
// Ordinary events retain their legacy busy meaning. Invalid session metadata never implies free.
export function localBusy(timeZone: string, excludeId?: string): BusyPeriod[] {
  const events = all("calendarEvent").filter(event => {
    if (hasSession(event)) {
      const session = checkedSession(event);
      return event.id !== excludeId && session.status === "planned" && session.busy;
    }
    return event.id !== excludeId && !event.cancelled && event.myResponse !== "declined";
  });
  if (events.length > 10000) throw new CalendarBusyError(409, "Too many local events to check availability safely.");
  return events.map(event => event.allDay ? { start: zonedDayStart(event.start, timeZone), end: zonedDayStart(event.end, timeZone) } : { start: event.start, end: event.end });
}
