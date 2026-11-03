import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedMail } from "./mail/FormattedMail";
import {
  applyPrivacyWords, businessSender, collectPrivateNames, learnedOwnerNames, messagePrivateNames, redactPrivateText, scopedMessageNames, workOwnerNames,
} from "./privacy";

const owner = [{ email: "owner@example.test", name: "Main" }];

test("business senders whose name matches their domain or a role mailbox stay visible", () => {
  assert.equal(businessSender("Kickstarter", "no-reply@kickstarter.example"), true);
  assert.equal(businessSender("Running Warehouse | Info", "info@runningwarehouse.example"), true);
  assert.equal(businessSender("The Varo Bank Team", "alerts@varomoney.example"), true);
  assert.equal(businessSender("Acme Billing", "billing@acme.example"), true);
  assert.equal(businessSender("Billing Team", "billing@payments.example"), true);
  assert.equal(businessSender("Bank of America", "alerts@bankofamerica.example"), true);
  // Services relay people's names from their role mailboxes; those stay hidden.
  for (const [name, email] of [
    ["Jane Smith", "notifications@github.example"], ["Jane Smith (via Dropbox)", "no-reply@dropbox.example"],
    ["Jane Smith", "notification@facebookmail.example"], ["jsmith", "notifications@github.example"],
    ["Jane from Acme Support", "support@acme.example"], ["Acme Billing", "billing@payments.example"],
  ]) assert.equal(businessSender(name, email), false, `${name} <${email}>`);
  assert.equal(businessSender("Nora Lane", "nora@gmail.com"), false);
  assert.equal(businessSender("Support", "support@gmail.com"), false);
  assert.equal(businessSender("Nora Lane", "nora.lane@acme.example"), false);
  assert.equal(businessSender("Nora Lane", ""), false);
  assert.equal(businessSender("Sample Brand", "updates@mail.samplebrand.example"), true);
  assert.equal(businessSender("Interactive Brokers", "x@interactivebrokers.example"), true);
  // People whose name words appear in a domain or mailbox stay hidden.
  for (const [name, email] of [
    ["John Smith", "jsmith@johnshopkins.example"], ["Sean Ford", "sean.ford@ford.example"],
    ["Mark Taylor", "mark@marketingpros.example"], ["Jane Hall", "jhall@marshall.example"],
    ["Chase Miller", "chase.miller@chase.example"], ["Sarah Johnson", "sarah@johnsonlaw.example"],
    ["Will Brown", "wb@williamsgroup.example"], ["Nora Example", "p@example.org"],
    ["Vera Bloom", "team@vendor.example"], ["Vera Bloom", "hello@verabloom-studio.example"],
    ["Chase Miller", "cm@chase.example"], ["Grant Lee", "gl@grant.example"], ["Morgan Price", "mp12345@morgan.example"],
    ["Ed Ford", "ed.ford@ford.example"], ["Chase Li", "cli@chase.example"], ["Jo Chase", "jo@chase.example"],
    ["Al Grant", "al@grant.example"], ["Anna Coco", "a@anna.example"], ["Grant Store", "g@grant.example"],
  ]) assert.equal(businessSender(name, email), false, `${name} <${email}>`);
  for (const [name, email] of [
    ["Spotify", "spotify@news.spotify.example"], ["Acme Inc", "x@acme.example"], ["Kickstarter", "hello@kickstarter.example"],
    ["Amazon.example", "shipment-tracking@amazon.example"],
  ]) assert.equal(businessSender(name, email), true, `${name} <${email}>`);
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
    { sender: "SE Example", address: "owner@example.test", to: "x@shop.example", direction: "sent" },
    { to: "Other Person <other@example.org>" },
    { to: "owner@example.test", cc: "Valued Customer <owner@example.test>" },
  ];
  // Sent names lead; a received name needs two messages; Valued Customer appears once.
  assert.deepEqual(learnedOwnerNames(owner, mails), ["SE Example", "Sam Example", "SE", "Example", "Sam"]);
  assert.deepEqual(learnedOwnerNames(owner, mails, 1), ["SE Example", "SE", "Example"]);
  assert.deepEqual(learnedOwnerNames([], mails), []);
  assert.equal(redactPrivateText("Hi Sam,", learnedOwnerNames(owner, mails)), "Hi ••••••••,");
});

