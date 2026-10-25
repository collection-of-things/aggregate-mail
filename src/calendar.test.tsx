import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarEntries, monthDays } from "./work/Calendar";
import { deadlineDate, localDate, localTimeInput, validDate } from "../shared/commitment-dates";
import type { Commitment } from "../shared/workspace";

const item: Commitment = { id: "c", accountId: "a", sourceMailId: "m", text: "Deliver proposal", reason: "Confirmed promise", status: "needs-work", evidenceMailIds: ["m"], revision: 1, updatedAt: 1, history: [] };

test("date-only deadlines retain their chosen day across timezones and legacy records", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = timezone;
      assert.equal(deadlineDate({ dueAt: Date.parse("2026-10-16T12:00:00Z") }), "2026-10-16");
      assert.equal(deadlineDate({ dueDate: "2028-02-29" }), "2028-02-29");
      const at = new Date("2026-10-16T16:30:00").getTime();
      assert.equal(localTimeInput(at), "2026-10-16T16:30");
      assert.equal(localDate(new Date(at)), "2026-10-16");
    }
    assert.equal(validDate("2028-02-29"), true); assert.equal(validDate("2027-02-29"), false);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("calendar separates deadlines from local timed follow-ups, keeps undated open work on today and omits closed work", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const entries = calendarEntries([{ ...item, dueDate: "2026-10-16", followUpAt: Date.parse("2026-10-16T01:00:00Z") }, { ...item, id: "done", status: "done", dueDate: "2026-10-16" }, { ...item, id: "cancelled", status: "cancelled", followUpAt: 1 }, { ...item, id: "undated" }], [], Date.parse("2026-10-14T16:00:00Z"));
    assert.deepEqual(entries.map(({ day, kind, item }) => ({ day, kind, id: item.id })), [{ day: "2026-10-14", kind: "No deadline", id: "undated" }, { day: "2026-10-15", kind: "Follow-up", id: "c" }, { day: "2026-10-16", kind: "Deadline", id: "c" }]);
    assert.equal(entries[1].at, Date.parse("2026-10-16T01:00:00Z"));
    assert.deepEqual(monthDays("2028-02"), { offset: 1, days: 29 });
    assert.deepEqual(monthDays("2027-02"), { offset: 0, days: 28 });
    assert.deepEqual(monthDays("2026-11"), { offset: 6, days: 30 });
    assert.deepEqual(monthDays("2027-01"), { offset: 4, days: 31 });
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("snoozed mail follows the local return time and disappears on unsnooze, expiry or archive", () => {
  const now = new Date("2026-10-20T09:00").getTime();
  const mail = {id:"m",accountId:"a",subject:"Reply later",snoozedUntil:now+3600000,archived:false} as import("../shared/types").Mail;
  const entries = calendarEntries([{...item,dueDate:"2026-12-01"}], [mail], now);
  assert.deepEqual(entries.filter((entry)=>entry.kind==="Snoozed").map(({day,kind,at})=>({day,kind,at})), [{day:localDate(new Date(now)),kind:"Snoozed",at:now+3600000}]);
  const later=now+86400000;
  assert.equal(calendarEntries([], [{...mail,snoozedUntil:later}], now)[0].at,later);
  for(const changed of [{...mail,snoozedUntil:null},{...mail,snoozedUntil:now},{...mail,archived:true},{...mail,direction:"sent" as const}]) assert.deepEqual(calendarEntries([], [changed], now),[]);
});

test("Emc² events appear on each local day they cover, all-day first, and never count as overdue", async () => {
  const { eventDays } = await import("../shared/calendar");
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const base = { source: "local" as const, attendees: [], revision: 1, updatedAt: 1 };
    const offsite = { ...base, id: "offsite", title: "Offsite", start: "2026-10-30", end: "2026-11-01", allDay: true };
    const late = { ...base, id: "late", title: "Late call", start: "2026-10-31T02:30:00.000Z", end: "2026-10-31T03:00:00.000Z", allDay: false };
    const overnight = { ...base, id: "overnight", title: "Overnight", start: "2026-10-29T03:00:00.000Z", end: "2026-10-30T05:00:00.000Z", allDay: false };
    assert.deepEqual(eventDays(offsite), ["2026-10-30", "2026-10-31"]);
    assert.deepEqual(eventDays(late), ["2026-10-30"], "a late UTC instant stays on its local day");
    assert.deepEqual(eventDays(overnight), ["2026-10-28", "2026-10-29", "2026-10-30"]);
    const entries = calendarEntries([], [], Date.parse("2026-11-20T12:00:00Z"), [late, offsite, overnight]);
    assert.deepEqual(entries.filter((entry) => entry.day === "2026-10-30").map((entry) => entry.item.id), ["offsite", "overnight", "late"]);
    assert.equal(entries.length, 6);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("event fields convert to exclusive all-day ends and UTC instants, and reject impossible input", async () => {
  const { eventInput, eventFields, moveStart, blankEvent } = await import("./work/events");
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    const fields = { ...blankEvent(Date.parse("2026-10-20T13:10:00Z")), title: " Review ", attendees: "One <one@example.test>, two@example.test", meetLink: "https://meet.example.test/abc", accountId: "a" };
    assert.deepEqual([fields.startDate, fields.startTime, fields.endDate, fields.endTime], ["2026-10-20", "10:00", "2026-10-20", "10:30"]);
    const timed = eventInput(fields);
    assert.ok("input" in timed);
    assert.deepEqual(timed.input, { title: "Review", start: "2026-10-20T14:00:00.000Z", end: "2026-10-20T14:30:00.000Z", allDay: false, attendees: ["one@example.test", "two@example.test"], accountId: "a", meetLink: "https://meet.example.test/abc" });
    const allDay = eventInput({ ...fields, allDay: true, startDate: "2026-10-30", endDate: "2026-10-31" });
    assert.ok("input" in allDay); assert.equal(allDay.input.start, "2026-10-30"); assert.equal(allDay.input.end, "2026-11-01");
    const round = eventFields({ ...allDay.input, id: "x", source: "local", attendees: [{ email: "one@example.test" }], revision: 1, updatedAt: 1 });
    assert.deepEqual([round.startDate, round.endDate, round.allDay, round.attendees], ["2026-10-30", "2026-10-31", true, "one@example.test"]);
    const moved = moveStart(fields, "2026-10-22", "15:00");
    assert.deepEqual([moved.startDate, moved.startTime, moved.endDate, moved.endTime], ["2026-10-22", "15:00", "2026-10-22", "15:30"]);
    for (const [patch, message] of [
      [{ title: " " }, "Add a title."],
      [{ endTime: "09:00" }, "The event must end after it starts."],
      [{ startDate: "2026-03-08", startTime: "02:30", endDate: "2026-03-08", endTime: "04:00" }, "This local time does not exist. Choose another time."],
      [{ endDate: "2026-11-20" }, "Events can last at most 14 days."],
      [{ attendees: "not an address" }, "Check the attendee addresses. Separate them with commas."],
      [{ meetLink: "http://meet.example.test" }, "Meeting links must start with https://."],
      [{ meetLink: "javascript:alert(1)" }, "Meeting links must start with https://."],
    ] as const) assert.deepEqual(eventInput({ ...fields, ...patch }), { error: message });
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("a meeting from an email takes its subject and everyone on it except the user", async () => {
  const { meetingFields } = await import("./work/events");
  const mail = { id: "m1", accountId: "a", subject: "RE: Fwd: Planning sync", address: "lead@example.test", to: "Me <me@example.test>, Pat <pat@example.test>", cc: "LEAD@example.test, other-me@example.test, sam@example.test" } as import("../shared/types").Mail;
  const fields = meetingFields(mail, ["ME@example.test", "other-me@example.test"], Date.parse("2026-10-20T13:10:00Z"));
  assert.equal(fields.title, "Planning sync");
  assert.equal(fields.attendees, "lead@example.test, pat@example.test, sam@example.test");
  assert.equal(fields.accountId, "a"); assert.equal(fields.sourceMailId, "m1");
  assert.equal(meetingFields({ ...mail, subject: "Re:" }, [], 0).title, "");
});


test("a long Google event covers the requested month without shifting all-day boundaries",async()=>{
 const { eventDays }=await import("../shared/calendar");
 const event={start:"2026-01-01",end:"2027-01-01",allDay:true};
 assert.equal(eventDays(event,{from:"2026-10-01",to:"2026-10-31"}).length,31);
 assert.deepEqual(eventDays(event,{from:"2027-01-01",to:"2027-01-31"}),[]);
});

for (const reverse of [false, true]) test(`month merge keeps moved/newer versions and full identities (${reverse ? "reverse" : "forward"} response order)`, async () => {
  const { mergeCalendarFeeds } = await import("./work/events");
  const base = { id:"same", source:"local" as const, title:"Old", start:"2026-10-31", end:"2026-11-01", allDay:true, accountId:"a", attendees:[], revision:1, updatedAt:900 };
  const moved = { ...base, title:"Moved", start:"2026-11-02", end:"2026-11-03", revision:2, updatedAt:100 };
  const remote = { ...base, source:"google" as const, calendarId:"one", remoteId:"remote", updatedAt:10 };
  const remoteNew = { ...remote, title:"Google updated", updatedAt:20 };
  const equalA = { ...base, id:"tie", title:"A", revision:2, updatedAt:20 };
  const equalZ = { ...equalA, title:"Z" };
  const feeds = [{events:[base,remote,equalA]}, {events:[moved,remoteNew,equalZ,{...base,accountId:"b"},{...remote,calendarId:"two"}]}];
  if (reverse) feeds.reverse();
  const result = mergeCalendarFeeds(feeds);
  assert.equal(result.events.length, 5);
  assert.equal(result.events.find(event=>event.source==="local" && event.id==="same" && event.accountId==="a")?.title,"Moved");
  assert.equal(result.events.find(event=>event.source==="google" && event.calendarId==="one")?.title,"Google updated");
  assert.equal(result.events.find(event=>event.id==="tie")?.title,"Z");
  assert.equal(result.conflict,true);
  assert.deepEqual(result, mergeCalendarFeeds([...feeds].reverse()));
});

test("equal local revisions use updatedAt and equal canonical records remain fresh", async () => {
  const { mergeCalendarFeeds } = await import("./work/events");
  const base = {id:"local",source:"local" as const,title:"Before",start:"2026-10-31",end:"2026-11-01",allDay:true,attendees:[],revision:3,updatedAt:1};
  const changed = {...base,title:"After",updatedAt:2};
  assert.equal(mergeCalendarFeeds([{events:[changed]},{events:[base]}]).events[0].title,"After");
  assert.equal(mergeCalendarFeeds([{events:[base]},{events:[{...base}]}]).conflict,false);
});

async function mountCalendarCache(initialMonths: string[], api: import("./api").Api) {
  const { JSDOM } = await import("jsdom"), { act } = await import("react"), { createRoot } = await import("react-dom/client");
  const { useCalendarEvents } = await import("./work/events");
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true};
  const old = new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,value});
  let months = initialMonths, account = "all", calendar: ReturnType<typeof useCalendarEvents>;
  function Harness() { calendar = useCalendarEvents(api,months,true,account); return <p>{calendar.events.map(value=>value.title).join(",")}</p>; }
  const root = createRoot(document.getElementById("root")!);
  const render = () => act(async()=>root.render(<Harness/>));
  await render();
  return { get calendar(){return calendar!;}, dom, act, async change(next:string[], key=account){months=next;account=key;await render();}, async close(){await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor]of old){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}} };
}

