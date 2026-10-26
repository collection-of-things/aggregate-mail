import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const bundle = (await build({ entryPoints: [fileURLToPath(new URL("../src/phone-auth.ts", import.meta.url))], bundle: true, platform: "browser", target: "es2022", minify: true, write: false })).outputFiles[0].text;
test("pairing client clears the fragment before its first request and sends it only in the POST body", async () => {
  const token = "a".repeat(43);
  const dom = new JSDOM('<p id="passkey-status"></p><p id="pair-code"></p><button id="passkey-register" disabled></button>', { url: `https://mail.synthetic-tailnet.ts.net:8444/auth/pair#${token}`, runScripts: "outside-only" });
  const calls = [];
  dom.window.AbortSignal.timeout = () => new AbortController().signal;
  dom.window.fetch = async (url, options) => {
    assert.equal(dom.window.location.hash, "");
    assert.ok(!String(url).includes(token));
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ code: "123456", approved: true }) };
  };
  try {
    dom.window.eval(bundle);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls[0], { url: "/auth/passkey/pair", body: { token } });
    assert.match(dom.window.document.getElementById("pair-code").textContent, /123456/);
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, false);
    assert.ok(!dom.window.document.body.innerHTML.includes(token));
  } finally { dom.window.close(); }
});
test("missing or invalid invitations do not make requests or offer registration", () => {
  const dom = new JSDOM('<p id="passkey-status"></p><button id="passkey-register" disabled></button>', { url: "https://mail.synthetic-tailnet.ts.net:8444/auth/pair#invalid", runScripts: "outside-only" });
  dom.window.fetch = () => assert.fail("invalid invitation must not make requests");
  try {
    dom.window.eval(bundle);
    assert.equal(dom.window.location.hash, "");
    assert.equal(dom.window.document.getElementById("passkey-register").disabled, true);
    assert.match(dom.window.document.getElementById("passkey-status").textContent, /Reconnect from Settings/);
  } finally { dom.window.close(); }
});
