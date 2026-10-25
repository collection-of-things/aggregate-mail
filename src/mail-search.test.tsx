import assert from "node:assert/strict";
import { test } from "node:test";
import type { Account, Mail } from "../shared/types";
import { compileMailSearch } from "./mail-search";

const accounts: Account[] = [
  { id: "work-id", email: "work@example.com", name: "Work inbox", provider: "imap" },
  { id: "home-id", email: "home@example.com", provider: "imap" },
];
const mail: Mail = {
  id: "work-id:1", accountId: "work-id", remoteId: "1", sender: "Ada Lovelace",
  address: "ada@example.com", to: "me@example.com", cc: "team@example.com",
  subject: "Quarterly planning", preview: "Review the launch plan", body: "The project is ready.",
  date: Date.UTC(2025, 2, 1), unread: true, pinned: true, category: "important", relevance: 2,
  reason: "Team", archived: true, snoozedUntil: null,
};

test("plain text, quoted phrases, field terms and exclusions combine with AND", () => {
  assert.equal(compileMailSearch('quarterly "launch plan" -draft', accounts).matches(mail), true);
  assert.equal(compileMailSearch('subject:"quarterly planning" from:ADA', accounts).matches(mail), true);
  assert.equal(compileMailSearch("to:team@example.com body:project", accounts).matches(mail), true);
  assert.equal(compileMailSearch("subject:launch to:other@example.com", accounts).matches(mail), false);
  assert.equal(compileMailSearch("notfound", accounts).matches(mail), false);
});

test("account aliases, state filters, and unknown prefixes", () => {
  assert.equal(compileMailSearch("account:work-id", accounts).matches(mail), true);
  assert.equal(compileMailSearch("account:WORK@EXAMPLE.COM", accounts).matches(mail), true);
  assert.equal(compileMailSearch('account:"Work inbox"', accounts).matches(mail), true);
  assert.equal(compileMailSearch("account:home-id", accounts).matches(mail), false);
  assert.equal(compileMailSearch("is:unread is:pinned", accounts).matches(mail), true);
  assert.equal(compileMailSearch("is:read", accounts).matches(mail), false);
  assert.equal(compileMailSearch("label:Quarterly", accounts).matches(mail), false);
});

test("date bounds use UTC day starts with before exclusive and after inclusive", () => {
  const before = Date.UTC(2025, 2, 1) - 1;
  const start = Date.UTC(2025, 2, 1);
  const end = Date.UTC(2025, 2, 2);
  const at = (date: number) => ({ ...mail, date });
  assert.equal(compileMailSearch("before:2025-03-01").matches(at(before)), true);
  assert.equal(compileMailSearch("before:2025-03-01").matches(at(start)), false);
  assert.equal(compileMailSearch("after:2025-03-01").matches(at(start)), true);
  assert.equal(compileMailSearch("after:2025-03-01").matches(at(end)), true);
});

test("malformed recognized operators fail closed without echoing query text", () => {
  for (const query of ['"open', "from:", "is:maybe", "before:2025-02-29", "after:tomorrow", "-", '"   "', 'body:"   "']) {
    const result = compileMailSearch(query, accounts);
    assert.equal(result.matches(mail), false);
    assert.ok(result.error);
    assert.equal(result.error.includes(query), false);
  }
});

test("canonical and Latin accent variants match names and content without changing original text", () => {
  const message = { ...mail, sender: "Jose\u0301 García", subject: "Café résumé", body: "Réunion\u00a0du\n  projet" };
  const snapshot = structuredClone(message);
  for (const query of ["from:jose", 'from:"José García"', "subject:cafe", "resume", 'body:"reunion du projet"']) {
    assert.equal(compileMailSearch(query).matches(message), true, query);
  }
  assert.deepEqual(message, snapshot);
});

