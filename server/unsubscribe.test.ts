import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { parseUnsubscribe, publicUnsubscribeAddress, unsubscribeUrl } from "../shared/unsubscribe.js";
import { parse } from "./providers.js";

const header = (list: string, post?: string) => [
  { key: "list-unsubscribe", line: `List-Unsubscribe: ${list}` },
  ...(post ? [{ key: "list-unsubscribe-post", line: `List-Unsubscribe-Post: ${post}` }] : []),
];
const url = "https://lists.example.com/remove?token=synthetic";

test("unsubscribe parsing selects POST, mailto and manual HTTPS without doing network work", async () => {
  assert.deepEqual(parseUnsubscribe(header(`<${url}>, <mailto:leave@example.com>`, "List-Unsubscribe=One-Click")), { kind: "post", url });
  assert.deepEqual(parseUnsubscribe(header(`<${url}>`)), { kind: "link", url });
  assert.deepEqual(parseUnsubscribe(header("<mailto:leave@example.com?subject=Remove%20me&body=Please%20unsubscribe>")), {
    kind: "mailto", address: "leave@example.com", subject: "Remove me", body: "Please unsubscribe",
  });
  assert.equal(parseUnsubscribe(header(`<${url}>`, "unrecognized"))?.kind, "link");
  assert.equal(parseUnsubscribe(header(`<${url}>`, "List-Unsubscribe=One-Click\r\n injected:value"))?.kind, "link");
  assert.equal(parseUnsubscribe([]), undefined);
  assert.equal(parseUnsubscribe([...header(`<${url}>`), ...header(`<${url}>`)])?.kind, "blocked");
  assert.equal(parseUnsubscribe(header(`<https://lists.example.com/${"x".repeat(8192)}>`))?.kind, "blocked");
  assert.deepEqual(parseUnsubscribe(header(`<mailto:leave@example.com?body=${"字".repeat(3000)}>`)), { kind: "blocked", reason: "headers" });
  assert.equal(unsubscribeUrl(`https://lists.example.com/${"字".repeat(1000)}`), undefined);
  for (const target of ["http://example.com/", "https://localhost/", "https://127.1/", "https://2130706433/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://10.1.2.3/", "https://user:pass@example.com/", "https://example.com:8443/", "mailto:leave@example.com?bcc=victim@example.com", "mailto:leave@example.com?subject=a%0d%0aBcc:victim@example.com", "mailto:a@example.com,b@example.com", "javascript:alert(1)"])
    assert.equal(parseUnsubscribe(header(`<${target}>`))?.kind, "blocked", target);
  const source = Buffer.from(["From: Sender <sender@example.com>", "To: reader@example.com", "Subject: Newsletter",
    `List-Unsubscribe: <${url}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click", "", "Synthetic mail"].join("\r\n"));
  const mail = await parse({ id: "a", email: "reader@example.com", provider: "imap", credentials: {} }, "1", source, false);
  assert.deepEqual(mail.unsubscribe, { kind: "post", url });
});

test("unsubscribe IP policy rejects special-use and encoded local targets", () => {
  for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "192.0.0.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:8.8.8.8", "64:ff9b::a00:1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::", "2001::1"])
    assert.equal(publicUnsubscribeAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])
    assert.equal(publicUnsubscribeAddress(address), true, address);
  assert.equal(unsubscribeUrl("https://0x7f000001/"), undefined);
});

test("reviewed unsubscribe pins public DNS, refuses redirects and prepares an ordinary draft without sending", { timeout: 60000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-unsubscribe-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 58).toString("base64");
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  const store = await import("./store.js");
  const { mountUnsubscribe, unsubscribeService } = await import("./unsubscribe.js");
  let calls = 0, resolutions = 0, status = 204;
  let addresses = [{ address: "8.8.8.8", family: 4 }];
  const service = unsubscribeService({
    resolve: async () => { resolutions++; return addresses; },
    post: async (target, pinned, signal) => {
      calls++;
      assert.equal(target.href, url); assert.equal(pinned.address, "8.8.8.8"); assert.equal(signal.aborted, false);
      return status;
    },
  });
  store.put("account", "a", { id: "a", email: "reader@example.com", provider: "imap", credentials: {} });
  const mail = await parse({ id: "a", email: "reader@example.com", provider: "imap", credentials: {} }, "1",
    Buffer.from(["From: Sender <sender@example.com>", "To: reader@example.com", `List-Unsubscribe: <${url}>`,
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click", "", "Synthetic"].join("\r\n")), false);
  store.put("mail", mail.id, { ...mail, category: "other", relevance: 1, reason: "Newsletter", archived: false, snoozedUntil: null });
  const app = express(); app.use(express.json()); mountUnsubscribe(app, service);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (body: unknown) => fetch(`${origin}/api/messages/a%3A1/unsubscribe`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const expected = { kind: "post", url };
  try {
    assert.equal((await fetch(`${origin}/api/messages/a%3A1/unsubscribe`)).status, 404);
    assert.equal((await request({ expected })).status, 400);
    assert.equal((await request({ confirmed: false, expected })).status, 400);
    assert.equal((await request({ confirmed: true, expected: { kind: "post", url: "https://other.example.com/" } })).status, 409);
    assert.equal(calls, 0); assert.equal(resolutions, 0);
    assert.deepEqual(await (await request({ confirmed: true, expected })).json(), { kind: "sent" });
    assert.equal(calls, 1); assert.equal(resolutions, 1, "one resolution is passed through to the pinned transport");
    for (const privateAddress of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fe80::1", "::ffff:127.0.0.1"]) {
      addresses = [{ address: "8.8.8.8", family: 4 }, { address: privateAddress, family: privateAddress.includes(":") ? 6 : 4 }];
      const rejected = await request({ confirmed: true, expected });
      assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /private, local or reserved/);
    }
    assert.equal(calls, 1, "mixed public/private DNS never reaches the transport");
    addresses = [{ address: "8.8.8.8", family: 4 }]; status = 302;
    assert.equal((await request({ confirmed: true, expected })).status, 502);
    assert.equal(calls, 2, "redirects are not retried or followed");
    status = 204;
    const link = { kind: "link", url } as const;
    store.put("mail", mail.id, { ...store.get("mail", mail.id)!, unsubscribe: link });
    assert.deepEqual(await (await request({ confirmed: true, expected: link })).json(), link);
    assert.equal(calls, 2, "checking a browser link does not fetch it");
    const mailto = { kind: "mailto", address: "leave@example.com", subject: "Remove me", body: "Please unsubscribe" } as const;
    store.put("mail", mail.id, { ...store.get("mail", mail.id)!, unsubscribe: mailto });
    const response = await request({ confirmed: true, expected: mailto });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.kind, "draft"); assert.equal(result.draft.accountId, "a");
    assert.deepEqual(result.draft.to, [mailto.address]); assert.equal(result.draft.subject, mailto.subject); assert.equal(result.draft.body, mailto.body);
    assert.equal(store.all("draft").length, 1); assert.equal(calls, 2);
    assert.equal(store.get("mail", mail.id)?.archived, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.closeStore(); rmSync(directory, { recursive: true, force: true });
  }
});
