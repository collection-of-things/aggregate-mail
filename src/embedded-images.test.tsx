import { test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ReaderContent } from "./mail/MessageContent";
import { PrivacyContext } from "./ui/Privacy";
import type { MailAttachment } from "../shared/types";

const image: MailAttachment = { id: "image", filename: "piece.png", contentType: "image/png", size: 4, contentId: "piece" };

test("embedded images stay message-bound, consent-controlled and safe against late responses", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const originals = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const requests: { url: string; resolve: (response: Response) => void }[] = [];
  const revoked: string[] = [];
  let blobs = 0;
  globalThis.fetch = async (url) => new Promise<Response>((resolve) => requests.push({ url: String(url), resolve }));
  URL.createObjectURL = () => `blob:synthetic-${++blobs}`;
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const render = async (id = "a:one", privacy = false, attachments = [image], src = "cid:piece", repeats = 1) => act(async () => root.render(
    <PrivacyContext.Provider value={{ on: privacy, revealed: new Set(), toggle() {} }}>
      <ReaderContent mail={{ id, html: `<h2>Expected today</h2>${`<img src="${src}" alt="Mailpiece">`.repeat(repeats)}<p>Delivery details</p>`, images: [], attachments }}
        loadImages={async () => { throw new Error("Must not load remote metadata"); }} />
    </PrivacyContext.Provider>));
  const click = async () => act(async () => (dom.window.document.querySelector(".image-controls button") as HTMLButtonElement).click());
  const finish = async (index: number, ok = true) => act(async () => requests[index].resolve(new Response(new Uint8Array([1, 2, 3, 4]), { status: ok ? 200 : 404 })));
  try {
    await render("a:one", false, [image], "cid:piece", 1000);
    assert.equal(requests.length, 0);
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.match(dom.window.document.body.textContent!, /Expected today.*Delivery details/);
    await click();
    assert.equal(requests.length, 1, "repeated CID references share one download");
    assert.equal(requests[0].url, "/api/messages/a%3Aone/attachments/image");
    await finish(0);
    assert.equal(dom.window.document.querySelector("img")?.getAttribute("src"), "blob:synthetic-1");
    assert.equal(dom.window.document.querySelectorAll("img").length, 1000);
    assert.equal(blobs, 1, "repeated references share one blob");
    await render("a:one", false, [{ ...image }]);
    assert.equal(requests.length, 1, "equivalent metadata does not restart the download");
    await render("a:one", true);
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.deepEqual(revoked, ["blob:synthetic-1"]);
    await click();
    await render("a:two", true);
    await finish(1);
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.equal(blobs, 1, "a response for the previous opening cannot create a blob");
    await click();
    await finish(2, false);
    assert.equal(dom.window.document.querySelector("img"), null);
    assert.ok(dom.window.document.querySelector('[aria-label="Embedded image could not be loaded."]'));
    for (const [id, files, src] of [
      ["duplicate", [image, { ...image, id: "other" }], "cid:piece"],
      ["svg", [{ ...image, contentType: "image/svg+xml" }], "cid:piece"],
      ["unavailable", [{ ...image, unavailable: true }], "cid:piece"],
      ["missing", [image], "cid:unknown"],
      ["url", [image], "/api/messages/another/attachments/image"],
    ] as const) {
      await render(id, false, [...files], src);
      await click();
      assert.equal(requests.length, 3, id);
      assert.equal(dom.window.document.querySelector("img"), null, id);
    }
    await render("encoded", false, [{ ...image, contentId: "piece@example.com" }], "cid:piece%40example.com");
    await click();
    assert.equal(requests.length, 4);
    await finish(3);
    assert.equal(dom.window.document.querySelector("img")?.getAttribute("src"), "blob:synthetic-2");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