test("cross-month cache reads are serial exact month windows, preserve partial coverage, and never sync on focus", async () => {
  const { monthRange } = await import("./work/events");
  const calls: {url:string;method:string}[] = [], pending: {resolve:(value:unknown)=>void;reject:()=>void}[]=[];
  const api:import("./api").Api = async <T,>(url:string,method="GET") => { calls.push({url,method}); return new Promise<T>((resolve,reject)=>pending.push({resolve:value=>resolve(value as T),reject:()=>reject(new Error("synthetic"))})); };
  const ui = await mountCalendarCache(["2026-10","2026-11"],api);
  const google = [{accountId:"a",status:"connected" as const,calendars:[],stale:false,syncedAt:100}];
  try {
    const query = (month:string) => {const {from,to}=monthRange(month);return `/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;};
    assert.equal(calls.length,1); assert.equal(calls[0].url,query("2026-10"));
    await ui.act(async()=>pending[0].resolve({events:[],google}));
    assert.equal(calls.length,2);assert.equal(calls[1].url,query("2026-11"));
    await ui.act(async()=>pending[1].reject());
    assert.equal(ui.calendar.loaded,true);assert.equal(ui.calendar.google[0].stale,true);assert.equal(ui.calendar.google[0].syncedAt,0);
    assert.equal(ui.calendar.coverage[1].failed,true);assert.match(ui.calendar.error,/incomplete/);
    await ui.act(async()=>ui.dom.window.dispatchEvent(new ui.dom.window.Event("focus")));
    await ui.act(async()=>pending[2].resolve({events:[],google}));
    await ui.act(async()=>pending[3].resolve({events:[],google:[{...google[0],syncedAt:200}]}));
    assert.equal(ui.calendar.error,"");assert.equal(ui.calendar.google[0].syncedAt,100);assert.equal(ui.calendar.google[0].stale,false);
    assert.ok(calls.every(call=>call.method==="GET" && call.url.startsWith("/calendar/events?")));
  } finally {await ui.close();}
});

test("account/range changes discard obsolete reads, stop the old serial range and clear prior results", async () => {
  const pending: ((value:unknown)=>void)[] = [];
  const api:import("./api").Api = async <T,>() => new Promise<T>(resolve=>pending.push(value=>resolve(value as T)));
  const ui=await mountCalendarCache(["2026-10","2026-11"],api);
  const event = {id:"old",source:"local",title:"Obsolete",start:"2026-10-31",end:"2026-11-01",allDay:true,attendees:[],revision:1,updatedAt:1};
  try {
    await ui.change(["2026-12"],"a");
    assert.equal(pending.length,2);
    await ui.act(async()=>pending[0]({events:[event]}));
    assert.equal(pending.length,2,"obsolete first month must not start its second read");
    assert.equal(ui.calendar.events.length,0); assert.equal(ui.calendar.loaded,false);
    await ui.act(async()=>pending[1]({events:[{...event,id:"current",title:"Current"}]}));
    assert.equal(ui.calendar.events[0].title,"Current");
    await ui.change(["2026-12"],"b");
    assert.equal(ui.calendar.events.length,0);assert.equal(ui.calendar.loaded,false);
    await ui.act(async()=>pending[2]({events:[]}));
    assert.deepEqual(ui.calendar.events,[]);
  } finally {await ui.close();}
});