test("review cases: role prefixes, per-message counting, junk names and sent common words", () => {
  assert.equal(businessSender("Jane Doe", "info.jane@company.example"), false);
  assert.equal(businessSender("Acme", "no-reply+abc@acme-mail.example"), true);
  assert.equal(businessSender("Acme", "noreply-2@acme-mail.example"), true);
  // To and Cc on one message count once.
  assert.deepEqual(learnedOwnerNames(owner, [{ to: "Sam Example <owner@example.test>", cc: "Sam Example <owner@example.test>" }]), []);
  // Junk phrases cannot take the learned slots from a real name.
  const junk = ["Customer", "Member", "User", "Subscriber", "Valued Customer"].flatMap((name) =>
    [{ to: `${name} <owner@example.test>` }, { to: `${name} <owner@example.test>` }]);
  const learned = learnedOwnerNames(owner, [...junk, { to: "Sam Example <owner@example.test>" }, { to: "Sam Example <owner@example.test>" }]);
  assert.deepEqual(learned, ["Sam Example", "Sam", "Example"]);
  // The owner's own sent name keeps a part that is also a common word.
  assert.ok(learnedOwnerNames(owner, [{ sender: "Dear Smith", address: "owner@example.test", direction: "sent" }]).includes("Dear"));
  // A long sent name is still learned; only received phrases are limited to four words.
  assert.ok(learnedOwnerNames(owner, [{ sender: "Maria Jose Garcia Lopez Perez", address: "owner@example.test", direction: "sent" }]).includes("Maria Jose Garcia Lopez Perez"));
  // Work surfaces take one-message aliases but stay bounded.
  const many = Array.from({ length: 20 }, (_, index) => ({ to: `Alias${index} Person${index} Extra${index} <owner@example.test>` }));
  assert.ok(workOwnerNames(owner, many).length <= 6 * 4);
  assert.ok(workOwnerNames(owner, [{ to: "Nora Lane <owner@example.test>" }]).includes("Nora Lane"));
});

test("forged owner senders and plus-joined names cannot overflow the matcher", () => {
  const sixteen = (seed: number) => Array.from({ length: 16 }, (_, index) => `W${seed}x${index}`).join(" ");
  const forged = [1, 2, 3, 4].map((seed) => ({ sender: sixteen(seed), address: "owner@example.test", to: "owner@example.test" }));
  assert.deepEqual(learnedOwnerNames(owner, forged), []);
  const sent = [1, 2, 3, 4].map((seed) => ({ sender: sixteen(seed).split(" ").slice(0, 8).join(" "), address: "owner@example.test", direction: "sent" }));
  assert.ok(learnedOwnerNames(owner, sent).length <= 24);
  assert.ok(redactPrivateText("Plain text", learnedOwnerNames(owner, sent)) === "Plain text");
  const plus = Array.from({ length: 17 }, (_, index) => String.fromCharCode(65 + index)).join("+");
  const joined = [{ to: `"${plus}" <owner@example.test>` }, { to: `"${plus}" <owner@example.test>` }];
  assert.deepEqual(learnedOwnerNames(owner, joined), []);
  assert.deepEqual(workOwnerNames(owner, joined.slice(0, 1)), []);
  // An over-budget name is skipped, not the end of learning: a later short alias still fits.
  const alias = [{ to: "Sam Example <owner@example.test>" }, { to: "Sam Example <owner@example.test>" }];
  const lettered = ["K", "L", "M"].map((seed) => ({ sender: Array.from("abcdefgh", (letter) => `${seed}${letter}ane`).join(" "), address: "owner@example.test", direction: "sent" }));
  const learned = learnedOwnerNames(owner, [...lettered, ...alias]);
  assert.ok(learned.includes("Sam Example") && learned.length <= 24, learned.join("|"));
});

test("crafted recipient names cannot exceed matcher limits or hide single letters", () => {
  const long = Array.from({ length: 17 }, (_, index) => `Word${index}`).join(" ");
  const mails = [
    { to: `"${long}" <owner@example.test>` }, { to: `"${long}" <owner@example.test>` },
    { sender: "Jane Q Owner", address: "owner@example.test", direction: "sent" },
  ];
  const names = learnedOwnerNames(owner, mails);
  assert.deepEqual(names, ["Jane Q Owner", "Jane", "Owner"]);
  assert.equal(redactPrivateText("Q3 plan, option Q, from Jane", names), "Q3 plan, option Q, from ••••••••");
  const stop = learnedOwnerNames(owner, [{ to: '"The And Of To" <owner@example.test>' }, { to: '"The And Of To" <owner@example.test>' }]);
  assert.equal(redactPrivateText("The plan and the date", stop), "The plan and the date");
});

