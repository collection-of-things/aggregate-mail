import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { google, type gmail_v1 } from "./google-api.js";
import { providerSearchPlan } from "../shared/mail-search.js";
import type { Mail } from "../shared/types.js";

// One private disposable profile per process, never the installed application's accounts.
const directory = mkdtempSync(path.join(tmpdir(), "emc2-provider-search-"));
process.env.MAIL_DATA_DIR = directory;
process.env.MAIL_DATA_KEY = Buffer.alloc(32, 59).toString("base64");
const { get, put, searchMail } = await import("./store.js");
const { searchProviderMail } = await import("./provider-search.js");

const full = 'invoice "due soon" -draft from:alice@example.test to:bob subject:"q3 plan" body:total is:unread before:2026-01-02 -after:2025-12-01 account:a -is:pinned';

test("provider search plan maps cached-search syntax and names device-only operators", () => {
  assert.deepEqual(providerSearchPlan(full), {
    terms: [
      { kind: "text", field: "any", value: "invoice", exclude: false },
      { kind: "text", field: "any", value: "due soon", exclude: false },
      { kind: "text", field: "any", value: "draft", exclude: true },
      { kind: "text", field: "from", value: "alice@example.test", exclude: false },
      { kind: "text", field: "to", value: "bob", exclude: false },
      { kind: "text", field: "subject", value: "q3 plan", exclude: false },
      { kind: "text", field: "body", value: "total", exclude: false },
      { kind: "read", read: false },
      { kind: "date", edge: "before", at: Date.UTC(2026, 0, 2) },
      // An excluded lower bound is the matching upper bound.
      { kind: "date", edge: "before", at: Date.UTC(2025, 11, 1) },
    ],
    deviceOnly: ["account:", "is:pinned"],
  });
  assert.deepEqual(providerSearchPlan("-is:read -before:2026-03-04"), {
    terms: [{ kind: "read", read: false }, { kind: "date", edge: "after", at: Date.UTC(2026, 2, 4) }],
    deviceOnly: [],
  });
  for (const query of ["", "   ", "is:pinned account:a", 'body:"open', "is:starred", "before:2026-02-30"])
    assert.ok("error" in providerSearchPlan(query), query);
});

