import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import packageInfo from "../package.json" with { type: "json" };
import { quietImapWatch } from "./imap-watch-fixture.js";

test("encrypted workspace backup and non-destructive restore, synthetic only", { timeout: 90000 }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-backup-test-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  const store = await import("./store.js");
  const backup = await import("./workspace-backup.js");
  const password = "synthetic backup passphrase";
  const synthetic = { id: "a", email: "synthetic@example.test", provider: "imap" as const, credentials: { password: "EXCLUDED-CREDENTIAL" } };
  store.put("account", "a", synthetic);
  store.put("config", "config", { OPENAI_API_KEY: "EXCLUDED-API-KEY" });
  store.put("agent", "agent", { id: "agent", name: "Synthetic", token: "EXCLUDED-AGENT-TOKEN", createdAt: 1, accountIds: ["a"], tools: [] });
  store.put("mcp", "settings", { enabled: false, allowSending: false, token: "EXCLUDED-MCP-TOKEN" } as never);
  const mail = { id: "a:1", accountId: "a", remoteId: "1", sender: "Synthetic", address: "sender@example.test", to: "synthetic@example.test", subject: "EXCLUDED-MAIL-SUBJECT", preview: "EXCLUDED-PREVIEW", body: "EXCLUDED-CACHED-BODY", date: 1, unread: true, pinned: true, category: "important" as const, relevance: 1 as const, reason: "Synthetic", archived: false, snoozedUntil: 1234567 };
  store.put("mail", mail.id, mail);
  store.put("commitment", "c", { id: "c", accountId: "a", sourceMailId: mail.id, text: "Synthetic work", reason: "Explicit", status: "needs-work", evidenceMailIds: [mail.id], revision: 1, updatedAt: 1, history: [] });
  store.put("project", "p", { id: "p", name: "Synthetic project", sourceMailIds: [mail.id], accountIds: ["a"], crossAccountConfirmed: false, revision: 1, updatedAt: 1 });
  store.put("decision", "d", { id: "d", projectId: "p", text: "Synthetic decision", sourceMailIds: [mail.id], createdAt: 1 });
  store.put("rule", "r", { id: "r", accountId: "a", sender: "sender@example.test", instruction: "Synthetic rule", category: "important", relevance: 1 });
  const draftId = "bc82c740-46ee-4c0a-b24b-d216c92cf909";
  store.put("draft", draftId, { id: draftId, accountId: "a", to: "" as unknown as string[], subject: "Synthetic draft", body: "SYNTHETIC-LOCAL-TEXT", sendUnknown: true, revision: 2, updatedAt: 1 });
  store.put("compose", "preferences", { templates: [{ id: "t", name: "Synthetic", subject: "Template", body: "Template text" }], signatures: { a: "Synthetic signature" } });
  store.put("proposal", "proposal", { id: "proposal", agentId: "agent", accountId: "a", action: "read", payload: { mailId: mail.id }, digest: "synthetic", createdAt: 1, status: "pending" });
  const payload = backup.captureBackup();
  let file = "";
  await t.test("allowlist excludes secrets and cached message text", () => {
    const plain = JSON.stringify(payload);
    for (const marker of ["EXCLUDED-CREDENTIAL", "EXCLUDED-API-KEY", "EXCLUDED-AGENT-TOKEN", "EXCLUDED-MCP-TOKEN", "EXCLUDED-CACHED-BODY", "EXCLUDED-MAIL-SUBJECT", "EXCLUDED-PREVIEW"])
      assert.ok(!plain.includes(marker), marker);
    assert.ok(plain.includes("SYNTHETIC-LOCAL-TEXT"));
    assert.equal(payload.manifest.counts.workspaceMailState, 1);
    assert.equal(payload.manifest.appVersion, packageInfo.version);
    assert.deepEqual((payload.records.find(row => row.kind === "draft")!.value as { to: string[] }).to, [""]);
  });
  await t.test("round trip authenticates manifest and every local record", async () => {
    file = await backup.sealBackup(payload, password);
    assert.ok(!file.includes("SYNTHETIC-LOCAL-TEXT"));
    assert.deepEqual(await backup.openBackup(file, password), payload);
    assert.notEqual(await backup.sealBackup(payload, password), file);
  });
  await t.test("large draft payload round trips within the file limit", async () => {
    const large = structuredClone(payload);
    const draft = large.records.find(row => row.kind === "draft")!;
    draft.value = { ...(draft.value as object), body: "Synthetic large draft. ".repeat(30000) };
    const encrypted = await backup.sealBackup(large, password);
    assert.deepEqual(await backup.openBackup(encrypted, password), large);
  });
  await t.test("wrong passphrase, tampered ciphertext and truncation fail closed", async () => {
    await assert.rejects(backup.openBackup(file, "wrong synthetic password"), /Wrong passphrase or damaged/);
    const envelope = JSON.parse(file);
    const data = Buffer.from(envelope.data, "base64"); data[0] ^= 1;
    await assert.rejects(backup.openBackup(JSON.stringify({ ...envelope, data: data.toString("base64") }), password), /Wrong passphrase or damaged/);
    await assert.rejects(backup.openBackup(file.slice(0, -30), password), /Wrong passphrase or damaged/);
    await assert.rejects(backup.openBackup(JSON.stringify({ ...envelope, version: 2 }), password), /Unsupported backup format/);
    await assert.rejects(backup.openBackup(JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, N: 2 ** 30 } }), password), /damaged/);
  });
  await t.test("newer authenticated payload version and malformed counts rejected", async () => {
    const envelope = JSON.parse(file);
    const key = scryptSync(password, Buffer.from(envelope.kdf.salt, "base64"), 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from("emc2-workspace-backup:1"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ ...payload, manifest: { ...payload.manifest, formatVersion: 2 } })), cipher.final()]);
    await assert.rejects(backup.openBackup(JSON.stringify({ ...envelope, iv: iv.toString("base64"), data: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }), password), /Unsupported backup format/);
    assert.throws(() => backup.mergeBackup({ ...payload, manifest: { ...payload.manifest, counts: {} } }), /damaged/);
  });
  await t.test("preview changes nothing, existing records win", () => {
    const result = backup.mergeBackup(payload);
    assert.equal(result.skipped.commitment, 1);
    assert.equal(result.skipped.template, 1);
    assert.equal(result.skipped.workspaceMailState, 1);
    backup.mergeBackup(payload, true);
    assert.equal(store.get("proposal", "proposal")!.status, "pending", "existing history retained");
    assert.equal(store.all("draft").length, 1);
  });
  await t.test("account remapping, merged preferences and deferred flags", () => {
    for (const kind of ["commitment", "project", "decision", "draft", "rule", "proposal"] as const)
      for (const value of store.all(kind)) store.remove(kind, value.id);
    store.remove("mail", mail.id); store.remove("account", "a"); store.remove("compose", "preferences");
    const missing = backup.mergeBackup(payload);
    assert.equal(missing.missingAccounts, 1);
    assert.throws(() => backup.mergeBackup(payload, true), /Connect each backup account/);
    assert.equal(store.all("commitment").length, 0);
    store.put("account", "b", { ...synthetic, id: "b" });
    store.put("compose", "preferences", { templates: [{ id: "other", name: "Keep", subject: "", body: "" }], signatures: {} });
    const result = backup.mergeBackup(payload, true);
    assert.equal(result.missingAccounts, 0);
    assert.equal(store.get("commitment", "c")!.accountId, "b");
    assert.equal(store.get("commitment", "c")!.sourceMailId, "b:1");
    assert.equal(store.get("proposal", "proposal")!.status, "unknown");
    assert.equal(store.get("draft", draftId)!.sendUnknown, true);
    assert.deepEqual(store.get("compose", "preferences")!.templates.map(t => t.id), ["other", "t"]);
    assert.equal(store.get("compose", "preferences")!.signatures.b, "Synthetic signature");
    assert.ok(store.get("workspaceMailState", "b:1"));
    store.put("mail", "b:1", { ...mail, id: "b:1", accountId: "b", pinned: false, snoozedUntil: null });
    assert.equal(store.get("mail", "b:1")!.pinned, true);
    assert.equal(store.get("mail", "b:1")!.snoozedUntil, 1234567);
    assert.equal(store.get("workspaceMailState", "b:1"), undefined);
    store.put("mail", "b:1", { ...store.get("mail", "b:1")!, pinned: false, snoozedUntil: null });
    assert.equal(store.get("mail", "b:1")!.pinned, false, "later local edits preserved");
  });
  await t.test("write failure rolls back the entire merge", () => {
    store.remove("commitment", "c"); store.remove("project", "p");
    const db = new DatabaseSync(path.join(directory, "mail.sqlite"));
    db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON records WHEN NEW.kind='project' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    assert.throws(() => backup.mergeBackup(payload, true), /synthetic failure/);
    assert.equal(store.get("commitment", "c"), undefined);
    assert.equal(store.get("project", "p"), undefined);
    db.exec("DROP TRIGGER synthetic_failure"); db.close();
  });
  await t.test("export rejects retained account references without identity hints", () => {
    const account = store.get("account", "b")!;
    store.remove("account", "b");
    assert.throws(() => backup.captureBackup(), /retained work for a removed account/);
    store.put("account", "b", account);
  });
  await t.test("preview and import enforce deduplicated destination quotas atomically", () => {
    const beforeDrafts = store.all("draft");
    const beforeCompose = store.get("compose", "preferences")!;
    const makePayload = (kind: "draft" | "template", total: number) => {
      const source = payload.records.find(row => row.kind === kind)!;
      const records = Array.from({ length: total }, (_, i) => ({ kind, id: `quota-${kind}-${i}`, value: { ...(source.value as object), id: `quota-${kind}-${i}` } }));
      return { ...payload, records, manifest: { ...payload.manifest, counts: Object.fromEntries(Object.keys(payload.manifest.counts).map(name => [name, name === kind ? total : 0])) } };
    };
    for (const kind of ["draft", "template"] as const) {
      const incoming = makePayload(kind, kind === "draft" ? 100 : 50);
      const before = JSON.stringify({ drafts: store.all("draft"), compose: store.get("compose", "preferences") });
      for (const commit of [false, true]) {
        assert.throws(() => backup.mergeBackup(incoming, commit), /limit/);
        assert.equal(JSON.stringify({ drafts: store.all("draft"), compose: store.get("compose", "preferences") }), before);
      }
    }
    // Exact duplicates at the limit remain admissible; new records after preview
    // are counted again by the import transaction.
    for (const draft of beforeDrafts) store.remove("draft", draft.id);
    const incoming = makePayload("draft", 100);
    assert.equal(backup.mergeBackup(incoming).added.draft, 100);
    store.put("draft", "extra", { ...beforeDrafts[0], id: "extra" });
    assert.throws(() => backup.mergeBackup(incoming, true), /limit/);
    store.remove("draft", "extra");
    backup.mergeBackup(incoming, true);
    assert.equal(backup.mergeBackup(incoming).skipped.draft, 100);
    for (const draft of store.all("draft")) store.remove("draft", draft.id);
    for (const draft of beforeDrafts) store.put("draft", draft.id, draft);
    store.put("compose", "preferences", beforeCompose);
  });
  await t.test("API requires preview receipt before merge", async () => {
    process.env.MAIL_DESKTOP_TOKEN = "synthetic-backup-desktop";
    // No connected accounts means startup cannot contact a live provider.
    store.remove("account", "b");
    const backend = await import("./index.js");
    const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch);
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const desktop = { "x-desktop-token": "synthetic-backup-desktop", "content-type": "application/json" };
    const state = await (await fetch(`${base}/api/state`, { headers: desktop })).json() as { csrf: string };
    const headers = { ...desktop, "x-csrf-token": state.csrf };
    const post = async (action: string, extra = {}, override = {}) => fetch(`${base}/api/workspace-backup/${action}`, { method: "POST", headers: { ...headers, ...override }, body: JSON.stringify({ file, passphrase: password, ...extra }) });
    try {
      assert.equal((await post("import")).status, 400);
      const preview = await (await post("preview")).json() as { previewToken: string };
      assert.equal((await post("export", {}, { "x-desktop-token": "wrong" })).status, 403);
      assert.equal((await post("export", {}, { "x-csrf-token": "wrong" })).status, 403);
      assert.equal((await post("export", {}, { origin: "https://untrusted.example.test" })).status, 403);
      // Node fetch overwrites Host; use the existing raw-HTTP test pattern.
      const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`${base}/api/workspace-backup/export`, { method: "POST", headers: { ...headers, Host: "untrusted.example.test" } }, response => {
          response.resume(); response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject); request.end(JSON.stringify({ passphrase: password }));
      });
      assert.equal(hostStatus, 403);
      assert.equal((await post("export")).status, 400, "retained work without a connected identity cannot be exported");
      const badJson = await fetch(`${base}/api/workspace-backup/import`, { method: "POST", headers, body: '{"passphrase":"SYNTHETIC-DO-NOT-ECHO"' });
      assert.equal(badJson.status, 400);
      assert.ok(!(await badJson.text()).includes("SYNTHETIC-DO-NOT-ECHO"));
      store.put("account", "b", { ...synthetic, id: "b" });
      assert.equal((await post("import", { previewToken: preview.previewToken })).status, 200);

      assert.equal((await post("import", { previewToken: preview.previewToken })).status, 400);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  store.closeStore();
  rmSync(directory, { recursive: true, force: true });
});
