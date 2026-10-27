import assert from "node:assert/strict";
import { test } from "node:test";
import { mailSearchScope, widenMailSearch } from "./mail-search-scope";
import type { MailLocation } from "./navigation";
const location: MailLocation = { page: "mail", view: "archive", tab: "primary", settingsSection: "accounts", accountFilter: "a", labelFilter: "a:l", readFilter: "unread", relevanceFilter: "3", sort: "oldest", query: "needle", selectedId: null, opened: false };
test("scope names exact filters, sort and private account without implying provider completeness", () => {
 const scope = mailSearchScope(location, [{id: "a", email: "one@example.test", provider: "imap"}], {id: "l", accountId: "a", name: "Work", type: "user"}, true, false);
 for (const text of ["Cached Archive", "Account 1", "Unread", "High relevance", "Label: Work", "Oldest first", "Mail only"]) assert.ok(scope.includes(text), text);
 assert.ok(!scope.includes("one@example.test"));
 for (const sort of ["newest", "oldest", "relevance"] as const) for (const relevanceFilter of ["all", "1", "2", "3"] as const)
  assert.ok(!mailSearchScope({...location, sort, relevanceFilter}, [], undefined, false, false).includes("undefined"));
});
test("widen retains query, account and sort and leaves original scope available to history", () => {
 const wide = {...location, ...widenMailSearch()};
 assert.equal(wide.query, "needle"); assert.equal(wide.accountFilter, "a"); assert.equal(wide.sort, "oldest");
 assert.equal(wide.view, "all"); assert.equal(wide.readFilter, "all"); assert.equal(wide.labelFilter, "all"); assert.equal(wide.relevanceFilter, "all");
 assert.equal(location.view, "archive");
});
