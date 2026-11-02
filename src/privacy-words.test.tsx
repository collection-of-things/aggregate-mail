import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedMail } from "./mail/FormattedMail";
import {
  applyPrivacyWords, businessSender, learnedOwnerNames, messagePrivateNames, redactPrivateText,
} from "./privacy";

const owner = [{ email: "owner@example.test", name: "Main" }];

test("business senders whose name matches their domain or a role mailbox stay visible", () => {
  assert.equal(businessSender("Kickstarter", "no-reply@kickstarter.example"), true);
  assert.equal(businessSender("Running Warehouse | Info", "info@runningwarehouse.example"), true);
  assert.equal(businessSender("The Varo Bank Team", "alerts@varomoney.example"), true);
  assert.equal(businessSender("Acme Billing", "billing@payments.example"), true);
  assert.equal(businessSender("Nora Lane", "nora@gmail.com"), false);
  assert.equal(businessSender("Support", "support@gmail.com"), false);
  assert.equal(businessSender("Nora Lane", "nora.lane@acme.example"), false);
  assert.equal(businessSender("Nora Lane", ""), false);
  const names = messagePrivateNames(owner, {
    sender: "Kickstarter", address: "no-reply@kickstarter.example",
    to: "owner@example.test", cc: "Kai Rivers <kai@example.org>, Acme Support <support@acme.example>",
  });
  assert.ok(!names.includes("Kickstarter"));
  assert.ok(!names.includes("Acme Support"));
  assert.ok(names.includes("Kai Rivers"));
  assert.ok(messagePrivateNames(owner, { sender: "Nora Lane", address: "nora@gmail.com" }).includes("Nora Lane"));
});

test("brand sender images and links load in privacy mode", () => {
  const names = messagePrivateNames(owner, { sender: "Sample Brand", address: "no-reply@mail.samplebrand.example", to: "owner@example.test" });
  const html = '<p>Hello</p><img src="https://cdn.samplebrand.example/hero.png" width="600" height="300"><a href="https://samplebrand.example/start">Start</a>';
  const markup = renderToStaticMarkup(<FormattedMail html={html} privacy showImages privateNames={names}
    renderText={(text) => redactPrivateText(text, names)} redactText={(text) => redactPrivateText(text, names)} />);
  assert.match(markup, /<img [^>]*src="https:\/\/cdn\.samplebrand\.example\/hero\.png"/);
  assert.match(markup, /href="https:\/\/samplebrand\.example\/start"/);
  assert.doesNotMatch(markup, /personal information is hidden/);
});

test("mail sent from an owner address splits the owner's name like an account name", () => {
  const names = messagePrivateNames(owner, { sender: "Sam Example-Person", address: "OWNER@example.test", to: "Shop <info@shop.example>" });
  assert.ok(names.includes("Sam"));
  assert.ok(names.includes("Example-Person"));
  assert.equal(redactPrivateText("Thank you,\nSam Example-Person", names), "Thank you,\n••••••••");
});

test("owner names are learned across cached mail, most frequent first and bounded", () => {
  const mails = [
    { to: "Sam Example <owner@example.test>" },
    { to: "Sam Example <owner@example.test>", sender: "Shop", address: "info@shop.example" },
    { sender: "SE Example", address: "owner@example.test", to: "x@shop.example" },
    { to: "Other Person <other@example.org>" },
    { to: "owner@example.test", cc: "Valued Customer <owner@example.test>" },
  ];
  assert.deepEqual(learnedOwnerNames(owner, mails), ["Sam Example", "SE Example", "Valued Customer", "Sam", "Example", "SE", "Valued", "Customer"]);
  assert.deepEqual(learnedOwnerNames(owner, mails, 1), ["Sam Example", "Sam", "Example"]);
  assert.deepEqual(learnedOwnerNames([], mails), []);
  assert.equal(redactPrivateText("Hi Sam,", learnedOwnerNames(owner, mails)), "Hi ••••••••,");
});

test("owner lists add hidden names and remove visible ones, ignoring case", () => {
  assert.deepEqual(applyPrivacyWords(["Kickstarter", "Sam"], { hidden: ["  Nickname  One "], visible: ["KICKSTARTER"] }), ["Sam", "Nickname One"]);
  assert.deepEqual(applyPrivacyWords(["Sam"]), ["Sam"]);
});

test("US-style postal lines are hidden while ordinary numbers and prose stay visible", () => {
  const text = "Billing\nSam Example\n422 Southeast 17th Place\nOcala, FL 32712\n191 SMUGGLERS WAY\nAPOPKA, FL 32712-3417";
  assert.equal(redactPrivateText(text), "Billing\nSam Example\n••••••••\n••••••••\n••••••••\n••••••••");
  assert.equal(redactPrivateText("Visit 1600 Pennsylvania Avenue NW, Washington, DC 20500 today"),
    "Visit •••••••• NW, •••••••• today");
  for (const visible of [
    "Join 10 million people on the way",
    "Order # 9569717 Date: 10/12/26",
    "Garmin fenix 8 Saph AM 51 Carbon Gray DLC",
    "Call 1.800.606.9598",
    "Step 2 Place the order",
    "Thank you, Sam",
    "Total 1099.99 Sales Tax: 73.01",
  ]) assert.equal(redactPrivateText(visible), visible);
});
