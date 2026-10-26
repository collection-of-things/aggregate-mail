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
    assert.equal(Buffer.from(changed!.attachments![1].content, "base64").length, 524288);
    for (const files of [[file("valid.bin", 1), file("oversized.bin", 524289)], Array.from({ length: 10 }, (_, index) => file(`${index}.bin`, 1))]) {
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
