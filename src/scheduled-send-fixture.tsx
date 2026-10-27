import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { act } from "react";
import { JSDOM } from "jsdom";
import { quietImapWatch, quietGmailRevision } from "../server/imap-watch-fixture";

export async function mountedScheduled(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-undo-ui-"));
  Object.assign(process.env, { MAIL_DATA_DIR: directory, MAIL_CONFIG_PATH: path.join(directory, "absent.env"),
    MAIL_DESKTOP_TOKEN: "synthetic-outbox-ui", MAIL_DATA_KEY: Buffer.alloc(32, 21).toString("base64"), TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" });
  const store = await import("../server/store");
  const { createDraft } = await import("../server/drafts");
  const { providers } = await import("../server/providers");
  const backend = await import("../server/index");
  store.put("account", "a", { id: "a", email: "sender@example.test", provider: "imap", credentials: {} });
  store.put("compose", "preferences", { templates: [], signatures: {}, undoSendSeconds: 30 });
  const original = createDraft("a", { to: ["one@example.test", "two@example.test"], bcc: ["hidden@example.test"], cc: ["copy@example.test"],
    subject: "Synthetic queued message", body: "Synthetic body", html: "<p>Synthetic body</p>",
    attachments: [{ filename: "test.txt", contentType: "text/plain", content: "dGVzdA==" }] });
  let calls = 0;
  t.mock.method(providers.imap, "send", async (_account: import("../server/store").StoredAccount, payload: import("../server/providers").SendInput) => {
    calls++; assert.deepEqual(payload.to, original.to); assert.deepEqual(payload.bcc, original.bcc);
    assert.deepEqual(payload.attachments, original.attachments); assert.equal(payload.html, original.html);
  });
  const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const globals = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    location: dom.window.location, history: dom.window.history, HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
    IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true };
  const prior = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  (dom.window as unknown as Window).desktop = { platform: "linux", materials: false, oauthUrl: "", windowCommand() {},
    onWindowState: () => () => {}, onAccountConnected: () => () => {}, onMailChanged: () => () => {}, onNavigation: () => () => {} };
  const originalFetch = globalThis.fetch;
  let dropQueueAck = true;
  type Trace = { order: number; phase?: string; route?: string; drafts?: { id?: string; revision?: number }[]; [key: string]: unknown };
  const requestTrace: Trace[] = [];
  const traceReads: Promise<void>[] = [];
  let order = 0;
  const trace = (event: object) => requestTrace.push({ order: ++order, ...event });
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/sync") return Response.json({ errors: [] });
    const route = String(input);
    const draftRead = (init?.method ?? "GET") === "GET" && /^\/api\/accounts\/a\/drafts(?:\/[^/]+)?$/.test(route);
    if (draftRead) {
      trace({ phase: "request", route });
      init?.signal?.addEventListener("abort", () => trace({ phase: "abort", route }), { once: true });
    }
    const response = await originalFetch(`${origin}${input}`, { ...init, headers: { ...init?.headers, "X-Desktop-Token": "synthetic-outbox-ui" } });
    if (draftRead) {
      trace({ phase: "response", route, status: response.status, aborted: init?.signal?.aborted ?? false });
      traceReads.push(response.clone().json().then((value: unknown) => {
        const rows = (Array.isArray(value) ? value : [value]) as { id?: string; revision?: number }[];
        trace({ phase: "parsed", route, drafts: rows.map(({ id, revision }) => ({ id, revision })) });
      }));
    }
    if (String(input) === "/api/send" && dropQueueAck) { dropQueueAck = false; throw new Error("Synthetic dropped queue acknowledgement"); }
    return response;
  };
  const { createRoot } = await import("react-dom/client");
  const { App } = await import("./App");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const settle = async (condition: () => boolean) => {
    const deadline = Date.now() + 12000;
    while (!condition() && Date.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.ok(condition(), "Mounted outbox state did not settle");
  };
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text);
  const snapshot = (phase: string) => {
    const list = container.querySelector('[aria-label="Saved drafts"]');
    trace({ phase, ariaBusy: list?.getAttribute("aria-busy"), rowPresent: !!container.querySelector(".draft-row"),
      rowDisabled: container.querySelector<HTMLButtonElement>(".draft-row")?.disabled,
      refreshDisabled: container.querySelector<HTMLButtonElement>(".draft-refresh")?.disabled,
      loading: /Loading drafts/.test(container.querySelector(".draft-list-heading")?.textContent ?? ""),
      error: container.querySelector(".draft-list-error")?.textContent ?? "",
      inert: !!list?.closest("[inert]"), compose: !!container.querySelector(".compose-form"),
      storedRevision: store.get("draft", original.id)?.revision });
  };
  const submit = async () => { await act(async () => container.querySelector(".compose-form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); };
  try {
    await act(async () => root.render(<App />));
    await settle(() => !!container.querySelector('.sidebar [aria-label^="Drafts"]:not([disabled])'));
    await act(async () => container.querySelector<HTMLButtonElement>('.sidebar [aria-label^="Drafts"]')!.click());
    await settle(() => !!container.querySelector(".draft-row"));
    await act(async () => container.querySelector<HTMLButtonElement>(".draft-row")!.click());
    await settle(() => !!container.querySelector(".compose-form"));
    const { followUpPreset } = await import("../shared/follow-up-presets");
    const { localScheduleTime } = await import("./compose/ScheduleTime");
    const openScheduled = async () => {
      await act(async () => dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })));
      const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.trim() === "Open Scheduled")!;
      assert.ok(option, "Scheduled is reachable from Commands");
      await act(async () => option.click());
      await settle(() => !!button("Reschedule"));
      assert.ok(container.querySelector('[role="dialog"][aria-label="Scheduled"]'));
    };
    await act(async () => button("Send later")!.click());
    assert.match(container.textContent!, /running and online/);
    await act(async () => button("Monday morning")!.click());
    assert.equal(container.querySelector<HTMLInputElement>('[aria-label="Send later date and time"]')!.value, localScheduleTime(followUpPreset("monday", Date.now())!));
    const input = container.querySelector<HTMLInputElement>('[aria-label="Send later date and time"]')!;
    const custom = localScheduleTime(Date.now() + 3600000);
    await act(async () => {
      input.value = custom;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await submit();
    await settle(() => !container.querySelector(".compose-form") && store.all("outbox").length === 1);
    const first = store.all("outbox")[0];
    assert.equal(first.scheduledFor, new Date(custom).getTime());
    assert.equal(calls, 0);
    await act(async () => dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(store.all("outbox").length, 1, "Undo-send shortcut cannot cancel a schedule");
    await openScheduled();
    await act(async () => button("Reschedule")!.click());
    await act(async () => button("Tomorrow morning")!.click());
    await act(async () => button("Save schedule")!.click());
    await settle(() => store.get("outbox", first.id)!.dueAt === followUpPreset("tomorrow", Date.now()) && !button("Cancel schedule")!.disabled);
    assert.deepEqual(store.get("outbox", first.id)!.payload, first.payload);
    assert.equal(calls, 0);
    await act(async () => button("Cancel schedule")!.click());
    await settle(() => store.all("outbox").length === 0 && /No scheduled messages/.test(container.textContent!));
    assert.equal(store.get("draft", original.id)!.revision, 2);
    assert.equal(calls, 0);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.sidebar [aria-label^="Drafts"]')!.click());
    const restoredSummaryReady = () => {
      const latest = requestTrace.findLast(event => event.phase === "parsed" && event.route === "/api/accounts/a/drafts");
      return container.querySelector('[aria-label="Saved drafts"]')?.getAttribute("aria-busy") === "false" &&
        container.querySelector<HTMLButtonElement>(".draft-refresh")?.disabled === false &&
        container.querySelector<HTMLButtonElement>(".draft-row")?.disabled === false &&
        latest?.drafts?.some(draft => draft.id === original.id && draft.revision === 2) === true;
    };
    await settle(restoredSummaryReady);
    assert.equal(restoredSummaryReady(), true, "Restored revision 2 summary and completed list refresh precede opening");
    snapshot("before-restored-row-click");
    await act(async () => container.querySelector<HTMLButtonElement>(".draft-row")!.click());
    snapshot("after-restored-row-click");
    try { await settle(() => !!container.querySelector(".compose-form")); }
    catch (error) { snapshot("restored-row-timeout"); throw error; }
    await act(async () => button("Send later")!.click());
    await submit();
    await settle(() => !container.querySelector(".compose-form") && store.all("outbox").length === 1);
    await openScheduled();
    await act(async () => button("Edit")!.click());
    await settle(() => !!container.querySelector(".compose-form") && store.all("outbox").length === 0);
    assert.equal(container.querySelector<HTMLInputElement>('[aria-label="Bcc"]')!.value, original.bcc!.join(", "));
    assert.equal(store.get("draft", original.id)!.revision, 3);
    assert.equal(calls, 0);
  } finally {
    await Promise.allSettled(traceReads);
    console.log("SYNTHETIC_SCHEDULE_TRACE " + JSON.stringify(requestTrace));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = originalFetch;
    for (const [key, value] of prior) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
    await new Promise<void>(resolve => server.close(() => resolve())); store.closeStore(); rmSync(directory, { recursive: true, force: true });
  }
}
