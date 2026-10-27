import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { quietGmailRevision, quietImapWatch } from "./imap-watch-fixture.js";
import type { Draft, OutboxStatus } from "../shared/types.js";

test("authenticated HTTP queue, revision locks, Undo, preferences and update holds", { timeout: 60000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-outbox-http-"));
  Object.assign(process.env, { MAIL_DATA_DIR: directory, MAIL_CONFIG_PATH: path.join(directory, "absent.env"),
    MAIL_DESKTOP_TOKEN: "synthetic-outbox-http", MAIL_DATA_KEY: Buffer.alloc(32, 25).toString("base64"), TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" });
  const store = await import("./store.js");
  const backend = await import("./index.js");
  const { providers } = await import("./providers.js");
  store.put("account", "a", { id: "a", email: "sender@example.test", provider: "imap", credentials: {} });
  let calls = 0;
  t.mock.method(providers.imap, "send", async () => { calls++; });
  const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { "X-Desktop-Token": "synthetic-outbox-http", "Content-Type": "application/json", "X-CSRF-Token": "" };
  const request = (route: string, method = "GET", body?: unknown) => fetch(`${origin}/api${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const state = await (await request("/state")).json() as { csrf: string }; headers["X-CSRF-Token"] = state.csrf;
    assert.equal((await fetch(`${origin}/api/outbox`)).status, 403);
    assert.equal((await request("/compose-preferences", "PUT", { templates: [], signatures: {}, undoSendSeconds: 7 })).status, 400);
    for (const undoSendSeconds of [0, 5, 10, 30]) {
      assert.equal((await request("/compose-preferences", "PUT", { templates: [], signatures: {}, undoSendSeconds })).status, 200);
      assert.equal((await (await request("/compose-preferences")).json() as { undoSendSeconds: number }).undoSendSeconds, undoSendSeconds);
    }
    await request("/compose-preferences", "PUT", { templates: [], signatures: {}, undoSendSeconds: 30 });
    await request("/compose-preferences", "PUT", { templates: [], signatures: {} });
    assert.equal((await (await request("/compose-preferences")).json() as { undoSendSeconds: number }).undoSendSeconds, 30,
      "Unrelated Compose preferences saves preserve the delay");
    const content = { to: ["one@example.test"], bcc: ["hidden@example.test"], subject: "Synthetic HTTP subject", body: "Synthetic content" };
    const draft = await (await request("/accounts/a/drafts", "POST", content)).json() as Draft;
    const value = { sourceDraftId: draft.id, sourceRevision: draft.revision, payload: { accountId: "a", ...content } };
    assert.equal((await request("/send", "POST", value.payload)).status, 400, "Raw legacy requests cannot bypass the outbox");
    const queued = await request("/send", "POST", value); assert.equal(queued.status, 202);
    const { entry } = await queued.json() as { entry: OutboxStatus };
    assert.equal(calls, 0);
    const replay = await (await request("/send", "POST", value)).json() as { entry: OutboxStatus };
    assert.equal(replay.entry.id, entry.id);
    assert.equal((await request("/send", "POST", { ...value, payload: { ...value.payload, subject: "Changed" } })).status, 400);
    const statuses = await (await request("/outbox")).text();
    assert.doesNotMatch(statuses, /Synthetic HTTP subject|hidden@example.test|Synthetic content/);
    assert.equal((await request(`/accounts/a/drafts/${draft.id}`, "PUT", { ...content, revision: draft.revision })).status, 409);
    await backend.quiesceMail(1000);
    assert.equal(store.get("outbox", entry.id)?.review, true);
    assert.equal((await request(`/outbox/${entry.id}/send`, "POST", {})).status, 503);
    backend.resumeMail(); assert.equal(calls, 0);
    const restored = await (await request(`/outbox/${entry.id}/edit`, "POST", {})).json() as Draft;
    assert.deepEqual(restored.bcc, content.bcc); assert.equal(restored.sendUnknown, false); assert.equal(restored.revision, 2);
    assert.equal(store.all("outbox").length, 0);
    const next = await (await request("/send", "POST", { ...value, sourceRevision: restored.revision })).json() as { entry: OutboxStatus };
    assert.equal((await request(`/outbox/${next.entry.id}/send`, "POST", {})).status, 200);
    assert.equal(calls, 1); assert.equal(store.get("outbox", next.entry.id)?.state, "sent");
    assert.equal((await request(`/outbox/${next.entry.id}/send`, "POST", {})).status, 400);
    assert.equal(calls, 1);
  } finally {
    backend.resumeMail(); await new Promise<void>(resolve => server.close(() => resolve()));
    store.closeStore(); rmSync(directory, { recursive: true, force: true });
  }
});
