import { test } from "node:test";
import assert from "node:assert/strict";
import { useState, act } from "react";
import { JSDOM } from "jsdom";
import { RichBody } from "./compose/RichBody";
import type { Compose } from "./compose/draft-session";
import { validComposeMarkup } from "../shared/compose-content";

test("rich compose preserves selection, saves alternatives and inserts only plain clipboard text", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let value: Compose = { accountId: "synthetic", to: "", subject: "", body: "Hello team", sendUnknown: true };
  const commands: string[] = [];
  Object.defineProperty(document, "queryCommandSupported", { value: () => true, configurable: true });
  Object.defineProperty(document, "execCommand", { configurable: true, value: (command: string, _ui: boolean, input?: string) => {
    commands.push(command);
    if (command === "styleWithCSS") return true;
    const selection = window.getSelection()!, range = selection.getRangeAt(0);
    if (command === "insertText") {
      range.deleteContents(); range.insertNode(document.createTextNode(input!)); return true;
    }
    const tag = document.createElement(command === "bold" ? "b" : "em");
    tag.append(range.extractContents()); range.insertNode(tag); range.selectNodeContents(tag);
    return true;
  } });
  function Editor() {
    const [draft, update] = useState(value);
    return <RichBody draft={draft} disabled={false} onChange={next => { value = next; update(next); }} />;
  }
  try {
    await act(async () => root.render(<Editor />));
    assert.equal(value.html, undefined, "opening a plain message adds no HTML");
    const plain = document.querySelector("textarea")!;
    plain.focus(); plain.setSelectionRange(0, 5);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!.click());
    assert.equal(value.html, '<strong>Hello</strong> team');
    assert.equal(value.body, 'Hello team'); assert.equal(value.sendUnknown, true);
    assert.ok(validComposeMarkup(value));
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    const paste = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? '<img src="https://example.com/">' : '<img src="https://example.com/track">' } });
    await act(async () => editor.dispatchEvent(paste));
    assert.equal(paste.defaultPrevented, true);
    assert.equal(editor.querySelector("img"), null);
    assert.match(value.html!, /&lt;img/); assert.ok(validComposeMarkup(value));
    assert.ok(commands.includes("insertText"));
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