test("owner lists add hidden names and remove visible ones and their words, ignoring case", () => {
  assert.deepEqual(applyPrivacyWords(["Kickstarter", "Sam"], { hidden: ["  Nickname  One "], visible: ["KICKSTARTER"] }), ["Sam", "Nickname One"]);
  assert.deepEqual(applyPrivacyWords(["Sam"]), ["Sam"]);
  const kept = applyPrivacyWords(["Jane Q Owner", "Jane", "Owner", "Other"], { visible: ["jane q owner"] });
  assert.deepEqual(kept, ["Other"]);
  assert.equal(redactPrivateText("Signed, Jane Q Owner", kept), "Signed, Jane Q Owner");
  // A visible business never reveals an owner's name part or an explicit hidden word.
  const owner = applyPrivacyWords(["Morgan Lee", "Morgan", "Lee"], { visible: ["Morgan Stanley"] });
  assert.deepEqual(owner, ["Morgan Lee", "Morgan", "Lee"]);
  assert.equal(redactPrivateText("Hi Morgan, from Morgan Lee", owner), "Hi ••••••••, from ••••••••");
  assert.deepEqual(applyPrivacyWords(["Morgan Stanley", "Stanley"], { hidden: ["Morgan"], visible: ["Morgan Stanley"] }), ["Morgan"]);
  assert.deepEqual(applyPrivacyWords(["Morgan Lee", "Morgan", "Lee", "Morgan Stanley"], { visible: ["Morgan Stanley"] }), ["Morgan Lee", "Morgan", "Lee"]);
});

test("a kept-visible correspondent never reveals owner or Always hide words inside its message", () => {
  const mail = { sender: "Morgan Stanley", address: "client.service@ms-wealth.example", to: "owner@example.test" };
  const oneWordOwner = [{ email: "owner@example.test", name: "Morgan" }];
  const inherited = applyPrivacyWords(collectPrivateNames(oneWordOwner), { visible: ["Morgan Stanley"] });
  const names = scopedMessageNames(inherited, oneWordOwner, [mail], ["Morgan Stanley"]);
  // The owner's name wins over the kept-visible phrase that contains it.
  assert.equal(redactPrivateText("Hi Morgan, your Morgan Stanley statement is ready", names),
    "Hi ••••••••, your •••••••• Stanley statement is ready");
  const words = { hidden: ["Morgan"], visible: ["Morgan Stanley"] };
  const hiddenWord = scopedMessageNames(applyPrivacyWords([], words), owner, [mail], words.visible);
  assert.equal(redactPrivateText("Morgan's school called", hiddenWord), "••••••••'s school called");
  // Without a Never hide entry the correspondent is hidden as usual.
  assert.ok(scopedMessageNames([], owner, [mail]).includes("Morgan Stanley"));
});

test("Keep visible on the owner's own name applies inside message scopes", () => {
  const jane = [{ email: "owner@example.test", name: "Jane Owner" }];
  const mail = { sender: "Pat Friend", address: "pat@gmail.com", to: "Jane Owner <owner@example.test>" };
  for (const visible of [["Jane Owner"], ["Jane"]]) {
    const inherited = applyPrivacyWords(collectPrivateNames(jane), { visible });
    const names = scopedMessageNames(inherited, jane, [mail], visible);
    assert.equal(redactPrivateText("Hi Jane", names), "Hi Jane", visible[0]);
    assert.equal(redactPrivateText("from Pat Friend", names), "from ••••••••");
  }
  const sent = { sender: "Jane Owner", address: "owner@example.test", to: "x@shop.example" };
  assert.equal(redactPrivateText("Signed, Jane Owner", scopedMessageNames([], jane, [sent], ["Jane Owner"])), "Signed, Jane Owner");
  assert.equal(redactPrivateText("Signed, Jane Owner", scopedMessageNames([], jane, [sent])), "Signed, ••••••••");
});

test("postal matching stays linear on long punctuated runs", () => {
  for (const unit of ["A-", "A.", "A'", "1 A "]) {
    const text = unit.repeat(40_000);
    const started = performance.now();
    redactPrivateText(text);
    assert.ok(performance.now() - started < 500, `${JSON.stringify(unit)} took too long`);
  }
  assert.equal(redactPrivateText("St. Louis, MO 63101-1234 and Winston-Salem, NC 27101"), "•••••••• and ••••••••");
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

test("a full Always hide list and learned names leave the 64 account and message names room", () => {
  const learned = Array.from({ length: 24 }, (_, index) => `Learned${index}`);
  const ambient = applyPrivacyWords(learned, { hidden: Array.from({ length: 12 }, (_, index) => `Hidden${index}`), visible: [] });
  // Account name Main, sender Kai Rivers and 62 Cc names make 64.
  const cc = Array.from({ length: 62 }, (_, index) => `Guest${index} <guest${index}@example.org>`).join(", ");
  const names = scopedMessageNames(ambient, owner, [{ sender: "Kai Rivers", address: "kai@example.org", to: "owner@example.test", cc }]);
  assert.equal(redactPrivateText("Thanks Guest7 and Kai Rivers, see Learned3", names), "Thanks •••••••• and ••••••••, see ••••••••");
});
