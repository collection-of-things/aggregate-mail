import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("a refreshed pairing page resumes its cookie-bound approval without an invitation fragment", async () => {
  const dom = new JSDOM('<p id="passkey-status"></p><p id="pair-code"></p><button id="passkey-register" disabled>Save passkey</button>', { url: "https://mail.synthetic-tailnet.ts.net:8444/auth/pair" });
  const routes: string[] = [];
  const globals = { window: dom.window, document: dom.window.document, location: dom.window.location, history: dom.window.history,
    fetch: async (url: string) => { routes.push(url); return new Response(JSON.stringify({ code: "123456", approved: true }), { status: 200 }); } };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    await import("./phone-auth.js");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(routes, ["/auth/passkey/pair/status"]);
    assert.equal(dom.window.document.querySelector("button")!.disabled, false);
    assert.match(dom.window.document.getElementById("pair-code")!.textContent!, /123456/);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
