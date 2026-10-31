import { useContext, useEffect, useMemo, useState } from "react";
import { sessionLabel } from "../../shared/calendar";
import type { CalendarEvent } from "../../shared/calendar";
import { eventDays, eventTime } from "../../shared/calendar";
import type { RendererMail as Mail } from "../../shared/types";
import type { Commitment } from "../../shared/workspace";
import { deadlineDate, localDate, openCommitment } from "../../shared/commitment-dates";
import { MailPrivacy, PrivacyContext, Redact } from "../ui/Privacy";
import { ArrowLeft, ArrowRight } from "../ui/icons";
import { dayAxis, entryIdentity, instantLabel, rangeDays, timedLayout, visibleRange, type CalendarRange, type CalendarView } from "./calendar-layout";

export type CalendarEntry = { item: Commitment; day: string; kind: "Deadline" | "Follow-up" | "No deadline"; at?: number } | { item: Mail; day: string; kind: "Snoozed"; at: number }
  | { item: CalendarEvent; day: string; kind: "Event"; at?: number };

export function calendarEntries(items: Commitment[], messages: Mail[] = [], now = Date.now(), events: CalendarEvent[] = [], window?: { from: string; to: string }): CalendarEntry[] {
  const today = localDate(new Date(now));
  const work: CalendarEntry[] = items.filter(openCommitment).flatMap((item) => {
    const entries: CalendarEntry[] = [];
    const deadline = deadlineDate(item);
    if (deadline) entries.push({ item, day: deadline, kind: "Deadline" });
    if (item.followUpAt !== undefined) entries.push({ item, day: localDate(new Date(item.followUpAt)), kind: "Follow-up", at: item.followUpAt });
    // Open work without a date stays on today until it is scheduled or closed.
    if (!entries.length) entries.push({ item, day: today, kind: "No deadline" });
    return entries;
  });
  const snoozed: CalendarEntry[] = messages.filter((mail) => !mail.archived && mail.direction !== "sent" && mail.snoozedUntil !== null && mail.snoozedUntil > now)
    .map((item) => ({ item, day: localDate(new Date(item.snoozedUntil!)), kind: "Snoozed", at: item.snoozedUntil! }));
  // A multi-day event appears on each local day it covers; all-day events sort before timed ones.
  const meetings: CalendarEntry[] = events.filter(event => event.workSession?.status !== "removed").flatMap((item) => eventDays(item, window).map((day) => ({ item, day, kind: "Event" as const, at: item.allDay ? undefined : Date.parse(item.start) })));
  return [...meetings, ...work, ...snoozed].sort((a, b) => a.day.localeCompare(b.day) || (a.at ?? 0) - (b.at ?? 0) || a.item.id.localeCompare(b.item.id));
}

export function monthDays(month: string) {
  const first = new Date(`${month}-01T12:00:00`);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { offset: (first.getDay() + 6) % 7, days };
}

const shortTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function Calendar({ items, messages = [], events = [], now, selectedEventId, jump, onSelect, onOpenMail, onSelectEvent, onNewEvent, onRangeChange }: {
  items: Commitment[]; messages?: Mail[]; events?: CalendarEvent[]; now: number; selectedEventId?: string; jump?: { day: string; key: number };
  onSelect: (id: string, origin: HTMLButtonElement) => void; onOpenMail?: (mail: Mail, origin: HTMLButtonElement) => void; onSelectEvent?: (event: CalendarEvent, origin: HTMLElement) => void;
  onNewEvent?: (day: string) => void; onRangeChange?: (range: CalendarRange) => void;
}) {
  const today = localDate(new Date(now));
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<CalendarView>("month");
  const range = useMemo(() => visibleRange(day, view), [day, view]);
  const { on: privacy } = useContext(PrivacyContext);
  useEffect(() => { onRangeChange?.(range); }, [range.from, range.to, onRangeChange]);
  // A saved event brings its first day into view.
  useEffect(() => { if (jump) { setDay(jump.day); setMonth(jump.day.slice(0, 7)); } }, [jump?.key]);
  const entries = useMemo(() => calendarEntries(items, messages, now, events, range), [items, messages, now, events, range]);
  const { offset, days } = monthDays(month);
  const scheduleDays = rangeDays(range);
  const maxMinutes = view === "day" || view === "week" ? Math.max(...scheduleDays.map(day => dayAxis(day).minutes)) : 0;
  const overdue = entries.filter((entry) => entry.kind === "Deadline" ? entry.day < today : entry.kind !== "No deadline" && entry.kind !== "Event" && entry.at! < now);
  const move = (delta: number) => {
    const next = new Date(`${view === "month" || view === "agenda" ? `${month}-01` : day}T12:00:00`);
    if (view === "day" || view === "week") next.setDate(next.getDate() + delta * (view === "week" ? 7 : 1));
    else next.setMonth(next.getMonth() + delta);
    const value = localDate(next);
    setMonth(value.slice(0, 7)); setDay(value);
  };
  const entryList = (values: CalendarEntry[]) => values.length ? <ul className="calendar-agenda">{values.map((entry) => <li key={entryIdentity(entry)}>
    <button type="button" className={entry.kind === "Event" ? "calendar-event" : undefined} aria-pressed={entry.kind === "Event" ? entry.item.id === selectedEventId : undefined}
      onClick={(event) => entry.kind === "Snoozed" ? onOpenMail?.(entry.item, event.currentTarget) : entry.kind === "Event" ? onSelectEvent?.(entry.item, event.currentTarget) : onSelect(entry.item.id, event.currentTarget)}>
      <span className="work-meta">{entry.day} · {entry.kind === "Event" ? sessionLabel(entry.item) : entry.kind}{entry.kind === "Event" ? ` · ${eventTime(entry.item)}` : entry.at === undefined ? "" : ` · ${shortTime(entry.at)}`}</span>
      <strong>{entry.kind === "Snoozed" ? <MailPrivacy mail={entry.item}><Redact text={entry.item.subject || "No subject"} /></MailPrivacy> : entry.kind === "Event" ? <Redact text={entry.item.title} /> : <Redact text={entry.item.text} />}</strong>
    </button>
  </li>)}</ul> : <p className="work-empty">Nothing scheduled.</p>;
  return <section className="work-calendar" data-layout={view} aria-label="Calendar">
    <div className="calendar-toolbar">
      <div className="calendar-period"><button type="button" className="icon" aria-label={`Previous ${view === "agenda" ? "month" : view}`} onClick={() => move(-1)}><ArrowLeft size={16} /></button>
        <h2>{view === "month" || view === "agenda" ? new Date(`${month}-01T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" }) : range.from === range.to ? range.from : `${range.from} – ${range.to}`}</h2>
        <button type="button" className="icon" aria-label={`Next ${view === "agenda" ? "month" : view}`} onClick={() => move(1)}><ArrowRight size={16} /></button></div>
      <div className="work-controls"><button type="button" onClick={() => { setDay(today); setMonth(today.slice(0, 7)); }}>Today</button>
        {(["month", "week", "day", "agenda"] as const).map(value => <button type="button" key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        {onNewEvent && <button type="button" className="button" onClick={() => onNewEvent(day.startsWith(month) ? day : `${month}-01`)}>New event</button>}</div>
    </div>
    {view === "day" || view === "week" ? <>
      <p className="work-meta">Device local time. Spans show elapsed duration; follow-ups and snoozes are points. Open entries below the schedule.</p>
      <div className="calendar-schedule" role="region" aria-label={`${view === "week" ? "Week" : "Day"} schedule`} tabIndex={0}>
        <div className={`calendar-schedule-columns calendar-columns-${view}`}>
          {scheduleDays.map(value => {
            const axis = dayAxis(value), layout = timedLayout(entries, value);
            return <section className="calendar-schedule-day" key={value} data-day={value} aria-label={value}>
              <h3>{new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</h3>
              <div className="calendar-date-only"><h4>Date-only / All-day</h4>{entryList(entries.filter(entry => entry.day === value && entry.at === undefined && entry.kind !== "No deadline"))}</div>
              <div className="calendar-axis" style={{ height: `calc(${maxMinutes / 60} * 4.5rem)` }} aria-hidden="true">
                {axis.ticks.map(tick => <span key={tick.minute} className="calendar-tick" style={{ top: `calc(${tick.minute / 60} * 4.5rem)` }}>{tick.label}</span>)}
                {axis.minutes < maxMinutes && <span className="calendar-outside-day" style={{ top: `calc(${axis.minutes / 60} * 4.5rem)`, bottom: 0 }}>Outside this day</span>}
                <div className="calendar-spans">{layout.map(value => <span key={entryIdentity(value.entry)} className={value.duration ? "calendar-span" : "calendar-point"}
                  style={{ top: `calc(${value.minute / 60} * 4.5rem)`, height: `calc(${value.duration / 60} * 4.5rem)`, left: `${value.lane / value.lanes * 100}%`, width: `${100 / value.lanes}%` }}>
                  {value.entry.kind === "Event" ? <Redact text={value.entry.item.title} /> : value.entry.kind}
                </span>)}</div>
              </div>
              <div className="calendar-timed-list"><h4>Timed entries</h4>{layout.length ? <ul className="calendar-agenda">{layout.map(({ entry, start, end, duration }) => <li key={entryIdentity(entry)}>
                <button type="button" className="calendar-timed-entry" aria-pressed={entry.kind === "Event" ? entry.item.id === selectedEventId : undefined}
                  onClick={event => entry.kind === "Event" ? onSelectEvent?.(entry.item, event.currentTarget) : entry.kind === "Snoozed" ? onOpenMail?.(entry.item, event.currentTarget) : onSelect(entry.item.id, event.currentTarget)}>
                  <span className="work-meta">{entry.kind === "Event" ? sessionLabel(entry.item) : entry.kind} · {instantLabel(start)}{entry.kind === "Event" ? ` – ${instantLabel(end)} · ${duration} min on this day` : " · Point"}</span>
                  <strong>{entry.kind === "Event" ? <Redact text={entry.item.title} /> : entry.kind === "Snoozed" ? <MailPrivacy mail={entry.item}><Redact text={entry.item.subject || "No subject"} /></MailPrivacy> : <Redact text={entry.item.text} />}</strong>
                </button></li>)}</ul> : <p className="work-empty">Nothing timed.</p>}</div>
            </section>;
          })}
        </div>
      </div>
      <h3>No deadline</h3>{entryList(entries.filter(entry => entry.kind === "No deadline" && entry.day >= range.from && entry.day <= range.to))}
    </> : view === "agenda" ? entryList(entries.filter((entry) => entry.day.startsWith(month))) : <>
      <div className="calendar-grid" aria-label="Choose a day">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <span className="calendar-weekday" key={name}>{name}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`blank:${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const value = `${month}-${String(index + 1).padStart(2, "0")}`;
          const dayEntries = entries.filter((entry) => entry.day === value);
          const meetings = dayEntries.filter((entry) => entry.kind === "Event");
          const count = dayEntries.length;
          // One preview keeps the month compact; the day list contains every entry.
          return <button type="button" key={value} aria-label={`${value}, ${count} scheduled`} aria-pressed={day === value} aria-current={value === today ? "date" : undefined} onClick={() => setDay(value)}>
            <span className="calendar-day-heading"><span>{index + 1}</span>{count > 0 && <small aria-hidden="true">{count}</small>}</span>
            {meetings.length > 0 && <span className="calendar-chips" aria-hidden="true">{meetings.slice(0, 1).map((entry) => <span className="calendar-chip" key={entry.item.id}>
              {entry.item.allDay ? "" : `${shortTime(Date.parse(entry.item.start))} `}{privacy ? entry.item.workSession ? "Work session" : "Event" : `${entry.item.workSession ? "Work session: " : ""}${entry.item.title}`}</span>)}
            </span>}
          </button>;
        })}
      </div>
      <h3 className="calendar-day-title">{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h3>
      {entryList(entries.filter((entry) => entry.day === day))}
    </>}
    <details className="calendar-backlog"><summary>Overdue ({overdue.length})</summary>{entryList(overdue)}</details>
  </section>;
}
