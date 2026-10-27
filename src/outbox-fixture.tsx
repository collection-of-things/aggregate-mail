import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { act } from "react";
import { JSDOM } from "jsdom";
import { quietImapWatch, quietGmailRevision } from "../server/imap-watch-fixture";

export async function mountedOutbox(t: TestContext, delayedUndo: boolean) {
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
  let releaseUndo!: () => void;
  const undoWait = new Promise<void>(resolve => { releaseUndo = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/sync") return Response.json({ errors: [] });
    const response = await originalFetch(`${origin}${input}`, { ...init, headers: { ...init?.headers, "X-Desktop-Token": "synthetic-outbox-ui" } });
    if (String(input) === "/api/send" && dropQueueAck) { dropQueueAck = false; throw new Error("Synthetic dropped queue acknowledgement"); }
    if (delayedUndo && String(input).endsWith("/edit")) await undoWait;
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
  const submit = async () => { await act(async () => container.querySelector(".compose-form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))); };
  try {
    await act(async () => root.render(<App />));
    await settle(() => !!container.querySelector('.sidebar [aria-label^="Drafts"]:not([disabled])'));
    await act(async () => container.querySelector<HTMLButtonElement>('.sidebar [aria-label^="Drafts"]')!.click());
    await settle(() => !!container.querySelector(".draft-row"));
    await act(async () => container.querySelector<HTMLButtonElement>(".draft-row")!.click());
    await settle(() => !!container.querySelector(".compose-form"));
    const chooseDelay = async (label: string) => {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Undo send delay"]')!.click());
      const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.trim() === label)!;
      assert.ok(option);
      await act(async () => option.click());
      await settle(() => !!button("Send") && !button("Send")!.disabled && container.querySelector('[aria-label="Undo send delay"]')!.textContent!.includes(label));
    };
    await chooseDelay("30 seconds");
    assert.equal(store.get("compose", "preferences")?.undoSendSeconds, 30);
    await submit();
    await settle(() => !container.querySelector(".compose-form") && !!button("Undo send") && !button("Undo send")!.disabled);
    assert.equal(calls, 0); assert.match(container.querySelector('[aria-label="Outbox"]')!.textContent!, /Sending in/);
    assert.doesNotMatch(container.querySelector('[aria-label="Outbox"]')!.outerHTML, /hidden@example.test|Synthetic queued message/);
    const search = container.querySelector<HTMLInputElement>('[role="search"] input')!;
    await act(async () => search.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })));
    assert.equal(store.all("outbox").length, 1, "Text editors keep native undo");
    await act(async () => dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })));
    if (delayedUndo) {
      await settle(() => store.all("outbox").length === 0);
      await act(async () => button("New message")!.click());
      assert.equal(container.querySelector<HTMLInputElement>('.compose-subject input')?.value, "");
      await act(async () => { releaseUndo(); });
      await settle(() => /Send cancelled before submission/.test(container.textContent!));
      assert.equal(container.querySelector<HTMLInputElement>('.compose-subject input')?.value, "", "late Undo cannot replace a newer composer");
      assert.equal(store.get("draft", original.id)?.subject, original.subject, "restored source remains recoverable");
      assert.equal(calls, 0);
      return;
    }
    await settle(() => !!container.querySelector(".compose-form") && store.all("outbox").length === 0);
    assert.equal(calls, 0);
    assert.equal(container.querySelector<HTMLInputElement>('[aria-label="Bcc"]')!.value, original.bcc!.join(", "));
    const restored = store.get("draft", original.id)!;
    for (const field of ["to", "cc", "bcc", "subject", "body", "html", "attachments"] as const) assert.deepEqual(restored[field], original[field]);
    assert.equal(restored.sendUnknown, false);
    assert.match(container.textContent!, /Send cancelled before submission/);
    await chooseDelay("Off");
    assert.equal(store.get("compose", "preferences")?.undoSendSeconds, 0);
    await submit();
    await settle(() => calls === 1 && store.all("outbox")[0]?.state === "sent" && !!container.querySelector('[aria-label="Outbox"]')?.textContent?.includes("Provider accepted"));
    assert.equal(store.get("draft", original.id), undefined);
    assert.equal(calls, 1);
    assert.match(container.querySelector('[aria-label="Outbox"]')!.textContent!, /Provider accepted|Submitting/);
  } finally {
    releaseUndo();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    await act(async () => root.unmount()); dom.window.close(); globalThis.fetch = originalFetch;
    for (const [key, value] of prior) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
    await new Promise<void>(resolve => server.close(() => resolve())); store.closeStore(); rmSync(directory, { recursive: true, force: true });
  }
}
