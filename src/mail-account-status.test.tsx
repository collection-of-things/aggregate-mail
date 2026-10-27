import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import type { Account, Mail } from "../shared/types";
import { MailList } from "./mail/MailList";
import { PrivacyContext } from "./ui/Privacy";

const accounts: Account[] = [
  { id: "a", email: "first@example.test", provider: "gmail", name: "Personal" },
  { id: "b", email: "second@example.test", provider: "gmail", name: "Studio" },
];
const message: Mail = {
  id: "a:1", accountId: "a", remoteId: "1", sender: "Synthetic Team",
  address: "sender@example.test", to: "first@example.test", subject: "Review proposal",
  body: "Synthetic body", preview: "Please review", date: 1, unread: true,
  archived: false, snoozedUntil: null, category: "important", relevance: 3,
  reason: "May need a reply",
};

function render(options: { narrow?: boolean; density?: "comfortable" | "compact";
  privacy?: boolean; accounts?: Account[]; messages?: Mail[]; showAccount?: boolean;
  sizeByImportance?: boolean } = {}) {
  const listAccounts = options.accounts ?? accounts;
  const html = renderToStaticMarkup(
    <PrivacyContext.Provider value={{ on: !!options.privacy, revealed: new Set(), toggle() {}, accounts: listAccounts }}>
      <MailList messages={options.messages ?? [message, { ...message, id: "b:1", accountId: "b" }]}
        accounts={listAccounts} narrow={!!options.narrow} density={options.density ?? "comfortable"}
        showAccount={options.showAccount} sizeByImportance={options.sizeByImportance}
        selectedId={undefined} listRef={{ current: null }} focusSelection={false}
        sort="newest" opening="double" onOpen={() => {}} onSelect={() => {}}
        onMenu={() => {}} onMenuKey={() => {}} />
    </PrivacyContext.Provider>,
  );
  return new JSDOM(html).window.document;
}

test("same-provider receiving accounts remain distinct in every density and pane layout", () => {
  for (const narrow of [false, true]) for (const density of ["comfortable", "compact"] as const) {
    const document = render({ narrow, density });
    const rows = [...document.querySelectorAll<HTMLButtonElement>("button.row")];
    assert.deepEqual(rows.map(row => row.querySelector(".row-account")?.textContent), ["Personal", "Studio"]);
    for (const [index, row] of rows.entries()) {
      assert.match(row.getAttribute("aria-label")!, new RegExp(`Account: ${accounts[index].name}`));
      assert.equal(row.querySelector(".avatar .provider-icon"), null, "sender icons have no provider overlay");
      assert.equal(row.querySelector(".row-label")?.textContent, "May need");
      assert.match(row.getAttribute("aria-label")!, /Status: May need a reply/);
    }
  }
});

test("single-account filtering hides account metadata but retains the sorting status", () => {
  for (const narrow of [false, true]) {
    const row = render({ narrow, showAccount: false }).querySelector("button.row")!;
    assert.equal(row.querySelector(".row-account"), null);
    assert.equal(row.querySelector(".row-label")?.textContent, "May need");
  }
});

test("privacy-safe duplicate labels, address-only names and unavailable accounts stay distinguishable", () => {
  const duplicate = accounts.map(account => ({ ...account, name: "Studio" }));
  assert.deepEqual([...render({ accounts: duplicate, privacy: true }).querySelectorAll(".row-account")]
    .map(label => label.textContent), ["Studio · 1", "Studio · 2"]);
  const privateAccounts = accounts.map(account => ({ ...account, name: account.email }));
  const document = render({ accounts: privateAccounts, privacy: true,
    messages: [{ ...message, reason: "May need first@example.test" }] });
  const row = document.querySelector("button.row")!;
  assert.match(row.querySelector(".row-account")!.textContent!, /Account 1/);
  assert.doesNotMatch(row.outerHTML, /first@example\.test|second@example\.test/);
  const missing = render({ messages: [{ ...message, accountId: "removed" }] }).querySelector("button.row")!;
  assert.equal(missing.querySelector(".row-account")?.textContent, "Account unavailable");
});

test("row sizing preferences do not change status meaning or invent missing labels", () => {
  const row = render({ sizeByImportance: false }).querySelector("button.row")!;
  assert.equal(row.querySelector(".row-label")?.textContent, "May need");
  for (const relevance of [1, 2] as const) {
    assert.equal(render({ messages: [{ ...message, relevance }] }).querySelector(".row-label"), null);
  }
  assert.equal(render({ messages: [{ ...message, reason: "" }] }).querySelector(".row-label"), null);
  const neutral = render({ messages: [{ ...message, reason: "Account security" }] }).querySelector(".row-label")!;
  assert.equal(neutral.classList.contains("row-label-attention"), false);
});
