import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { ComposePanel, type Compose } from "./compose/ComposePanel";

test("attachment selection accounts for exact decoded bytes and retains the draft after rejected, cancelled or failed reads", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const draft: Compose = { accountId: "synthetic", to: ["recipient@example.test"], subject: "Synthetic", body: "Preserved body",
    attachments: [{ filename: "existing.bin", contentType: "application/octet-stream", content: Buffer.alloc(524288).toString("base64") }] };
  let changed: Compose | undefined;
  let task: Promise<void> | undefined;
  let key = 0;
  const render = () => act(async () => root.render(<ComposePanel key={++key} draft={draft} setDraft={value => { changed = value; }}
    accounts={[{ id: draft.accountId, email: "sender@example.test", provider: "imap" }]} busy={false}
    onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}} onSend={() => assert.fail("Selection cannot send")}
    onAttachmentTask={value => { task = value; }} progress={{ phase: "saved", message: "Saved" }} />));
  const select = async (files: File[]) => {
    changed = undefined; task = undefined;
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await task?.catch(() => {});
    });
  };
  const file = (name: string, size: number) => new dom.window.File([new Uint8Array(size)], name, { type: "application/octet-stream" });
  try {
    await render();
    assert.equal(document.querySelector(".compose-attachment-size")!.textContent, "1 file · 524288 bytes selected");
    await select([file("second.bin", 524288)]);
    assert.equal(changed?.attachments?.length, 2, "two exact 512 KiB files fit the decoded 1 MiB limit");
    assert.equal(changed?.body, draft.body);
    assert.equal(Buffer.from(changed!.attachments![1].content!, "base64").length, 524288);
    for (const files of [[file("valid.bin", 1), file("oversized.bin", 25 * 1024 * 1024 + 1)], Array.from({ length: 20 }, (_, index) => file(`${index}.bin`, 1))]) {
      await render(); await select(files);
      assert.equal(changed, undefined, "invalid selection preserves existing attachments and text atomically");
      assert.ok(document.querySelector('[role="alert"]'));
    }
    await render(); await select([]);
    assert.equal(changed, undefined);
    Object.defineProperty(globalThis, "FileReader", { configurable: true, value: class {
      onerror?: () => void;
      readAsDataURL() { this.onerror?.(); }
    } });
    await select([file("unreadable.bin", 1)]);
    assert.equal(changed, undefined);
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /could not be read/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});

test("practical selections upload raw files serially and keep only IDs in the draft", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const draft: Compose = { accountId: "synthetic", to: ["recipient@example.test"], subject: "Synthetic", body: "Preserved" };
  let changed: Compose | undefined, task: Promise<void> | undefined, active = 0, maximum = 0;
  const selected: File[] = [];
  const api: import("./api").Api = async <T,>(url: string, method?: string, body?: unknown): Promise<T> => {
    assert.match(url, /^\/accounts\/synthetic\/attachments\?/); assert.equal(method, "POST");
    assert.ok(body instanceof dom.window.File); const file = body as File;
    active++; maximum = Math.max(maximum, active); selected.push(file);
    await Promise.resolve(); active--;
    return { id: `00000000-0000-4000-8000-${String(selected.length).padStart(12, "0")}`, filename: file.name, contentType: file.type, size: file.size } as T;
  };
  try {
    await act(async () => root.render(<ComposePanel draft={draft} api={api} setDraft={value => { changed = value; }} accounts={[{ id: draft.accountId, email: "sender@example.test", provider: "imap" }]}
      busy={false} onClose={() => {}} onDiscard={() => {}} onRetry={() => {}} onSaveCopy={() => {}} onSend={() => assert.fail("Selecting cannot send")}
      onAttachmentTask={value => { task = value; }} progress={{ phase: "saved", message: "Saved" }} />));
    const files = Array.from({ length: 20 }, (_, i) => new dom.window.File([new Uint8Array(1024 * 1024)], `${i}.bin`, { type: "application/octet-stream" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await task; });
    assert.equal(maximum, 1); assert.equal(selected.length, 20); assert.equal(changed!.attachments!.length, 20);
    assert.ok(changed!.attachments!.every(file => file.id && !file.content));
    assert.equal(changed!.body, draft.body); assert.ok(JSON.stringify(changed).length < 10000);
    assert.match(document.getElementById("compose-attachment-limits")!.textContent!, /25 MiB/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [name, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});
