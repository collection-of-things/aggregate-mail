import type { CalendarEntry } from "./Calendar";
import { localDate } from "../../shared/commitment-dates";

export type CalendarView = "month" | "agenda" | "week" | "day";
export type CalendarRange = { from: string; to: string };
export function shiftDay(day: string, count: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + count);
  return localDate(date);
}
export function visibleRange(day: string, view: CalendarView): CalendarRange {
  if (view === "day") return { from: day, to: day };
  if (view === "week") {
    const from = shiftDay(day, -(new Date(`${day}T12:00:00`).getDay() + 6) % 7);
    return { from, to: shiftDay(from, 6) };
  }
  const first = new Date(`${day.slice(0, 7)}-01T12:00:00`);
  return { from: localDate(first), to: localDate(new Date(first.getFullYear(), first.getMonth() + 1, 0, 12)) };
}
export function rangeMonths(range: CalendarRange) {
  return [...new Set([range.from.slice(0, 7), range.to.slice(0, 7)])];
}
export function rangeDays(range: CalendarRange) {
  const days: string[] = [];
  for (let day = range.from; day <= range.to; day = shiftDay(day, 1)) days.push(day);
  return days;
}
export function instantLabel(at: number) {
  const date = new Date(at), offset = -date.getTimezoneOffset();
  return `${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}
export function dayAxis(day: string) {
  const start = new Date(`${day}T00:00:00`).getTime();
  const end = new Date(`${shiftDay(day, 1)}T00:00:00`).getTime();
  const minutes = (end - start) / 60000;
  const ticks: { minute: number; label: string }[] = [];
  for (let minute = 0; minute < minutes; minute += 60) ticks.push({ minute, label: instantLabel(start + minute * 60000) });
  ticks.push({ minute: minutes, label: instantLabel(end) });
  return { start, end, minutes, ticks };
}
export const entryIdentity = (entry: CalendarEntry) => JSON.stringify([entry.kind, entry.item.accountId || "", entry.kind === "Event" ? entry.item.source : "", entry.kind === "Event" ? entry.item.calendarId || "" : "", entry.item.id, entry.day]);
export type TimedEntry = { entry: CalendarEntry; start: number; end: number; minute: number; duration: number; lane: number; lanes: number };
// All placement uses elapsed instants. Point markers never acquire a busy interval.
export function timedLayout(entries: CalendarEntry[], day: string): TimedEntry[] {
  const axis = dayAxis(day);
  const values: TimedEntry[] = entries.filter(entry => entry.day === day && entry.at !== undefined).flatMap(entry => {
    const point = entry.kind !== "Event";
    const start = Math.max(axis.start, entry.at!);
    const end = entry.kind === "Event" ? Math.min(axis.end, Date.parse(entry.item.end)) : start;
    return start >= axis.end || end < axis.start || (!point && end <= start) ? [] : [{ entry, start, end, minute: (start - axis.start) / 60000, duration: (end - start) / 60000, lane: 0, lanes: 1 }];
  }).sort((a, b) => a.start - b.start || b.end - a.end || entryIdentity(a.entry).localeCompare(entryIdentity(b.entry)));
  let group: TimedEntry[] = [], until = -Infinity;
  const finish = () => { const lanes = Math.max(1, ...group.map(value => value.lane + 1)); group.forEach(value => { value.lanes = lanes; }); group = []; };
  for (const value of values) {
    if (value.start >= until && !group.some(other => other.start === value.start)) finish();
    const occupied = new Set(group.filter(other => other.end > value.start || other.start === value.start).map(other => other.lane));
    while (occupied.has(value.lane)) value.lane++;
    group.push(value); until = Math.max(...group.map(value => value.end));
  }
  finish();
  return values;
}