test("recipient names and CC content are searchable with normalized phrases", () => {
  const message = { ...mail, to: "Zoë\u00a0Dupont <zoe@example.com>", cc: "André\n Martin <andre@example.com>" };
  for (const query of ['to:"zoe dupont"', 'to:"andre martin"', '"andre martin"', "to:andre@example.com"]) {
    assert.equal(compileMailSearch(query).matches(message), true, query);
  }
});

test("phrases stay within individual fields while separate terms combine across fields", () => {
  const message = { ...mail, sender: "Boundary", address: "edge@example.com", to: "first@example.com", cc: "second@example.com", subject: "Title tail", preview: "Preview head", body: "Body" };
  for (const query of ['"tail preview"', 'from:"boundary edge@example.com"', 'to:"first@example.com second@example.com"', '"head body"']) {
    assert.equal(compileMailSearch(query).matches(message), false, query);
  }
  assert.equal(compileMailSearch("tail preview body").matches(message), true);
});

test("email identifiers and non-Latin combining marks stay distinct", () => {
  const message = { ...mail, sender: "Sender", address: "josé@example.com", subject: "ก่า", body: "", preview: "" };
  assert.equal(compileMailSearch("from:jose@example.com").matches(message), false);
  assert.equal(compileMailSearch("jose@example.com").matches(message), false);
  assert.equal(compileMailSearch("from:josé@example.com").matches(message), true);
  assert.equal(compileMailSearch("subject:กา").matches(message), false);
  assert.equal(compileMailSearch("subject:ก่า").matches(message), true);
  const accentedAccounts: Account[] = [{ ...accounts[0], id: "café", email: "josé@example.com", name: "Équipe\u00a0 Travail" }];
  const scoped = { ...message, accountId: "café" };
  assert.equal(compileMailSearch("account:cafe", accentedAccounts).matches(scoped), false);
  assert.equal(compileMailSearch("account:jose@example.com", accentedAccounts).matches(scoped), false);
  assert.equal(compileMailSearch('account:"equipe travail"', accentedAccounts).matches(scoped), true);
  assert.equal(compileMailSearch('account:"equipe travail"', accentedAccounts).matches({ ...scoped, accountId: "other" }), false);
  assert.equal(compileMailSearch("account:josé@example.com", [{ ...accentedAccounts[0], email: "other@example.com", name: "josé@example.com" }]).matches(scoped), true);
});

test("cached documents reflect in-place edits, same-ID replacements and live flags", () => {
  const message = { ...mail, body: "Original body" };
  const original = compileMailSearch("body:original");
  assert.equal(original.matches(message), true);
  message.body = "Replacement content";
  assert.equal(original.matches(message), false);
  assert.equal(compileMailSearch("body:replacement").matches(message), true);
  const replacement = { ...message, body: "New snapshot" };
  assert.equal(compileMailSearch("body:replacement").matches(replacement), false);
  assert.equal(compileMailSearch('body:"new snapshot"').matches(replacement), true);
  const unread = compileMailSearch("is:unread body:replacement");
  assert.equal(unread.matches(message), true);
  message.unread = false;
  assert.equal(unread.matches(message), false);
  message.cc = "New person <new@example.com>";
  assert.equal(compileMailSearch("to:new@example.com").matches(message), true);
  message.cc = undefined;
  assert.equal(compileMailSearch("to:new@example.com").matches(message), false);
});

test("normalized documents are reused across queries and rebuilt after searchable edits", () => {
  const message = { ...mail, body: "Résumé content" };
  const first = compileMailSearch("body:resume");
  const second = compileMailSearch("subject:quarterly");
  const normalize = String.prototype.normalize;
  let calls = 0;
  String.prototype.normalize = function(form) { calls++; return normalize.call(this, form); };
  try {
    assert.equal(first.matches(message), true);
    assert.ok(calls > 0);
    calls = 0;
    assert.equal(second.matches(message), true);
    assert.equal(first.matches(message), true);
    assert.equal(calls, 0, "unchanged mail is not normalized again for another query");
    message.body = "Updated café content";
    assert.equal(first.matches(message), false);
    assert.ok(calls > 0, "a searchable edit rebuilds the normalized document");
    calls = 0;
    assert.equal(second.matches({ ...mail }), true);
    assert.equal(calls, 0, "ASCII documents skip Unicode normalization");
  } finally {
    String.prototype.normalize = normalize;
  }
});


