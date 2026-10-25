import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CalendarEvent } from "../shared/calendar.js";
import type { CalendarOffer, OfferContext } from "../shared/offers.js";
import type { Commitment } from "../shared/workspace.js";
import { quietImapWatch } from "./imap-watch-fixture.js";

test("linked work sessions preserve work and mail, enforce local conflicts and retain terminal encrypted tombstones", { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-sessions-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-sessions";
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 61).toString("base64");
  process.env.TYPESAFE_API_KEY = ""; process.env.OPENAI_API_KEY = "";
  const store = await import("./store.js"), backend = await import("./index.js");
  store.put("account", "a", { id: "a", email: "a@example.test", provider: "imap", credentials: {} });
  store.put("mail", "a:1", { id: "a:1", accountId: "a", remoteId: "1:1", sender: "Synthetic", address: "sender@example.test", to: "a@example.test", subject: "Source", preview: "Synthetic", body: "Synthetic", date: 1, unread: true, archived: false, category: "important", relevance: 2, reason: "Synthetic", snoozedUntil: 1900000000000 });
  const parent: Commitment = { id: "parent", accountId: "a", sourceMailId: "a:1", text: "SYNTHETIC-SESSION-TITLE", reason: "Chosen work", status: "needs-work", dueDate: "2026-11-05", dueAt: 1793836800000, followUpAt: 1793800000000, evidenceMailIds: ["a:1"], revision: 1, updatedAt: 1, history: [] };
  store.put("commitment", parent.id, parent);
  const mailBefore = store.get("mail", "a:1");
  const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { "X-Desktop-Token": "synthetic-sessions", "Content-Type": "application/json" };
  const state = await (await fetch(`${origin}/api/state`, { headers })).json() as { csrf: string };
  const request = (route: string, method = "GET", body?: unknown) => fetch(`${origin}/api${route}`, { method, headers: { ...headers, "X-CSRF-Token": state.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const input = { id: randomUUID(), commitmentId: parent.id, commitmentRevision: 1, start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z", busy: true, timeZone: "UTC" };
  const route = (id: string = input.id) => `/calendar/work-sessions/${id}`;
  const edit = { revision: 1, commitmentRevision: 1, start: input.start, end: input.end, busy: true, timeZone: "UTC" };
  try {
    const response = await request("/calendar/work-sessions", "POST", input);
    assert.equal(response.status, 201, "The linked local session route creates one session");
    const first = await response.json() as CalendarEvent;
    assert.equal(first.title, parent.text); assert.equal(first.accountId, parent.accountId); assert.equal(first.sourceMailId, parent.sourceMailId);
    assert.deepEqual(first.attendees, []); assert.equal(first.workSession?.status, "planned"); assert.match(first.workSession!.creationInput, /^[a-f0-9]{64}$/);
    await t.test("strict scheduling input and current parent proof", async () => {
      for (const invalid of [{ id: "invalid" }, { commitmentRevision: 2 }, { attendees: [] }, { title: "override" }, { accountId: "other" }, { start: "2026-11-02T10:00" }, { end: input.start }, { end: "2027-01-01T00:00:00Z" }, { timeZone: "invalid" }, { timeZone: "+05:30" }, { busy: "yes" }]) {
        const result = await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID(), ...invalid });
        assert.equal(result.status, "commitmentRevision" in invalid ? 409 : 400, JSON.stringify(invalid));
      }
      assert.equal((await request("/calendar/work-sessions", "POST", { ...input, busy: false })).status, 409);
      assert.equal((await request("/calendar/work-sessions", "POST", Object.fromEntries(Object.entries(input).reverse()))).status, 200, "canonical input ignores key order");
    });
    await t.test("multiple sessions, self exclusion, touching edges and cross-account busy", async () => {
      assert.equal((await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID() })).status, 409);
      const free = await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID(), busy: false }); assert.equal(free.status, 201);
      const adjacent = await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID(), start: input.end, end: "2026-11-02T12:00:00Z" }); assert.equal(adjacent.status, 201);
      assert.equal((await request(route(), "PATCH", edit)).status, 200);
      assert.equal((await request(route(), "PATCH", edit)).status, 409);
      store.put("calendarEvent", "foreign", { ...first, id: "foreign", accountId: "other", workSession: undefined, start: "2026-11-03T10:00:00Z", end: "2026-11-03T11:00:00Z" });
      assert.equal((await request(route(), "PATCH", { ...edit, revision: 2, start: "2026-11-03T10:00:00Z", end: "2026-11-03T11:00:00Z" })).status, 409);
    });
    await t.test("generic routes and notification entrypoints reject before side effects", async () => {
      const ordinary = { id: input.id, title: first.title, accountId: "a", sourceMailId: "a:1", start: input.start, end: input.end, allDay: false, attendees: [] };
      for (const [url, method, body] of [["/calendar/events", "POST", ordinary], [`/calendar/events/${input.id}`, "PATCH", { ...ordinary, id: undefined, revision: 2 }], [`/calendar/events/${input.id}`, "DELETE", { revision: 2 }], [`/calendar/events/${input.id}/invitation`, "POST", { revision: 2, method: "REQUEST" }], [`/calendar/events/${input.id}/google`, "POST", { revision: 2 }]] as const)
        assert.equal((await request(url, method, body)).status, 409, url);
      assert.equal(store.all("draft").length, 0); assert.equal(store.all("calendarOperation").length, 0);
    });
    await t.test("finish and remove are independent and removed is terminal at current revision", async () => {
      assert.equal((await request(`${route()}/finish`, "POST", { revision: 2 })).status, 200);
      assert.equal((await request(`${route()}/finish`, "POST", { revision: 3 })).status, 409);
      assert.equal((await request(route(), "PATCH", { ...edit, revision: 3 })).status, 409);
      assert.equal((await request(route(), "DELETE", { revision: 3 })).status, 200);
      const removed = store.get("calendarEvent", input.id)!; assert.equal(removed.workSession?.status, "removed");
      assert.equal((await request(`${route()}/finish`, "POST", { revision: removed.revision })).status, 409);
      assert.equal((await request(route(), "PATCH", { ...edit, revision: removed.revision })).status, 409);
      assert.deepEqual(store.get("calendarEvent", input.id), removed);
      assert.deepEqual(await (await request("/calendar/work-sessions", "POST", input)).json(), removed, "create replay returns current tombstone");
      assert.deepEqual(await (await request(route())).json(), removed);
      const list = await (await request("/calendar/work-sessions?commitmentId=parent")).json() as { sessions: CalendarEvent[] };
      assert.equal(list.sessions.some(event => event.id === input.id), false);
      const feed = await (await request("/calendar/events?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z")).json() as { events: CalendarEvent[] };
      assert.equal(feed.events.some(event => event.id === input.id), false);
    });
    await t.test("source/account loss and closure block scheduling while retaining cleanup", async () => {
      const saved = await (await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID(), busy: false })).json() as CalendarEvent;
      store.put("commitment", parent.id, { ...parent, status: "done", revision: 2 });
      assert.equal((await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID() })).status, 409);
      assert.equal((await request(route(saved.id), "PATCH", edit)).status, 409);
      store.remove("mail", "a:1"); store.remove("account", "a");
      const list = await (await request("/calendar/work-sessions?commitmentId=parent")).json() as { available: boolean; reason: string };
      assert.equal(list.available, false); assert.ok(list.reason);
      assert.equal((await request(`${route(saved.id)}/finish`, "POST", { revision: 1 })).status, 200);
      assert.equal((await request(route(saved.id), "DELETE", { revision: 2 })).status, 200);
      store.put("account", "a", { id: "a", email: "a@example.test", provider: "imap", credentials: {} });
      store.put("mail", "a:1", mailBefore!); store.put("commitment", parent.id, parent);
    });
    await t.test("immutable bindings, separate source/account loss and encrypted reopen", async () => {
      const payload = { ...input, id: randomUUID(), busy: false };
      const saved = await (await request("/calendar/work-sessions", "POST", payload)).json() as CalendarEvent;
      const snapshot = structuredClone(saved);
      for (const change of [{ accountId: "other" }, { sourceMailId: "other" }, { commitmentId: "other" }, { title: "replacement" }])
        assert.equal((await request(route(saved.id), "PATCH", { ...edit, busy: false, ...change })).status, 400);
      store.put("commitment", parent.id, { ...parent, sourceMailId: "other", revision: 2 });
      assert.equal((await request(route(saved.id), "PATCH", { ...edit, busy: false, commitmentRevision: 2 })).status, 409);
      assert.deepEqual(await (await request("/calendar/work-sessions", "POST", payload)).json(), snapshot, "replay cannot rederive changed bindings");
      store.put("commitment", parent.id, parent);
      for (const loss of ["mail", "account", "commitment"] as const) {
        const id = loss === "mail" ? "a:1" : loss === "account" ? "a" : parent.id;
        const prior = store.get(loss, id)!; store.remove(loss, id);
        assert.equal((await request("/calendar/work-sessions", "POST", { ...payload, id: randomUUID() })).status, 409, loss);
        assert.equal((await request(route(saved.id), "PATCH", { ...edit, busy: false })).status, 409, loss);
        const listing = await (await request("/calendar/work-sessions?commitmentId=parent")).json();
        assert.equal(listing.available, false, loss); assert.deepEqual(store.get("calendarEvent", saved.id), snapshot);
        store.put(loss, id, prior);
      }
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module"], {
        cwd: process.cwd(), encoding: "utf8", timeout: 30000,
        input: `
          import express from "express";
          import { mountCalendar } from ${JSON.stringify(new URL("./calendar.ts", import.meta.url).href)};
          import { closeStore } from ${JSON.stringify(new URL("./store.ts", import.meta.url).href)};
          const app = express(); mountCalendar(app);
          const server = app.listen(0, "127.0.0.1");
          await new Promise(resolve => server.once("listening", resolve));
          try {
            const response = await fetch("http://127.0.0.1:" + server.address().port + ${JSON.stringify("/api" + route(saved.id))});
            if (response.status !== 200) throw new Error("Synthetic reopened read failed");
            console.log(JSON.stringify(await response.json()));
          } finally { await new Promise(resolve => server.close(resolve)); closeStore(); }
        `,
      });
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), snapshot, "fresh process HTTP reads the encrypted persisted session");
      assert.deepEqual(await (await request("/calendar/work-sessions", "POST", payload)).json(), snapshot);
      assert.equal((await request(route(saved.id), "DELETE", { revision: 1 })).status, 200);
    });
    await t.test("fresh offer booking rereads busy, free, finished and removed sessions", async () => {
      const day = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
      store.put("availability", "working", { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "10:00", durationMinutes: 30, bufferMinutes: 0, timeZone: "UTC" });
      const check = async () => {
        const context = await (await request("/calendar/offers?sourceMailId=a%3A1")).json() as OfferContext;
        const checked = await request("/calendar/offers/check", "POST", { id: randomUUID(), sourceMailId: "a:1", fingerprint: context.fingerprint, firstDay: day, lastDay: day, google: [] });
        assert.equal(checked.status, 200, await checked.clone().text());
        return { offer: await checked.json() as CalendarOffer, fingerprint: context.fingerprint };
      };
      for (const status of ["busy", "free", "finished", "removed"] as const) {
        const { offer, fingerprint } = await check(); assert.equal(offer.slots.length, 2);
        assert.equal((await request(`/calendar/offers/${offer.id}/draft`, "POST", { sourceMailId: "a:1", fingerprint, selected: [0] })).status, 200);
        const saved = await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID(), ...offer.slots[0], busy: status !== "free" });
        assert.equal(saved.status, 201, status); const event = await saved.json() as CalendarEvent;
        if (status === "finished") assert.equal((await request(`${route(event.id)}/finish`, "POST", { revision: 1 })).status, 200);
        if (status === "removed") assert.equal((await request(route(event.id), "DELETE", { revision: 1 })).status, 200);
        assert.equal((await check()).offer.slots.length, status === "busy" ? 1 : 2, status + " fresh check");
        const before = store.all("calendarEvent").length;
        const booked = await request(`/calendar/offers/${offer.id}/book`, "POST", { sourceMailId: "a:1", fingerprint, slot: 0 });
        assert.equal(booked.status, status === "busy" ? 409 : 200, status + " fresh booking");
        assert.equal(store.all("calendarEvent").length, before + (status === "busy" ? 0 : 1));
        if (status !== "busy") store.remove("calendarEvent", (await booked.json() as CalendarEvent).id);
        if (status !== "removed") assert.equal((await request(route(event.id), "DELETE", { revision: status === "finished" ? 2 : 1 })).status, 200);
      }
      const { offer, fingerprint } = await check();
      assert.equal((await request(`/calendar/offers/${offer.id}/draft`, "POST", { sourceMailId: "a:1", fingerprint, selected: [0] })).status, 200);
      const template = store.get("calendarEvent", input.id)!;
      for (const malformed of [null, { ...template.workSession!, busy: "false" }, { ...template.workSession!, status: "unknown" }, { ...template.workSession!, creationInput: "invalid" }]) {
        const id = "malformed-session";
        store.put("calendarEvent", id, { ...template, ...offer.slots[0], id, workSession: malformed } as unknown as CalendarEvent);
        const before = store.all("calendarEvent");
        assert.equal((await request("/calendar/work-sessions", "POST", { ...input, id: randomUUID(), ...offer.slots[0], busy: false })).status, 409);
        assert.equal((await request(route(id), "DELETE", { revision: template.revision })).status, 409);
        assert.equal((await request(`/calendar/offers/${offer.id}/book`, "POST", { sourceMailId: "a:1", fingerprint, slot: 0 })).status, 409);
        assert.deepEqual(store.all("calendarEvent"), before, "malformed metadata must not become free or mutate");
        store.remove("calendarEvent", id);
      }
      for (const draft of store.all("draft")) store.remove("draft", draft.id);
    });
    assert.deepEqual(store.get("commitment", parent.id), parent); assert.deepEqual(store.get("mail", "a:1"), mailBefore);
    assert.equal(store.all("draft").length, 0); assert.equal(store.all("calendarOperation").length, 0);
    for (const suffix of ["", "-wal"]) assert.equal(readFileSync(path.join(directory, `mail.sqlite${suffix}`)).includes(Buffer.from(parent.text)), false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