test("Gmail search pages to the cap, imports only uncached matches and stops when cancelled", async (t) => {
  const account = { id: "a", email: "me@example.test", provider: "gmail" as const, credentials: { refreshToken: "synthetic-token" } };
  put("account", account.id, account);
  const cached: Mail = { id: "a:m1", accountId: "a", remoteId: "m1", sender: "Cached", address: "cached@example.test", to: "me@example.test", subject: "Report cached", body: "Cached body", preview: "Cached body", date: 1, unread: false, archived: true, snoozedUntil: null, category: "other", relevance: 1, reason: "", pinned: true };
  put("mail", cached.id, cached);

  let matches: string[] = [];
  const lists: { q?: string | null; maxResults?: number | null; pageToken?: string | null }[] = [];
  const reads: string[] = [];
  let onRequest = () => {};
  const raw = (id: string) => Buffer.from(`From: Sender <sender@example.test>\r\nTo: me@example.test\r\nSubject: Report ${id}\r\nMessage-ID: <${id}@example.test>\r\n\r\nSynthetic body ${id}`).toString("base64url");
  t.mock.method(google, "gmail", () => ({ users: { messages: {
    // The fixture serves at most 40 IDs a page, whatever the request allows.
    list: async (params: gmail_v1.Params$Resource$Users$Messages$List) => {
      lists.push({ q: params.q, maxResults: params.maxResults, pageToken: params.pageToken });
      onRequest();
      const start = Number(params.pageToken || 0);
      const end = start + Math.min(40, params.maxResults!);
      return { data: { messages: matches.slice(start, end).map((id) => ({ id, threadId: `t-${id}` })), nextPageToken: end < matches.length ? String(end) : undefined } };
    },
    get: async (params: gmail_v1.Params$Resource$Users$Messages$Get) => {
      reads.push(params.id!);
      if (reads.length) onRequest();
      const labelIds = params.id === "m2" ? ["INBOX", "UNREAD"] : params.id === "m3" ? ["SENT"] : ["CATEGORY_UPDATES"];
      return { data: { id: params.id, threadId: `t-${params.id}`, labelIds, internalDate: String(Date.UTC(2020, 0, 1)), raw: raw(params.id!) } };
    },
  } } }), {});

  await t.test("paging stops at the cap and leaves cached mail untouched", async () => {
    matches = Array.from({ length: 130 }, (_, i) => `m${i + 1}`);
    const result = await searchProviderMail({ accountId: "a", query: "subject:report -is:pinned", signal: new AbortController().signal });
    assert.deepEqual(result, { accountId: "a", source: "gmail", limit: 100, examined: 100, imported: 99, complete: false, narrowed: ["is:pinned"] });
    assert.deepEqual(lists, [
      { q: 'subject:"report"', maxResults: 100, pageToken: undefined },
      { q: 'subject:"report"', maxResults: 60, pageToken: "40" },
      { q: 'subject:"report"', maxResults: 20, pageToken: "80" },
    ]);
    assert.equal(reads.length, 99);
    assert.ok(!reads.includes("m1"), "cached mail is not downloaded again");
    assert.ok(!reads.includes("m101"), "matches beyond the cap are never read");
    assert.deepEqual(get("mail", "a:m1"), cached);
    const inbox = get("mail", "a:m2")!;
    assert.deepEqual([inbox.archived, inbox.unread, inbox.direction, inbox.threadId], [false, true, "received", "t-m2"]);
    assert.deepEqual([get("mail", "a:m3")!.direction, get("mail", "a:m3")!.archived], ["sent", true]);
    assert.equal(get("mail", "a:m4")!.archived, true);
    const local = await searchMail("subject:report", [account]);
    assert.equal(local.matches.length, 100, "imported matches join the encrypted cache search");
  });

  await t.test("complete and empty results report their full coverage", async () => {
    matches = ["m1", "m2", "m200"];
    lists.length = reads.length = 0;
    const result = await searchProviderMail({ accountId: "a", query: '"report m200" body:synthetic', signal: new AbortController().signal });
    assert.deepEqual(result, { accountId: "a", source: "gmail", limit: 100, examined: 3, imported: 1, complete: true, narrowed: ["body:"] });
    assert.deepEqual(lists.map((list) => list.q), ['"report m200" "synthetic"']);
    assert.deepEqual(reads, ["m200"]);
    matches = [];
    assert.deepEqual(await searchProviderMail({ accountId: "a", query: "to:nobody -after:2020-01-02 is:read", signal: new AbortController().signal }),
      { accountId: "a", source: "gmail", limit: 100, examined: 0, imported: 0, complete: true, narrowed: [] });
    assert.equal(lists.at(-1)!.q, `{to:"nobody" cc:"nobody"} before:${Date.UTC(2020, 0, 2) / 1000} is:read`);
  });

  await t.test("cancelling stops further requests and imports nothing", async () => {
    matches = Array.from({ length: 60 }, (_, i) => `c${i + 1}`);
    for (const [during, pages, read] of [["listing", 1, []], ["reading", 2, ["c1"]]] as const) {
      lists.length = reads.length = 0;
      const controller = new AbortController();
      onRequest = () => { if (during === "listing" || reads.length) controller.abort(); };
      await assert.rejects(searchProviderMail({ accountId: "a", query: "report", signal: controller.signal }), { name: "AbortError" });
      assert.equal(lists.length, pages, `no further pages after cancel while ${during}`);
      assert.deepEqual(reads, read, `no further messages after cancel while ${during}`);
      assert.equal(get("mail", "a:c1"), undefined);
    }
    onRequest = () => {};
  });
});

