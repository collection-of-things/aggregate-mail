import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ListEmpty } from "./mail/ListEmpty";
import type { Mail, MailSummary } from "../shared/types";
import { compileMailSearch } from "./mail-search";
const mail: MailSummary = { id: "a:1", accountId: "a", remoteId: "1", sender: "Synthetic team", address: "team@example.test", to: "reader@example.test", subject: "Design review", preview: "Ready", date: 1, unread: false, archived: false, snoozedUntil: null, category: "important", relevance: 2, reason: "", contentVersion: "v1", inboxTab: "primary" };

test("search resolves header facts without guessing about unknown message bodies", () => {
  for (const [query, expected] of [["subject:design", true], ["from:other", false], ["is:unread", false], ["desgin", true], ["-design", false], ["missing", undefined], ["-missing", undefined], ["body:ready", undefined], ["from:other body:ready", false], ['"Design review"', true], ["subject:", false]] as const) {
    assert.equal(compileMailSearch(query).matchesSummary(mail), expected, query);
  }
});

test("known summary outcomes agree with every possible full body", () => {
  for (const query of ["desgin", "-design", "from:team body:ready", "subject:design -missing", "after:1970-01-01", "body:unknown", "is:pinned"]) {
    const search = compileMailSearch(query);
    const known = search.matchesSummary(mail);
    for (const body of ["", "ready unknown missing design", "unrelated text"]) if (known !== undefined)
      assert.equal(search.matches({ ...mail, body } as Mail), known, query);
  }
});


test("pending search communicates progress instead of claiming no matches", () => {
  const html = renderToStaticMarkup(<ListEmpty loaded hasAccounts filtered searchPending title="Inbox" viewName="Inbox" syncing={false} onConnect={() => {}} onReset={() => {}} onSync={() => {}} />);
  assert.match(html, /role="status"/);
  assert.match(html, /Searching cached mail/);
  assert.doesNotMatch(html, /No matching mail|No cached mail matches/);
});
