import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "../../shared/calendar";
import type { Account } from "../../shared/types";
import { request } from "../api";
import { modules } from "../shell/Sidebar";
import { Empty, Page } from "../ui/Page";
import { Tabs } from "../ui/Tabs";
import { PlusIcon, TrashIcon } from "../ui/icons";
import { useOutsidePress, usePresence } from "../ui/presence";
import { groupBy } from "../ui/time";
import { useNotice } from "./useWorkspace";

const day = 86400000;
const startOf = (event: CalendarEvent) => event.allDay ? new Date(`${event.start}T00:00:00`).getTime() : Date.parse(event.start);
const endOf = (event: CalendarEvent) => event.allDay ? new Date(`${event.end}T00:00:00`).getTime() : Date.parse(event.end);
const dayName = (time: number) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(time).setHours(0, 0, 0, 0) - today.getTime()) / day);
  const label = new Date(time).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  return diff === 0 ? `Today · ${label}` : diff === 1 ? `Tomorrow · ${label}` : diff === -1 ? `Yesterday · ${label}` : label;
};
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const localDate = (time = Date.now()) => { const date = new Date(time); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

/** Calendar: an agenda of the next eight weeks (and the past week), with local events you can add or delete. */
export function CalendarPage({ accounts, accountFilter, csrf }: { accounts: Account[]; accountFilter: string; csrf: string }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [tab, setTab] = useState("upcoming");
  const [notice, setNotice] = useNotice();
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const query = new URLSearchParams({ from: new Date(now.getTime() - 7 * day).toISOString(), to: new Date(now.getTime() + 55 * day).toISOString() });
    return request<{ events: CalendarEvent[] }>(`/api/calendar/events?${query}`).then((data) => setEvents(data.events)).catch((reason: Error) => setNotice(reason.message));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  // Sorted locally: all-day dates are local days, which the server orders as UTC.
  const all = (events ?? []).filter((event) => accountFilter === "all" || !event.accountId || event.accountId === accountFilter)
    .sort((a, b) => startOf(a) - startOf(b) || a.title.localeCompare(b.title));
  const upcoming = all.filter((event) => endOf(event) > now);
  const past = all.filter((event) => endOf(event) <= now).reverse();
  const shown = tab === "upcoming" ? upcoming : past;
  const groups = groupBy(shown, (event) => dayName(startOf(event)));
  const names = new Map(accounts.map((account) => [account.id, account.name || account.email]));
  const remove = async (event: CalendarEvent) => {
    try {
      await request(`/api/calendar/events/${encodeURIComponent(event.id)}`, { method: "DELETE", csrf, body: { revision: event.revision } });
      await load();
      setNotice("Event deleted.");
    } catch (reason) {
      setNotice((reason as Error).message);
    }
  };
  const Icon = modules.calendar.icon;
  return (
    <Page section="Workspace" icon={<Icon />} title="Calendar" notice={notice}
      actions={<NewEvent open={creating} onToggle={() => setCreating(!creating)} onClose={() => setCreating(false)} csrf={csrf}
        accountId={accountFilter === "all" ? undefined : accountFilter} onCreated={async () => { setCreating(false); await load(); setTab("upcoming"); setNotice("Event added."); }} />}>
      <Tabs tabs={[{ id: "upcoming", label: "Upcoming", count: upcoming.length }, { id: "past", label: "Past week", count: past.length }]} value={tab} onChange={setTab} label="Calendar range" />
      <section className="item-list full" aria-label="Events">
        {events && !shown.length && <Empty title={tab === "upcoming" ? "Nothing scheduled" : "Nothing last week"}>New event adds one; invitations you accept show up here.</Empty>}
        {groups.map((group) => (
          <div key={group.name} className="item-group">
            <h2 className="item-group-name">{group.name}</h2>
            {group.items.map((event) => (
              <div key={event.id} className="item-row event">
                <span className="event-time">{event.allDay ? "All day" : <>{clock(startOf(event))}<span>{clock(endOf(event))}</span></>}</span>
                <span className="event-bar" aria-hidden="true" />
                <span className="item-text">
                  <span className="item-title">{event.title}</span>
                  <span className="item-preview">{[event.location, event.attendees.length ? `${event.attendees.length} guest${event.attendees.length === 1 ? "" : "s"}` : "", event.calendarName].filter(Boolean).join(" · ") || "No location"}</span>
                </span>
                <span className="item-meta">
                  {event.accountId && accounts.length > 1 && <span className="tag">{names.get(event.accountId)}</span>}
                  {event.source === "local" && <DeleteEvent onDelete={() => void remove(event)} />}
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>
    </Page>
  );
}

function DeleteEvent({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, 140);
  useOutsidePress(open, [area], () => setOpen(false));
  return (
    <div ref={area} className="popover-anchor">
      <button type="button" className="icon-button row-action" aria-label="Delete event" title="Delete event" onClick={() => setOpen(!open)}><TrashIcon /></button>
      {presence.mounted && (
        <div className={`popover menu-popover right${presence.closing ? " closing" : ""}`} role="alertdialog">
          <p className="popover-title">Delete this event?</p>
          <div className="popover-actions">
            <button type="button" className="popover-button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="popover-button danger" autoFocus onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewEvent({ open, onToggle, onClose, csrf, accountId, onCreated }: {
  open: boolean; onToggle: () => void; onClose: () => void; csrf: string; accountId?: string; onCreated: () => Promise<void>;
}) {
  const area = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, 140);
  useOutsidePress(open, [area], onClose);
  const [form, setForm] = useState({ title: "", date: localDate(), start: "10:00", end: "10:30", allDay: false, location: "" });
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    const start = form.allDay ? form.date : new Date(`${form.date}T${form.start}`).toISOString();
    const end = form.allDay ? localDate(new Date(`${form.date}T12:00:00`).getTime() + day) : new Date(`${form.date}T${form.end}`).toISOString();
    try {
      await request("/api/calendar/events", { method: "POST", csrf, body: { title: form.title.trim(), start, end, allDay: form.allDay, ...(form.location.trim() ? { location: form.location.trim() } : {}), ...(accountId ? { accountId } : {}) } });
      setForm({ ...form, title: "", location: "" });
      await onCreated();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <div ref={area} className="popover-anchor">
      <button type="button" className="ghost-button" aria-expanded={open} onClick={onToggle}><PlusIcon />New event</button>
      {presence.mounted && (
        <form className={`popover menu-popover right form-popover${presence.closing ? " closing" : ""}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <p className="popover-title">New event</p>
          <label className="popover-field"><span>Title</span><input autoFocus required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label className="popover-field"><span>Date</span><input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          {!form.allDay && (
            <div className="popover-row">
              <label className="popover-field"><span>From</span><input type="time" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} /></label>
              <label className="popover-field"><span>To</span><input type="time" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} /></label>
            </div>
          )}
          <label className="popover-field"><span>Place</span><input value={form.location} placeholder="Optional" onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
          <label className="popover-check"><input type="checkbox" checked={form.allDay} onChange={(event) => setForm({ ...form, allDay: event.target.checked })} />All day</label>
          {error && <p className="form-error">{error}</p>}
          <div className="popover-actions">
            <button type="button" className="popover-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="popover-button primary" disabled={!form.title.trim()}>Add event</button>
          </div>
        </form>
      )}
    </div>
  );
}
