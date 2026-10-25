import { test } from "node:test";
import assert from "node:assert/strict";
import { dayAxis, instantLabel, rangeMonths, timedLayout, visibleRange } from "./work/calendar-layout";
import type { CalendarEntry } from "./work/Calendar";
import type { CalendarEvent } from "../shared/calendar";

function zone(name: string, run: () => void) {
  const before = process.env.TZ;
  try { process.env.TZ = name; run(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
}
const event = (id: string, start: string, end: string, day = "2026-10-25"): CalendarEntry => ({ kind: "Event", day, at: Date.parse(start), item: { id, start, end, title: id, source: "local", allDay: false, attendees: [], revision: 1, updatedAt: 1 } });

test("visible Day/Week/Month/Agenda bounds use Monday and exact intersecting months", () => zone("America/New_York", () => {
  assert.deepEqual(visibleRange("2026-11-01", "week"), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(rangeMonths(visibleRange("2026-11-01", "week")), ["2026-10", "2026-11"]);
  assert.deepEqual(visibleRange("2028-02-29", "month"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(visibleRange("2026-12-31", "day"), { from: "2026-12-31", to: "2026-12-31" });
  assert.deepEqual(visibleRange("2026-11-01", "agenda"), { from: "2026-11-01", to: "2026-11-30" });
}));
for (const [name, day, minutes] of [
  ["America/New_York", "2026-03-08", 1380], ["America/New_York", "2026-11-01", 1500],
  ["Australia/Lord_Howe", "2026-10-04", 1410], ["Australia/Lord_Howe", "2026-04-05", 1470], ["UTC", "2026-10-25", 1440],
] as const) test(`${name} ${day} axis spans ${minutes} real minutes`, () => zone(name, () => {
  const axis = dayAxis(day);
  assert.equal(axis.minutes, minutes);
  assert.equal(axis.end - axis.start, minutes * 60000);
  assert.equal(axis.ticks.at(-1)?.minute, minutes);
}));
test("fall-back repeated clock ticks show distinct offsets and spring skips missing hours", () => zone("America/New_York", () => {
  const fall = dayAxis("2026-11-01").ticks.filter(tick => tick.label.startsWith("01:00"));
  assert.deepEqual(fall.map(tick => tick.label), ["01:00 UTC−04:00", "01:00 UTC−05:00"]);
  assert.equal(dayAxis("2026-03-08").ticks.some(tick => tick.label.startsWith("02:00")), false);
  const layout = timedLayout([event("fold", "2026-11-01T05:30Z", "2026-11-01T06:30Z", "2026-11-01")], "2026-11-01");
  assert.equal(layout[0].duration, 60);
  assert.match(instantLabel(layout[0].start), /01:30 UTC−04:00/);
  assert.match(instantLabel(layout[0].end), /01:30 UTC−05:00/);
}));
test("half-open clipping uses each day's real midnight, including fractional DST", () => zone("Australia/Lord_Howe", () => {
  const day = "2026-10-04", axis = dayAxis(day);
  const entry = event("overnight", new Date(axis.start-60000).toISOString(), new Date(axis.end+60000).toISOString(), day);
  const result = timedLayout([entry], day)[0];
  assert.equal(result.minute, 0); assert.equal(result.duration, 1410);
  assert.deepEqual(timedLayout([event("edge", new Date(axis.start-60000).toISOString(), new Date(axis.start).toISOString(), day)], day), []);
}));
test("stable overlap lanes share connected groups, and touching edges do not overlap", () => zone("UTC", () => {
  const entries = [event("a", "2026-10-25T09:00Z", "2026-10-25T11:00Z"), event("b", "2026-10-25T09:00Z", "2026-10-25T10:00Z"), event("c", "2026-10-25T10:00Z", "2026-10-25T12:00Z"), event("d", "2026-10-25T12:00Z", "2026-10-25T13:00Z")];
  const compact = (values: CalendarEntry[]) => timedLayout(values,"2026-10-25").map(value => [value.entry.item.id, value.lane, value.lanes]);
  assert.deepEqual(compact(entries), [["a",0,2],["b",1,2],["c",1,2],["d",0,1]]);
  assert.deepEqual(compact([...entries].reverse()), compact(entries));
}));
test("follow-up/snooze points have zero duration; date-only work has no timed span", () => zone("UTC", () => {
  const at = Date.parse("2026-10-25T09:00Z"), day = "2026-10-25";
  const point = { kind: "Follow-up", at, day, item: { id: "task", accountId: "a" } } as CalendarEntry;
  const snooze = { kind: "Snoozed", at, day, item: { id: "mail", accountId: "a" } } as CalendarEntry;
  const dateOnly = { kind: "Deadline", day, item: point.item } as CalendarEntry;
  const allDay = { kind: "Event", day, item: { ...(event("day",day,day).item as CalendarEvent), allDay:true } } as CalendarEntry;
  const result = timedLayout([point,snooze,dateOnly,allDay],day);
  assert.equal(result.length,2); assert.ok(result.every(value => value.duration === 0));
  assert.notEqual(result[0].lane,result[1].lane,"simultaneous point labels need distinct lanes without a duration");
}));
