import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Attachments } from "./mail/Attachments";
import { PrivacyContext } from "./ui/Privacy";

test("attachments download every format, preview only on demand, and clear previews on privacy changes", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const originals = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const files = [
    { id: "image", filename: "alice@example.test.png", contentType: "image/png", size: 4 },
    { id: "pdf", filename: "report.pdf", contentType: "application/pdf", size: 8 },
    { id: "xlsx", filename: "sheet.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 9 },
    { id: "zip", filename: "archive.zip", contentType: "application/zip", size: 10 },
    { id: "html", filename: "page.html", contentType: "text/html", size: 11 },
    { id: "svg", filename: "active.svg", contentType: "image/svg+xml", size: 12 },
    { id: "large", filename: "large.bin", contentType: "application/octet-stream", size: 1048576, unavailable: true },
  ];
  let calls: string[] = [];
  let fail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(new Uint8Array([1, 2, 3, 4]), { status: fail ? 404 : 200 }); };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => `blob:synthetic-${calls.length}`;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const downloads: { name: string; href: string }[] = [];
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, href: this.href }); };
  const render = async (privacy = false, id = "a:1") => act(async () => root.render(<PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {} }}><Attachments key={id} mailId={id} files={files} /></PrivacyContext.Provider>));
  const click = async (label: string) => act(async () => (dom.window.document.querySelector(`[aria-label='${label}']`) as HTMLButtonElement).click());
  try {
    await render();
    assert.equal(calls.length, 0);
    assert.equal(dom.window.document.querySelectorAll("button").length, 8);
    assert.equal(dom.window.document.querySelector("img"), null);
    for (let index = 1; index <= 6; index++) await click(`Download attachment ${index}`);
    assert.deepEqual(downloads.map((file) => file.name), files.slice(0, 6).map((file) => file.filename));
    assert.equal(calls[0], "/api/messages/a%3A1/attachments/image");
    await click("Preview attachment 1");
    assert.equal(dom.window.document.querySelector("img")?.src, "blob:synthetic-7");
    await render(true);
    assert.equal(dom.window.document.querySelector("img"), null);
    await click("Preview attachment 1");
    assert.ok(dom.window.document.querySelector("img"));
    await click("Hide preview 1");
    assert.equal(dom.window.document.querySelector("img"), null);
    fail = true;
    await click("Download attachment 3");
    assert.match(dom.window.document.querySelector("[role=alert]")!.textContent!, /could not be loaded/);
    fail = false;
    await click("Download attachment 3");
    assert.equal(dom.window.document.querySelector("[role=alert]"), null);
    await click("Preview attachment 1");
    await render(true, "b:2");
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.ok(revoked.length);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