test("every searchable field invalidates its document and same IDs cannot mix accounts", () => {
  for (const field of ["sender", "address", "to", "cc", "subject", "preview", "body"] as const) {
    const message = { ...mail, [field]: "Initialneedle" };
    const initial = compileMailSearch("initialneedle");
    const updated = compileMailSearch("updatedneedle");
    assert.equal(initial.matches(message), true, field);
    message[field] = "Updatedneedle";
    assert.equal(initial.matches(message), false, field);
    assert.equal(updated.matches(message), true, field);
    const otherAccount = { ...message, accountId: "home-id", [field]: "Other content" };
    assert.equal(updated.matches(otherAccount), false, field);
    assert.equal(updated.matches(message), true, field);
  }
});

// These are fixed cache contracts, exercised through normalization work rather than a test-only API.
const documentLimit = 256;
const stringByteLimit = 4 * 1024 * 1024;

function normalizationWork(work: () => void): number {
  const normalize = String.prototype.normalize;
  let calls = 0;
  String.prototype.normalize = function(form) { calls++; return normalize.call(this, form); };
  try { work(); return calls; }
  finally { String.prototype.normalize = normalize; }
}

function cacheMail(id: string, body = "Résumé cache content"): Mail {
  return { ...mail, id, accountId: "cache-budget", sender: "", address: "", to: "", cc: "", subject: "", preview: "", body };
}

function fillDocumentCache(prefix: string): void {
  const search = compileMailSearch("body:resume");
  for (let i = 0; i < documentLimit; i++) assert.equal(search.matches(cacheMail(`${prefix}-${i}`)), true);
}

test("search document entry budget evicts the least recently used identity without changing matches", () => {
  fillDocumentCache("entry");
  const search = compileMailSearch("body:resume -body:draft");
  const oldest = cacheMail("entry-0");
  const next = cacheMail("entry-1");
  assert.equal(normalizationWork(() => assert.equal(search.matches(oldest), true)), 0, "a new Mail object reuses its identity's document");
  assert.equal(search.matches(cacheMail("entry-overflow")), true);
  assert.equal(normalizationWork(() => assert.equal(search.matches(oldest), true)), 0, "a hit refreshes recency");
  assert.ok(normalizationWork(() => assert.equal(search.matches(next), true)) > 0, "the 257th entry evicts the least recently used document");
});

test("search document byte budget counts raw canonical folded and identity strings at the boundary", () => {
  // Every field except body is empty. Each é occupies one UTF-16 code unit in all three forms.
  let id = "byte-boundary";
  while ((stringByteLimit / 2 - JSON.stringify(["cache-budget", id]).length) % 3) id += "x";
  const bodyLength = (stringByteLimit / 2 - JSON.stringify(["cache-budget", id]).length) / 3;
  const exact = cacheMail(id, "é".repeat(bodyLength));
  const search = compileMailSearch("body:e -body:draft");
  assert.equal(search.matches(exact), true);
  assert.equal(normalizationWork(() => assert.equal(search.matches({ ...exact }), true)), 0, "a document exactly at the string-byte budget is reusable");
  const small = cacheMail("byte-small");
  assert.equal(search.matches(small), true);
  assert.equal(normalizationWork(() => assert.equal(search.matches(small), true)), 0);
  assert.ok(normalizationWork(() => assert.equal(search.matches(exact), true)) > 0, "string-byte pressure evicts before the entry limit");
  const oversized = { ...exact, body: exact.body + "é" };
  assert.ok(normalizationWork(() => assert.equal(search.matches(oversized), true)) > 0);
  assert.equal(search.matches(small), true);
  assert.ok(normalizationWork(() => assert.equal(search.matches(oversized), true)) > 0, "one extra character is not retained");
  assert.equal(normalizationWork(() => assert.equal(search.matches(small), true)), 0, "oversized documents do not evict useful entries");
});

