import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { Mail, MailSummary, StateResponse } from "../shared/types.js";
import { compileMailSearch } from "../shared/mail-search.js";
import { matchesRule } from "../shared/rules.js";

if (!process.env.EMC2_ON_DEMAND_CHILD) {
  test("on-demand cached mail contracts in a fresh encrypted store", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "emc2-on-demand-"));
    try {
      const env = { ...process.env, EMC2_ON_DEMAND_CHILD: "1", MAIL_DATA_DIR: directory,
        MAIL_DATA_KEY: Buffer.alloc(32, 71).toString("base64"), MAIL_CONFIG_PATH: path.join(directory, "absent.env"),
        MAIL_DESKTOP_TOKEN: "synthetic-session", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" };
      delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--test", fileURLToPath(import.meta.url)], { env, encoding: "utf8", timeout: 120000 });
      assert.equal(child.status, 0, child.stdout + child.stderr);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test("persisted summaries avoid body decryption after process restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "emc2-cold-summary-"));
    try {
      for (const scenario of ["seed", "cold-summary"]) {
        const env: NodeJS.ProcessEnv = { ...process.env, EMC2_ON_DEMAND_CHILD: scenario, MAIL_DATA_DIR: directory, MAIL_DATA_KEY: Buffer.alloc(32, 72).toString("base64") };
        delete env.NODE_TEST_CONTEXT;
        const child = spawnSync(process.execPath, ["--import", "tsx", "--test", fileURLToPath(import.meta.url)], { env, encoding: "utf8", timeout: 30000 });
        assert.equal(child.status, 0, child.stdout + child.stderr);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else if (process.env.EMC2_ON_DEMAND_CHILD === "seed") test("seed atomic encrypted companions", async () => {
  const store = await import("./store.js");
  const mail: Mail = { id: "cold", accountId: "a", remoteId: "cold", sender: "Sender", address: "sender@example.test", to: "reader@example.test", subject: "Cold cache", preview: "Summary", body: "COLD-BODY-ONLY", html: "<p>Cached HTML</p>", attachments: [], date: 1, unread: false, archived: false, category: "other", relevance: 1, reason: "", snoozedUntil: null };
  try {
    store.put("mail", mail.id, mail);
    assert.throws(() => store.transaction(() => { store.put("mail", "rollback", { ...mail, id: "rollback" }); throw Error("rollback"); }));
    assert.equal(store.get("mailSummary", "rollback"), undefined, "source and companion roll back together");
  } finally { store.closeStore(); }
});
else if (process.env.EMC2_ON_DEMAND_CHILD === "cold-summary") test("read cold metadata without loading bodies", async () => {
  const store = await import("./store.js");
  const parse = JSON.parse;
  let bodies = 0;
  JSON.parse = ((value: string, ...args: unknown[]) => {
    if (value.includes('"body":')) bodies++;
    return Reflect.apply(parse, JSON, [value, ...args]);
  }) as typeof JSON.parse;
  try {
    const summary = await store.mailSummaryChanges();
    assert.equal(summary.messages.length, 1); assert.equal(bodies, 0);
    assert.equal("body" in summary.messages[0], false);
    assert.equal(store.get("mail", "cold")?.body, "COLD-BODY-ONLY"); assert.equal(bodies, 1);
    const result = store.compactStore({ cleanupOrphans: true, isDrained: () => true });
    assert.equal(result.cleanupSkipped, undefined, "derived summaries are a recognized conservative cleanup kind");
    assert.equal(store.count("mail"), 1); assert.equal(store.count("mailSummary"), 1);
  } finally { JSON.parse = parse; store.closeStore(); }
});
else test("cold summaries, exact scans, local body identity and full internal reads", async () => {
  const store = await import("./store.js");
  const { findMail } = await import("./mail-actions.js");
  const { startServer } = await import("./index.js");
  const { providers } = await import("./providers.js");
  const { fingerprint, previewRule } = await import("./workspace.js");
  const { quietImapWatch, quietGmailRevision } = await import("./imap-watch-fixture.js");
  const mail = (id: string): Mail => ({ id, accountId: "a", remoteId: id, sender: "Jose\u0301", address: "sender@example.test", to: "josé@example.test",
    subject: "Title tail", preview: "Preview head", body: id === "1" ? "Réunion\u00a0du\n projet ก่า private-body-only?" : "Excluded draft กา",
    html: "<p>Private formatted source</p>", images: [], attachments: [], date: 1, unread: true, archived: false, category: "other", relevance: 1, reason: "Newsletter", snoozedUntil: null });
  const raw = new DatabaseSync(path.join(process.env.MAIL_DATA_DIR!, "mail.sqlite"));
  // Bypass write-through metadata so the first read must initialize from ciphertext.
  for (let i = 1; i <= 97; i++) raw.prepare("INSERT INTO records VALUES ('mail',?,?)").run(String(i), store.encrypt(mail(String(i))));
  store.put("account", "a", { id: "a", email: "reader@example.test", provider: "imap", credentials: {} });
  const rule = { id: "body-rule", sender: "sender@example.test", instruction: "Question", category: "important" as const, relevance: 3 as const, condition: { field: "body" as const, contains: "private-body-only" } };
  store.put("rule", rule.id, rule);
  let providerCalls = 0;
  const content = providers.imap.content;
  providers.imap.content = async () => { providerCalls++; throw Error("Offline"); };
  const server = await startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}/api`;
  const headers = { "X-Desktop-Token": "synthetic-session", Connection: "close" };
  try {
    const state = await (await fetch(`${origin}/state`, { headers })).json() as StateResponse;
    assert.equal(state.messages.length, 97);
    for (const summary of state.messages) {
      for (const key of ["body", "html", "images", "invitation"]) assert.equal(key in summary, false);
      assert.match(summary.contentVersion, /^[a-f0-9]{64}$/);
    }
    const first = state.messages.find(m => m.id === "1")!;
    assert.equal(first.inboxTab, "primary", "body-conditioned Teach remains authoritative without renderer bodies");
    const pathFor = (m: MailSummary) => `${origin}/messages/${encodeURIComponent(m.id)}/body?accountId=${encodeURIComponent(m.accountId)}&contentVersion=${m.contentVersion}`;
    const body = await (await fetch(pathFor(first), { headers })).json();
    assert.equal(body.mail.body, mail("1").body); assert.equal(body.mail.html, mail("1").html);
    assert.equal(body.contentVersion, first.contentVersion);
    assert.equal((await fetch(pathFor({ ...first, accountId: "b" }), { headers })).status, 404);
    // Legacy plain-text cache needs no provider access even when HTML metadata is absent.
    const legacy = { ...mail("legacy"), html: undefined, attachments: undefined, images: undefined };
    store.put("mail", legacy.id, legacy);
    const legacySummary = (await store.mailSummaryChanges()).messages.find(m => m.id === legacy.id)!;
    assert.equal((await (await fetch(pathFor(legacySummary), { headers })).json()).mail.body, legacy.body);
    assert.equal(providerCalls, 0);
    const accounts = state.accounts;
    const queries = ['body:"reunion du projet" -body:draft', "body:ก่า", "body:กา", '"tail preview"', "to:jose@example.test", "to:josé@example.test", "private-body-only?", "-body:private-body-only", 'body:"open'];
    for (const query of queries) {
      const expected = (await store.readMail()).filter(compileMailSearch(query, accounts).matches).map(m => m.id).sort();
      const result = await store.searchMail(query, accounts);
      assert.deepEqual(result.matches.map(m => m.id).sort(), expected, query);
      assert.ok(result.matches.every(m => Object.keys(m).sort().join(",") === "accountId,contentVersion,id"));
    }
    const httpSearch = await (await fetch(`${origin}/messages/search?query=${encodeURIComponent('body:"reunion du projet"')}`, { headers })).json();
    assert.deepEqual(httpSearch.matches.map((m: { id: string }) => m.id), ["1"]);
    assert.equal(JSON.stringify(httpSearch).includes("private-body-only"), false);
    const scanSnapshot = store.searchMail("body:private-body-only", accounts);
    setImmediate(() => store.put("mail", "1", { ...mail("1"), body: "Written during scan" }));
    const frozenSearch = await scanSnapshot;
    assert.deepEqual(frozenSearch.matches.map(m => m.id), ["1"], "yielding search holds a coherent SQLite snapshot");
    assert.equal(frozenSearch.matches[0].contentVersion, first.contentVersion);
    store.put("mail", "1", mail("1"));
    const controller = new AbortController();
    const scan = store.searchMail("body:excluded", accounts, controller.signal);
    setImmediate(() => controller.abort());
    await assert.rejects(scan, { name: "AbortError" });
    assert.equal(matchesRule(findMail("1"), rule), true);
    const { id: _ruleId, ...ruleInput } = rule;
    assert.equal(previewRule({ ...ruleInput, accountId: "a" }).count, 1, "Teach previews inspect the complete body");
    assert.equal((await store.readMail("a")).find(m => m.id === "1")?.body, mail("1").body, "MCP, rules and fingerprints retain full reads");
    store.put("mcp", "settings", { enabled: true, allowSending: false, token: "synthetic-general" });
    store.put("agent", "reader", { id: "reader", name: "Synthetic reader", accountIds: ["a"], tools: ["read_email"], token: "synthetic-reader", createdAt: 1 });
    const mcp = await fetch(origin.replace(/\/api$/, "/mcp"), { method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer synthetic-reader" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_email", arguments: { id: "1" } } }) });
    assert.equal(mcp.status, 200);
    const mcpBody = await mcp.json(); assert.equal(mcpBody.result.isError, undefined);
    assert.equal(JSON.parse(mcpBody.result.content[0].text).body, mail("1").body);
    const fingerprintBefore = fingerprint("1");
    const before = await store.mailSummaryChanges();
    assert.throws(() => store.transaction(() => { store.put("mail", "1", { ...mail("1"), body: "rolled back" }); throw Error("rollback"); }));
    assert.equal((await store.mailSummaryChanges(before.mailCursor)).mailCursor, before.mailCursor);
    store.put("mail", "1", { ...mail("1"), body: "Changed exact content" });
    assert.notEqual(fingerprint("1"), fingerprintBefore, "body-only edits still invalidate proposals");
    const delta = await store.mailSummaryChanges(before.mailCursor);
    assert.equal(delta.messages.length, 1); assert.notEqual(delta.messages[0].contentVersion, first.contentVersion);
    assert.equal((await fetch(pathFor(first), { headers })).status, 409, "stale source must not hydrate");
    raw.prepare("UPDATE records SET value=? WHERE kind='mail' AND id='1'").run(store.encrypt(mail("1")));
    assert.equal((await store.mailSummaryChanges(delta.mailCursor)).mailMode, "snapshot");
    store.remove("rule", rule.id);
    const afterRule = await store.mailSummaryChanges();
    assert.equal(afterRule.messages.find(m => m.id === "1")?.inboxTab, "newsletters");
  } finally {
    providers.imap.content = content; server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve())); raw.close(); store.closeStore();
  }
});
