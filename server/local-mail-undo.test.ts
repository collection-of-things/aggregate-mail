import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Mail } from "../shared/types.js";

test("local Undo binds exact identities and row versions, rejects tampering and never contacts providers", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-local-undo-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 11).toString("base64");
  process.env.MAIL_CONFIG_PATH = path.join(directory, "synthetic-settings.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-undo-session";
  const { put, get, closeStore } = await import("./store.js");
  const { providers } = await import("./providers.js");
  t.mock.method(providers.imap, "update", async () => { assert.fail("local Undo must not contact a provider"); });
  const { startServer } = await import("./index.js");
  const server = await startServer(0);
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); closeStore(); rmSync(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { "Content-Type": "application/json", "X-Desktop-Token": "synthetic-undo-session" };
  const { csrf } = await (await fetch(`${origin}/api/state`, { headers })).json() as { csrf: string };
  const authorized = { ...headers, "X-CSRF-Token": csrf };
  const original: Mail = { id: "one", accountId: "a", remoteId: "remote-one", messageId: "<one@example.test>",
    sender: "Synthetic", address: "sender@example.test", to: "reader@example.test", subject: "Synthetic Undo",
    body: "Preserve body", preview: "Preserve preview", date: 1, unread: true, archived: false,
    category: "important", relevance: 2, reason: "Keep", snoozedUntil: null };
  put("mail", original.id, original);
  const patch = async (action: string, until?: number) => {
    const response = await fetch(`${origin}/api/messages/one`, { method: "PATCH", headers: authorized, body: JSON.stringify({ action, ...(until ? { until } : {}) }) });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ undo?: { id: string; accountId: string; token: string } }>;
  };
  const undo = (receipt: { id: string; accountId: string; token: string }, extra: Record<string,string> = {}, id = receipt.id) =>
    fetch(`${origin}/api/messages/${id}/undo`, { method: "POST", headers: { ...authorized, ...extra }, body: JSON.stringify({ accountId: receipt.accountId, token: receipt.token }) });
  const first = (await patch("pin")).undo;
  assert.ok(first, "single-message local actions return a captured Undo receipt");
  assert.equal(first.id, "one"); assert.equal(first.accountId, "a");
  const pinned = get("mail", "one");
  for (const bad of [{ ...first, accountId: "b" }, { ...first, token: first.token.slice(0, -8) }, { ...first, token: `x${first.token.slice(1)}` }, { ...first, token: `${first.token}!` }]) {
    assert.equal((await undo(bad)).status, 409); assert.deepEqual(get("mail", "one"), pinned);
  }
  assert.equal((await undo(first, {}, "different")).status, 409);
  assert.equal((await undo(first, { Origin: "https://untrusted.example.test" })).status, 403);
  assert.equal((await fetch(`${origin}/api/messages/one/undo`, { method: "POST", headers, body: JSON.stringify(first) })).status, 403);
  assert.equal((await undo(first)).status, 200);
  assert.deepEqual(get("mail", "one"), original, "restore only pin; retain every other field");
  assert.equal((await undo(first)).status, 409, "replay is refused");
  const aba = (await patch("pin")).undo!;
  await patch("unpin"); await patch("pin");
  assert.equal((await undo(aba)).status, 409, "same value after intervening writes stays stale");
  const unpin = (await patch("unpin")).undo!;
  assert.equal((await undo(unpin)).status, 200); assert.equal(get("mail", "one")?.pinned, true);
  const snooze = (await patch("snooze", Date.now() + 120_000)).undo!;
  const beforeReturn = get("mail", "one")!;
  const returned = (await patch("unsnooze")).undo!;
  assert.equal((await undo(snooze)).status, 409);
  assert.equal((await undo(returned)).status, 200);
  assert.deepEqual(get("mail", "one"), beforeReturn, "return Undo restores exact snooze time and all other fields");
  const last = (await patch("unsnooze")).undo!;
  const changed = { ...get("mail", "one")!, body: "New body" }; put("mail", "one", changed);
  assert.equal((await undo(last)).status, 409); assert.deepEqual(get("mail", "one"), changed);
  const replacement = (await patch("snooze", Date.now() + 180_000)).undo!;
  put("mail", "one", { ...get("mail", "one")!, remoteId: "replacement", messageId: "<replacement@example.test>" });
  assert.equal((await undo(replacement)).status, 409);
  const restart = (await patch("unsnooze")).undo!;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { readFileSync } from 'node:fs';
    import { restoreLocalMail } from './server/local-mail-undo.ts';
    import { closeStore } from './server/store.ts';
    const receipt=JSON.parse(readFileSync(0,'utf8'));
    try { restoreLocalMail(receipt.id,receipt.accountId,receipt.token); process.exitCode=1; }
    catch { console.log('restart refused'); }
    finally { closeStore(); }
  `], { input: JSON.stringify(restart), encoding: "utf8", timeout: 20_000 });
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /restart refused/);
});