test("search document replacement releases its previous byte allowance", () => {
  const search = compileMailSearch("body:e");
  const large = cacheMail("byte-replacement", "é".repeat(400_000));
  assert.equal(search.matches(large), true);
  const small = { ...large, body: "Café" };
  assert.equal(search.matches(small), true);
  const peer = cacheMail("byte-peer", "é".repeat(400_000));
  assert.equal(search.matches(peer), true);
  assert.equal(normalizationWork(() => assert.equal(search.matches(small), true)), 0, "replacement subtracts its old retained strings");
  assert.equal(normalizationWork(() => assert.equal(search.matches(peer), true)), 0);
});

test("search cache identities isolate accounts and read flags dates and unused content live", () => {
  const first = cacheMail("same-id");
  const other = { ...first, accountId: "other-cache-account" };
  const search = compileMailSearch("body:resume");
  assert.equal(search.matches(first), true);
  assert.ok(normalizationWork(() => assert.equal(search.matches(other), true)) > 0, "accounts have separate documents even with identical IDs and text");
  assert.equal(normalizationWork(() => assert.equal(search.matches(first), true)), 0);
  assert.equal(normalizationWork(() => assert.equal(search.matches(other), true)), 0);
  Object.defineProperties(first, {
    html: { get() { throw Error("HTML is not search content"); } },
    attachments: { get() { throw Error("Attachments are not search content"); } },
  });
  const flags = compileMailSearch("body:resume is:unread is:pinned after:2025-03-01 before:2025-03-02");
  assert.equal(normalizationWork(() => assert.equal(flags.matches(first), true)), 0);
  first.pinned = false;
  assert.equal(flags.matches(first), false);
  first.pinned = true;
  first.date = Date.UTC(2025, 2, 2);
  assert.equal(flags.matches(first), false);
  first.date = mail.date;
  first.unread = false;
  assert.equal(flags.matches(first), false);
  first.accountId = other.accountId;
  assert.equal(normalizationWork(() => assert.equal(search.matches(first), true)), 0);
  const flagsOnly = compileMailSearch("is:read before:2025-03-02");
  const noBody = { ...mail, get body(): string { throw Error("non-text searches do not inspect bodies"); } };
  assert.equal(compileMailSearch("").matches(noBody), true);
  assert.equal(flagsOnly.matches(noBody), false);
});

test("cached evicted and oversized documents preserve Unicode phrase and exclusion semantics", () => {
  const message = { ...cacheMail("semantic"), sender: "Jose\u0301", address: "josé@example.com", subject: "Title tail",
    preview: "Preview head", body: "Réunion\u00a0du\n projet ก่า" };
  const cases: [string, boolean][] = [
    ['from:jose body:"reunion du projet" -body:draft', true],
    ['body:"reunion du projet" -body:reunion', false],
    ['"tail preview"', false], ["tail preview body:ก่า", true],
    ["body:กา", false], ["from:jose@example.com", false], ["from:josé@example.com", true],
  ];
  const searches = cases.map(([query, expected]) => ({ search: compileMailSearch(query), expected, query }));
  const check = (candidate: Mail) => {
    for (const { search, expected, query } of searches) assert.equal(search.matches(candidate), expected, query);
  };
  check(message);
  assert.equal(normalizationWork(() => check({ ...message })), 0);
  fillDocumentCache("semantic-eviction");
  assert.ok(normalizationWork(() => check(message)) > 0);
  check({ ...message, body: message.body + " " + "x".repeat(750_000) });
});
