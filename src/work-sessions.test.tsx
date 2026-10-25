import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Mail } from "../shared/types";
import type { CalendarEvent } from "../shared/calendar";
import { quietGmailRevision, quietImapWatch } from "../server/imap-watch-fixture";

test("mounted linked sessions preserve independent lifecycle, recovery, focus and parent invariants", { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-session-renderer-"));
  const env = { MAIL_DATA_DIR: directory, MAIL_CONFIG_PATH: path.join(directory, "absent.env"), MAIL_DESKTOP_TOKEN: "synthetic-session-renderer", MAIL_DATA_KEY: Buffer.alloc(32, 58).toString("base64"), TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" };
  const oldEnv = new Map(Object.keys(env).map((key) => [key, process.env[key]])); Object.assign(process.env, env);
  const store = await import("../server/store"), backend = await import("../server/index");
  store.put("account", "a", { id: "a", email: "a@example.test", provider: "imap", credentials: {} });
  store.put("account", "b", { id: "b", email: "b@example.test", provider: "gmail", credentials: {} });
  store.put("googleCalendar", "b", { accountId: "b", access: false, freeBusyAccess: false, generation: "synthetic", calendars: [{ id: "primary", name: "Private Reader calendar", selected: true }] });
  const next = new Date(Date.now() + 2 * 86400000), day = next.toISOString().slice(0, 10);
  store.put("availability", "working", { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "11:00", durationMinutes: 30, bufferMinutes: 0, timeZone: "UTC" });
  const mail: Mail = { id: "a:offer", accountId: "a", remoteId: "offer", sender: "Private Reader", address: "guest@example.test", to: "Private Reader <a@example.test>", subject: "Private Reader planning", body: "Private Reader mail", preview: "Planning", date: Date.now(), unread: false, archived: false, snoozedUntil: null, relevance: 3, category: "important", reason: "", html: null, images: [], attachments: [], messageId: "<offer@example.test>", threadId: "offer-thread" };
  store.put("mail", mail.id, mail);
  const parent = { id: "task", accountId: "a", sourceMailId: mail.id, text: "Private Reader deliverable", reason: "Chosen work", status: "needs-work" as const, evidenceMailIds: [mail.id], dueDate: day, followUpAt: Date.now() + 100000, revision: 1, updatedAt: 1, history: [] };
  store.put("commitment", parent.id, parent);
  const beforeMail = store.get("mail", mail.id);
  const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  dom.window.HTMLElement.prototype.scrollTo = () => {}; dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let narrow = false;
  Object.defineProperty(dom.window, "matchMedia", { value: (query: string) => ({ matches: query.includes("min-width") && !narrow, addEventListener() {}, removeEventListener() {} }) });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, location: dom.window.location, history: dom.window.history, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; }, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => false };
  const prior = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  (dom.window as unknown as Window).desktop = { platform: "darwin", materials: false, oauthUrl: "", windowCommand() {}, onWindowState: () => () => {}, onAccountConnected: () => () => {}, onNavigation: () => () => {}, onMailChanged: () => () => {} };
  const originalFetch = globalThis.fetch;
  let pendingRequests = 0, loseNext = false, failList = false;
  let heldSave: Promise<void> | undefined;
  let phase = "startup";
  const inventory: { phase: string; method: string; route: string }[] = [];
  const requests: { route: string; method: string; body: any; status?: number }[] = [];
  let action = "create", selectedId = "";
  globalThis.fetch = async (input, init) => {
    pendingRequests++;
    try {
      const route = String(input), method = init?.method || "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined; const request = { route, method, body, status: undefined as number | undefined }; requests.push(request); inventory.push({ phase, method, route: route.split("?")[0] });
      if (method !== "GET" && route.startsWith("/api/calendar/work-sessions")) await heldSave;
      if (route === "/api/sync") return Response.json({ errors: [] });
      if (method === "GET" && route.startsWith("/api/calendar/work-sessions?") && failList) throw new Error("Synthetic list unavailable");
      const response = await originalFetch(`${origin}${route}`, { ...init, headers: { ...init?.headers, "X-Desktop-Token": env.MAIL_DESKTOP_TOKEN } });
      request.status = response.status;
      if (response.ok && method !== "GET" && route.startsWith("/api/calendar/work-sessions") && loseNext) { loseNext = false; throw new Error("Synthetic response loss"); }
      return response;
    } finally { pendingRequests--; }
  };
  const { createRoot } = await import("react-dom/client"), { App } = await import("./App");
  const container = dom.window.document.getElementById("root")!; let root = createRoot(container), mounted = false;
  const diagnostics = () => JSON.stringify({ action, uuid: selectedId || mutations()[0]?.body?.id,
    interval: selectedId ? store.get("calendarEvent", selectedId) && { start: store.get("calendarEvent", selectedId)!.start, end: store.get("calendarEvent", selectedId)!.end } : undefined,
    mutationCount: mutations().length, http: mutations().map(item => ({ method: item.method, route: item.route, status: item.status })),
    alerts: [...container.querySelectorAll('[role="alert"]')].map(item => item.textContent),
    status: [...container.querySelectorAll('.session-dialog [role="status"]')].map(item => item.textContent),
    activeElement: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label"), text: document.activeElement?.textContent?.slice(0, 100) } });
  const settle = async (condition: () => boolean) => { for (let n = 0; n < 200 && !condition(); n++) await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)); }); assert.equal(condition(), true, `Mounted session state did not settle: ${diagnostics()}`); };
  const button = (name: string) => { const value = [...container.querySelectorAll<HTMLButtonElement>("button")].find((control) => (control.getAttribute("aria-label") || control.textContent?.trim()) === name || control.matches(".sidebar button") && (control.querySelector(".sidebar-name")?.textContent ?? control.textContent)?.trim().startsWith(name)); assert.ok(value, `Missing button ${name}`); return value; };
  const click = async (control: HTMLElement) => { await act(async () => { control.focus(); control.click(); }); };
  const field = (name: string) => { const label = [...container.querySelectorAll("label")].find((item) => item.firstChild?.textContent === name); assert.ok(label, `Missing field ${name}`); return label.querySelector<HTMLInputElement>("input")!; };
  const set = async (name: string, value: string) => { const input = field(name); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); };
  const selectTask = async () => { await settle(() => !!container.querySelector(".work-select")); await click(container.querySelector<HTMLElement>(".work-select")!); };
  const submit = async () => { await act(async () => { container.querySelector<HTMLFormElement>(".session-form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); };
  const mutations = () => requests.filter(item => item.method !== "GET" && item.route.startsWith("/api/calendar/work-sessions"));
  let firstSession: CalendarEvent | undefined;
  const laterId = "00000000-0000-4000-8000-000000000001";
  const sessionRow = (id: string) => { const row = [...container.querySelectorAll(".work-sessions li")].find(item => item.getAttribute("data-session-id") === id); assert.ok(row, `Missing session ${id}`); return row; };
  const recover = async (frozen: (typeof requests)[number]) => {
    const before = mutations().length, readStart = requests.length;
    await click(button("Check saved session")); await settle(() => !pendingRequests && /Review saved session/.test(container.textContent!));
    assert.equal(mutations().length, before, action + " recovery reads only");
    assert.equal(requests.slice(readStart).every(item => item.method === "GET"), true);
    assert.equal(requests.slice(readStart).some(item => item.route === `/api/calendar/work-sessions/${selectedId}` && item.status === 200), true, "recovery reads the frozen UUID");
    assert.deepEqual(mutations()[0], frozen, "recovery preserves the exact mutation without replay");
    await click(button("I reviewed saved session")); await settle(() => !container.querySelector('[role="dialog"]'));
  };
  const mount = async () => {
    phase = "startup";
    await act(async () => root.render(<App />)); mounted = true;
    await settle(() => !pendingRequests && !!container.querySelector(".work-select")); phase = "source-open"; await selectTask();
    await settle(() => !pendingRequests && !button("Plan work").disabled);
    assert.deepEqual(inventory.filter(item => item.phase === "startup" && item.method !== "GET"), [{ phase: "startup", method: "POST", route: "/api/sync" }]);
    assert.deepEqual(inventory.filter(item => item.phase === "source-open" && item.method !== "GET"), []);
    phase = "session-controls";
  };
  const seed = async () => {
    assert.ok(firstSession, "create recovery retained the UUID and interval"); selectedId = firstSession.id;
    for (const event of store.all("calendarEvent")) store.remove("calendarEvent", event.id);
    const later = { ...structuredClone(firstSession), id: laterId, start: new Date(`${day}T15:00`).toISOString(), end: new Date(`${day}T16:00`).toISOString() };
    store.put("calendarEvent", later.id, later); store.put("calendarEvent", firstSession.id, structuredClone(firstSession));
    assert.equal(store.all("calendarEvent")[0].id, later.id, "adversarial fixture deliberately puts 15:00 first, without selecting it");
    assert.equal(store.get("calendarEvent", selectedId)!.start, new Date(`${day}T13:00`).toISOString());
    assert.equal(store.get("calendarEvent", selectedId)!.end, new Date(`${day}T14:00`).toISOString());
    await mount();
    assert.equal(container.querySelectorAll(".work-sessions li").length, 2);
  };
  const scenario = async (name: string, run: () => Promise<void>) => t.test(name, async (s) => {
    action = name; selectedId = ""; requests.length = 0; inventory.length = 0; dom.window.localStorage.clear(); narrow = false;
    try {
      await run();
      assert.deepEqual(store.get("commitment", parent.id), parent); assert.deepEqual(store.get("mail", mail.id), beforeMail);
      assert.deepEqual(inventory.filter(item => item.phase === "session-controls" && item.method !== "GET" && !item.route.startsWith("/api/calendar/work-sessions")), [], "session controls have no mail, commitment or provider writes");
      for (const suffix of ["", "-wal"]) assert.equal(readFileSync(path.join(directory, `mail.sqlite${suffix}`)).includes(Buffer.from(parent.text)), false);
    } catch (failure) { s.diagnostic(diagnostics()); throw failure; }
    finally { if (mounted) { await act(async () => root.unmount()); mounted = false; root = createRoot(container); } }
  });
  try {
    await scenario("explicit create guards, frozen-ID recovery and acknowledged save with failed refresh", async () => {
      await act(async () => root.render(<App />)); mounted = true; await settle(() => !pendingRequests && !!container.querySelector(".work-select")); phase = "source-open"; await selectTask();
      assert.equal([...container.querySelectorAll("button")].some(item => item.textContent === "Plan work"), true, "Today details expose explicit Plan work");
      await settle(() => !pendingRequests && !button("Plan work").disabled);
      assert.deepEqual(inventory.filter(item => item.phase === "startup" && item.method !== "GET"), [{ phase: "startup", method: "POST", route: "/api/sync" }]);
      assert.deepEqual(inventory.filter(item => item.phase === "source-open" && item.method !== "GET"), []);
      phase = "session-controls";
      await click(button("Plan work"));
      assert.match(container.querySelector('[role="dialog"]')!.textContent!, /Google calendars are excluded/);
      assert.equal(container.querySelector('[role="dialog"] input[type="checkbox"]') !== null, true);
      assert.equal(container.querySelector('[role="dialog"] select'), null, "session has no mutable account chooser");
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(container.querySelector('[role="dialog"]'), null); assert.equal(document.activeElement === button("Plan work"), true);
      await click(button("Plan work"));
      const previousTZ = process.env.TZ;
      try {
        for (const [zone, date, start, end, reason] of [
          ["America/New_York", "2026-03-08", "02:30", "04:00", /does not exist/],
          ["America/New_York", "2026-11-01", "01:30", "03:00", /occurs twice/],
          ["America/New_York", "2026-11-01", "00:30", "01:30", /occurs twice/],
          ["Australia/Lord_Howe", "2026-10-04", "02:15", "03:00", /does not exist/],
          ["Australia/Lord_Howe", "2026-04-05", "01:45", "03:00", /occurs twice/],
          ["Australia/Lord_Howe", "2026-04-05", "00:30", "01:45", /occurs twice/],
        ] as const) {
          process.env.TZ = zone;
          await set("Start date", date); await set("Start time", start); await set("End date", date); await set("End time", end);
          await submit(); assert.match(container.querySelector('[role="dialog"]')!.textContent!, reason, zone + " " + date);
          assert.equal(mutations().length, 0, "ambiguous/nonexistent clock time never reaches HTTP mutation");
        }
      } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
      await set("Start date", day); await set("Start time", "13:00"); await set("End date", day); await set("End time", "14:00");
      let releaseSave!: () => void; heldSave = new Promise<void>(resolve => { releaseSave = resolve; });
      loseNext = true; await submit();
      assert.equal(button("Save session locally").disabled, true);
      const unload = new dom.window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
      await submit(); assert.equal(mutations().length, 1, "pending duplicate submit is blocked");
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await click(button("Calendar")); assert.ok(container.querySelector(".session-dialog"), "pending navigation preserves session controller");
      await act(async () => { heldSave = undefined; releaseSave(); });
      await settle(() => !pendingRequests && /unknown/i.test(container.textContent!));
      await click(button("Close dialog"));
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.ok(container.querySelector(".session-dialog"), "unknown close/Escape cannot discard recovery identity");
      const frozen = structuredClone(mutations()[0]);
      selectedId = frozen.body.id;
      assert.equal(mutations().length, 1); assert.equal(button("Save session locally").disabled, true);
      const recoveryStart = requests.length;
      await click(button("Check saved session")); await settle(() => !pendingRequests && /Review saved session/.test(container.textContent!));
      assert.equal(requests.slice(recoveryStart).every(item => item.method === "GET"), true);
      assert.equal(requests.slice(recoveryStart).some(item => item.route === `/api/calendar/work-sessions/${frozen.body.id}` && item.status === 200), true);
      assert.equal(mutations().length, 1, "unknown create recovery is GET only");
      await click(button("I reviewed saved session")); await settle(() => !container.querySelector('[role="dialog"]'));
      assert.equal(store.all("calendarEvent").length, 1); assert.deepEqual(mutations()[0], frozen);
      firstSession = store.get("calendarEvent", frozen.body.id)!;
      assert.equal(firstSession.id, frozen.body.id);
      assert.equal(firstSession.start, new Date(`${day}T13:00`).toISOString());
      assert.equal(firstSession.end, new Date(`${day}T14:00`).toISOString());
      await click(button("Plan work")); await set("Start date", day); await set("Start time", "15:00"); await set("End date", day); await set("End time", "16:00");
      failList = true; await submit(); await settle(() => !pendingRequests && /saved.*refresh unavailable/i.test(container.textContent!));
      assert.equal(button("Save session locally").disabled, true);
      const count = mutations().length; await submit(); assert.equal(mutations().length, count, "acknowledged save cannot resubmit after failed refresh");
      failList = false; await click(button("Check saved session")); await settle(() => !pendingRequests && /Review saved session/.test(container.textContent!)); await click(button("I reviewed saved session"));
      await settle(() => !container.querySelector('[role="dialog"]'));
      assert.equal(container.querySelectorAll(".work-sessions li").length, 2, "list is independent of Calendar month");
      assert.deepEqual(store.get("commitment", parent.id), parent); assert.deepEqual(store.get("mail", mail.id), beforeMail);
      assert.deepEqual(inventory.filter(item => item.phase === "session-controls" && item.method !== "GET" && !item.route.startsWith("/api/calendar/work-sessions")), [], "session controls have no mail, commitment or provider writes");
    });
    await scenario("edit recovers the frozen 13:00 UUID while 15:00 sorts first", async () => {
      await seed(); action = "Edit session";
      const row = sessionRow(selectedId);
      const control = [...row.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === action)!;
      assert.ok(control, action);
      loseNext = true; await click(control);
      assert.equal(field("Start time").value, "13:00"); assert.equal(field("End time").value, "14:00");
      await set("End time", "14:30"); await submit();
      await settle(() => !pendingRequests && /unknown/i.test(container.textContent!));
      const frozen = structuredClone(mutations()[0]);
      assert.equal(frozen.route, `/api/calendar/work-sessions/${selectedId}`); assert.equal(frozen.method, "PATCH"); assert.equal(frozen.status, 200);
      assert.equal(frozen.body.start, firstSession!.start); assert.equal(frozen.body.end, new Date(`${day}T14:30`).toISOString());
      await recover(frozen);
      assert.equal(store.get("calendarEvent", selectedId)!.end, frozen.body.end);
      assert.equal(store.get("calendarEvent", laterId)!.start, new Date(`${day}T15:00`).toISOString());
      assert.equal(store.get("calendarEvent", laterId)!.revision, 1);
      assert.equal(document.activeElement === [...sessionRow(selectedId).querySelectorAll("button")].find(item => item.textContent === action), true, "editing restores the still-rendered trigger");
    });
    for (const status of ["finish", "remove"] as const) for (const outcome of ["direct", "recovered"] as const) {
      await scenario(`Today ${status} ${outcome} restores focus after its trigger disappears`, async () => {
        await seed(); action = `${status === "finish" ? "Finish" : "Remove"} session`;
        const control = [...sessionRow(selectedId).querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === action)!;
        assert.ok(control, action);
        loseNext = outcome === "recovered"; await click(control);
        if (outcome === "recovered") {
          await settle(() => !pendingRequests && /unknown/i.test(container.textContent!));
          await recover(structuredClone(mutations()[0]));
        } else await settle(() => !pendingRequests && !container.querySelector('.session-dialog'));
        const mutation = mutations()[0];
        assert.equal(mutations().length, 1); assert.equal(mutation.status, 200);
        assert.equal(mutation.route, `/api/calendar/work-sessions/${selectedId}${status === "finish" ? "/finish" : ""}`);
        assert.equal(mutation.method, status === "finish" ? "POST" : "DELETE"); assert.deepEqual(mutation.body, { revision: 1 });
        const saved = store.get("calendarEvent", selectedId)!;
        assert.equal(saved.workSession?.status, status === "finish" ? "finished" : "removed"); assert.equal(saved.revision, 2);
        assert.equal(saved.start, firstSession!.start); assert.equal(saved.end, firstSession!.end);
        assert.equal(store.get("calendarEvent", laterId)!.workSession?.status, "planned");
        assert.equal(container.querySelectorAll(".work-sessions li").length, status === "finish" ? 2 : 1);
        assert.equal(control.isConnected, false, "successful transition removes the exact action trigger");
        assert.equal(document.activeElement === container.querySelector(".work-sessions h3"), true, `Today ${status} ${outcome} restores focus to the rendered session heading`);
      });
    }
    await scenario("remount, privacy, keyboard and Calendar detail/source focus preserve saved sessions", async () => {
      await seed();
      store.put("calendarEvent", selectedId, { ...firstSession!, workSession: { ...firstSession!.workSession!, status: "removed" }, revision: 2 });
      const writesAtRemount = mutations().length;
      narrow = true; Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 360 });
      dom.window.localStorage.setItem("privacy", "on");
      phase = "remount";
      await act(async () => root.unmount()); mounted = false; root = createRoot(container); await act(async () => root.render(<App />)); mounted = true; await selectTask();
      await settle(() => !pendingRequests && container.querySelectorAll(".work-sessions li").length === 1);
      assert.equal(mutations().length, writesAtRemount, "remount only reads saved sessions");
      assert.deepEqual(inventory.filter(item => item.phase === "remount" && item.method !== "GET"), [{ phase: "remount", method: "POST", route: "/api/sync" }], "remount has only the explicitly stubbed startup sync");
      assert.deepEqual(store.get("commitment", parent.id), parent); assert.deepEqual(store.get("mail", mail.id), beforeMail);
      assert.equal(dom.window.localStorage.getItem("work-sessions"), null);
      assert.doesNotMatch(container.querySelector(".work-sessions")!.outerHTML, /Private Reader|guest@example.test|a@example.test|b@example.test/);
      await click(button("Plan work"));
      const dialog = container.querySelector<HTMLElement>(".session-dialog")!;
      assert.doesNotMatch(dialog.outerHTML, /Private Reader|guest@example.test|a@example.test|b@example.test/);
      assert.equal(dialog.querySelectorAll('input[type="date"]').length, 2);
      const controls = [...dialog.querySelectorAll<HTMLElement>("button, input")], first = controls[0], last = controls[controls.length - 1];
      first.focus(); await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
      assert.equal(document.activeElement === last, true, "reverse Tab stays in dialog");
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      assert.equal(document.activeElement === first, true, "Tab wraps in dialog");
      const writesBefore = mutations().length;
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(container.querySelector(".session-dialog"), null); assert.equal(document.activeElement === button("Plan work"), true);
      assert.equal(mutations().length, writesBefore, "privacy, narrow mode, keyboard and cancel never write sessions");
      assert.deepEqual(inventory.filter(item => item.phase === "remount" && item.method !== "GET"), [{ phase: "remount", method: "POST", route: "/api/sync" }]);
      assert.equal(JSON.stringify(dom.window.localStorage).includes("Private Reader"), false);
      await click(button("Calendar")); await settle(() => !pendingRequests && !!container.querySelector(".calendar-grid"));
      if (next.getUTCMonth() !== new Date().getUTCMonth()) { await click(button("Next month")); await settle(() => !pendingRequests); }
      await click(button("Agenda"));
      await settle(() => !![...container.querySelectorAll<HTMLElement>(".calendar-event")].find(item => item.textContent?.includes("Work session")));
      const sessionEntry = [...container.querySelectorAll<HTMLElement>(".calendar-event")].find(item => item.textContent?.includes("Work session"))!;
      await click(sessionEntry); await settle(() => !!container.querySelector('[aria-label="Event details"]'));
      const details = () => container.querySelector<HTMLElement>('[aria-label="Event details"]')!;
      assert.match(details().textContent!, /Work session.*planned.*Busy/);
      assert.doesNotMatch(details().outerHTML, /Private Reader|guest@example.test|a@example.test|b@example.test/);
      assert.equal([...details().querySelectorAll("button")].some(item => /invitation|Google|Edit event|Delete event/.test(item.textContent || "")), false, "session detail has only local session actions");
      await settle(() => !button("Edit session").disabled);
      await click(button("Edit session"));
      assert.equal(container.querySelector('[role="dialog"] select'), null);
      await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(document.activeElement === details(), true, "Calendar editor cancellation restores the selected detail pane");
      await click(details().querySelector<HTMLElement>(".work-source")!); await settle(() => !!container.querySelector(".calendar-reader .message"));
      await act(async () => container.querySelector(".calendar-reader .message")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await settle(() => !!details()); assert.equal(document.activeElement === details(), true, "source return restores session detail focus");
      await act(async () => details().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await settle(() => !details());
      assert.equal(document.activeElement === sessionEntry, true, "Calendar Escape restores the session entry");
      assert.equal(mutations().length, writesBefore);
      assert.deepEqual(inventory.filter(item => item.phase === "remount" && item.method !== "GET"), [{ phase: "remount", method: "POST", route: "/api/sync" }]);
      assert.deepEqual(store.get("commitment", parent.id), parent); assert.deepEqual(store.get("mail", mail.id), beforeMail);
      for (const suffix of ["", "-wal"]) assert.equal(readFileSync(path.join(directory, `mail.sqlite${suffix}`)).includes(Buffer.from(parent.text)), false);
    });
  } finally {
    await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = originalFetch;
    for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await new Promise<void>(resolve => server.close(() => resolve())); store.closeStore(); rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of oldEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