test("IMAP search examines Archive and Sent read-only, intersects UID searches and imports without flag changes", async (t) => {
  const account = { id: "i", email: "me@example.test", provider: "imap" as const, credentials: { imapHost: "imap.example.test", password: "synthetic-password" } };
  put("account", account.id, account);
  // The same email already cached from INBOX is recognised by its Message-ID.
  put("mail", "i:1:40", { id: "i:1:40", accountId: "i", remoteId: "1:40", sender: "Cached", address: "cached@example.test", to: "me@example.test", subject: "Invoice", body: "", preview: "", date: 1, unread: false, archived: false, snoozedUntil: null, category: "other", relevance: 1, reason: "", messageId: "<archive-7@example.test>" });

  let archive: Record<string, number[]> = {};
  const sent: Record<string, number[]> = { invoice: [3], march: [3, 4] };
  const locks: [string, unknown][] = [];
  const searches: [string, object][] = [];
  const fetches: [string, string, object][] = [];
  const changes: string[] = [];
  let closed = 0;
  let onSearch = () => {};
  t.mock.method(ImapFlow.prototype, "connect", async function (this: ImapFlow) { this.usable = true; });
  t.mock.method(ImapFlow.prototype, "logout", async () => {});
  t.mock.method(ImapFlow.prototype, "close", () => { closed++; });
  t.mock.method(ImapFlow.prototype, "list", async () => [
    { path: "INBOX", flags: new Set() }, { path: "Old mail", flags: new Set(["\\Archive"]) }, { path: "Sent", flags: new Set(["\\Sent"]) },
  ]);
  t.mock.method(ImapFlow.prototype, "getMailboxLock", async function (this: ImapFlow, mailbox: string, options: unknown) {
    locks.push([mailbox, options]);
    this.mailbox = { path: mailbox, delimiter: "/", flags: new Set(), uidValidity: 9n, uidNext: 500, exists: 200 };
    return { release() {} };
  });
  t.mock.method(ImapFlow.prototype, "search", async function (this: ImapFlow, query: { text?: string }) {
    searches.push([this.mailbox ? this.mailbox.path : "", query]);
    onSearch();
    return (this.mailbox && this.mailbox.path === "Sent" ? sent : archive)[query.text!] || [];
  });
  t.mock.method(ImapFlow.prototype, "fetch", async function* (this: ImapFlow, range: string, query: { envelope?: boolean }) {
    const box = this.mailbox ? this.mailbox.path : "";
    fetches.push([box, range, query]);
    for (const uid of range.split(",").map(Number)) {
      const messageId = `<${box === "Sent" ? "sent" : "archive"}-${uid}@example.test>`;
      if (query.envelope) yield { seq: uid, uid, envelope: { messageId } };
      else yield { seq: uid, uid, flags: new Set(uid === 6 ? [] : ["\\Seen"]), source: Buffer.from(`From: Sender <sender@example.test>\r\nTo: me@example.test\r\nSubject: Invoice march ${uid}\r\nMessage-ID: ${messageId}\r\n\r\nSynthetic body`) };
    }
  });
  for (const method of ["messageFlagsAdd", "messageFlagsRemove", "messageFlagsSet", "messageMove", "messageDelete"] as const)
    t.mock.method(ImapFlow.prototype, method, async () => { changes.push(method); return true; });

  await t.test("complete results import new matches with their mailbox identity", async () => {
    archive = { invoice: [5, 6, 7], march: [6, 7, 8] };
    const result = await searchProviderMail({ accountId: "i", query: "invoice march -is:pinned", signal: new AbortController().signal });
    assert.deepEqual(result, { accountId: "i", source: "imap", limit: 100, examined: 3, imported: 2, complete: true, mailboxes: ["archive", "sent"], narrowed: ["is:pinned"] });
    assert.deepEqual(locks, [["Old mail", { readOnly: true }], ["Sent", { readOnly: true }]]);
    assert.deepEqual(searches.map(([box, query]) => [box, query]), [["Old mail", { text: "invoice" }], ["Old mail", { text: "march" }], ["Sent", { text: "invoice" }], ["Sent", { text: "march" }]]);
    assert.deepEqual(fetches.map(([box, range, query]) => [box, range, "envelope" in query ? "envelope" : "source"]), [
      ["Old mail", "7,6", "envelope"], ["Old mail", "6", "source"], ["Sent", "3", "envelope"], ["Sent", "3", "source"],
    ]);
    assert.deepEqual(changes, [], "searching never changes provider flags or folders");
    const box = Buffer.from("Old mail").toString("base64url");
    const archived = get("mail", `i:mailbox:${box}:9:6`)!;
    assert.deepEqual([archived.archived, archived.unread, archived.direction, archived.mailbox], [true, true, undefined, { path: "Old mail", uidValidity: "9", uid: 6 }]);
    const outgoing = get("mail", `i:sent:${Buffer.from("Sent").toString("base64url")}:9:3`)!;
    assert.deepEqual([outgoing.archived, outgoing.direction], [true, "sent"]);
  });

  await t.test("the cap keeps the newest UIDs and leaves later folders unsearched", async () => {
    archive = { invoice: Array.from({ length: 150 }, (_, i) => i + 1) };
    searches.length = fetches.length = 0;
    const result = await searchProviderMail({ accountId: "i", query: "invoice", signal: new AbortController().signal });
    assert.deepEqual([result.examined, result.complete], [100, false]);
    assert.deepEqual(searches.map(([box]) => box), ["Old mail"]);
    const ranges = fetches.filter(([, , query]) => "envelope" in query).map(([, range]) => range.split(",").map(Number));
    assert.deepEqual(ranges.flat().sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i + 51));
  });

  await t.test("cancelling closes the connection before any download", async () => {
    archive = { invoice: [300] };
    searches.length = fetches.length = 0;
    const controller = new AbortController();
    const before = closed;
    onSearch = () => controller.abort();
    await assert.rejects(searchProviderMail({ accountId: "i", query: "invoice", signal: controller.signal }), { name: "AbortError" });
    onSearch = () => {};
    assert.ok(closed > before);
    assert.deepEqual([searches.length, fetches.length], [1, 0]);
    assert.equal(get("mail", `i:mailbox:${Buffer.from("Old mail").toString("base64url")}:9:300`), undefined);
  });
});
