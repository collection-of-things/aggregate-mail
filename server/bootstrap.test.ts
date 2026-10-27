import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { quietImapWatch, quietGmailRevision } from "./imap-watch-fixture.js";

test("bootstrap is authenticated, scan-free and independent of corrupt mail", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-bootstrap-"));
  Object.assign(process.env, { MAIL_DATA_DIR: directory, MAIL_DATA_KEY: "", MAIL_CONFIG_PATH: path.join(directory, "absent.env"), MAIL_DESKTOP_TOKEN: "synthetic-bootstrap", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" });
  const store = await import("./store.js");
  const { startServer } = await import("./index.js");
  store.put("account", "a", { id: "a", email: "reader@example.test", provider: "imap", credentials: { password: "synthetic-password" } });
  store.put("draft", "d", { id: "d", accountId: "a", revision: 3, updatedAt: 1, subject: "Draft", body: "Synthetic draft body", to: ["to@example.test"], sendUnknown: true });
  const raw = new DatabaseSync(path.join(directory, "mail.sqlite"));
  raw.prepare("INSERT INTO records VALUES ('mail','bad','invalid-ciphertext')").run();
  const server = await startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { "X-Desktop-Token": "synthetic-bootstrap" };
  const prepare = DatabaseSync.prototype.prepare;
  let blockedMailReads = 0;
  try {
    assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 403);
    assert.equal((await fetch(`${origin}/api/bootstrap`, { headers: { ...headers, Origin: "https://untrusted.example" } })).status, 403);
    DatabaseSync.prototype.prepare = function(sql: string) {
      if (/mailSummary|kind='mail'/.test(sql)) { blockedMailReads++; throw Error("Bootstrap must not touch mail"); }
      return Reflect.apply(prepare, this, [sql]);
    };
    const response = await fetch(`${origin}/api/bootstrap`, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const status = await response.json();
    assert.equal(status.accounts.length, 1); assert.equal(status.draftCount, 1); assert.equal(typeof status.csrf, "string");
    assert.equal("credentials" in status.accounts[0], false);
    for (const field of ["messages", "mailCursor", "mailMode", "removedMailIds", "mailArrivals", "unreadArrivals"]) assert.equal(field in status, false, field);
    assert.equal(blockedMailReads, 0);
    DatabaseSync.prototype.prepare = prepare;
    raw.prepare("DELETE FROM records WHERE kind='mail'").run();
    const full = await (await fetch(`${origin}/api/state`, { headers })).json();
    assert.equal(full.mailMode, "snapshot"); assert.deepEqual(full.messages, []);
    assert.equal(full.csrf, status.csrf);
    const delta = await (await fetch(`${origin}/api/state?mailCursor=${encodeURIComponent(full.mailCursor)}`, { headers })).json();
    assert.equal(delta.mailMode, "delta"); assert.deepEqual(delta.messages, []);
    assert.equal(store.get("draft", "d")?.sendUnknown, true);
  } finally {
    DatabaseSync.prototype.prepare = prepare; server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); raw.close(); store.closeStore();
    rmSync(directory, { recursive: true, force: true });
  }
});
