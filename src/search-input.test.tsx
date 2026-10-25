import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { SearchToolbar } from "./shell/SearchToolbar";

test("search typing paints immediately and coalesces expensive result updates", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const root = createRoot(document.getElementById("root")!);
  const commits: string[] = [];
  const commit = (value: string) => { commits.push(value); };
  const inputRef = createRef<HTMLInputElement>();
  try {
    await act(async () => root.render(<SearchToolbar inputRef={inputRef} query="" label="Search" invalid={false} disabled={false} shortcut="/" onFocus={() => {}} onChange={commit} onClear={() => {}} onCommands={() => {}} />));
    const input = inputRef.current!;
    // React was imported before DOM setup, so use the installed input handler.
    const propsKey = Object.keys(input).find(key => key.startsWith("__reactProps"))!;
    const change = (value: string) => act(async () => {
      (input as unknown as Record<string, { onChange: (event: { target: { value: string } }) => void }>)[propsKey].onChange({ target: { value } });
    });
    for (const value of ["i", "in", "inv", "invo", "invoice"]) await change(value);
    assert.equal(input.value, "invoice");
    assert.deepEqual(commits, [], "typing must not synchronously run application search for every character");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    assert.deepEqual(commits, ["invoice"]);
    await change("superseded");
    await act(async () => root.render(<SearchToolbar inputRef={inputRef} query="" scopeKey="another-view" label="Search" invalid={false} disabled={false} shortcut="/" onFocus={() => {}} onChange={commit} onClear={() => {}} onCommands={() => {}} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    assert.deepEqual(commits, ["invoice"], "navigation cancels pending search rather than reopening the old search");
    await change("unmounted");
    await act(async () => root.unmount());
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(commits, ["invoice"], "unmount cancels pending search");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
