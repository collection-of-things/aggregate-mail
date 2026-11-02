import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ContactList, ContactSuggestion, SavedContact } from "../shared/contacts.js";
import { quietImapWatch } from "./imap-watch-fixture.js";

const syntheticAccount = (id: string) => ({ id, email: `${id}@example.test`, provider: "imap" as const, credentials: {} });
const message = { subject: "Synthetic subject", body: "Synthetic body" };

test("local contacts: encrypted account-scoped storage, sent recipients and suggestions", { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-contacts-"));
  const key = Buffer.alloc(32, 57).toString("base64");
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-contacts-desktop";
  process.env.MAIL_DATA_KEY = key;
  process.env.TYPESAFE_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  const store = await import("./store.js");
  const backend = await import("./index.js");
  const { providers, SentCopyError } = await import("./providers.js");
  for (const id of ["work", "home"]) store.put("account", id, syntheticAccount(id));
  const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const desktop = { "X-Desktop-Token": "synthetic-contacts-desktop", "Content-Type": "application/json" };
  const { csrf } = await (await fetch(`${origin}/api/state`, { headers: desktop })).json() as { csrf: string };
  const headers = { ...desktop, "X-CSRF-Token": csrf };
  const request = (route: string, method = "GET", body?: unknown) => fetch(`${origin}/api${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const list = async () => await (await request("/contacts")).json() as ContactList;
  const suggest = async (query: string, accountId: string) =>
    await (await request(`/contacts/suggestions?${new URLSearchParams({ query, accountId })}`)).json() as ContactSuggestion[];
  const { sendMail } = await import("./mail-actions.js");
  // Contact recording follows provider acceptance, independently of UI queueing.
  const send = async (to: string, cc?: string[], accountId = "work") => {
    try { await sendMail({ accountId, to: [to], ...(cc ? { cc } : {}), ...message }); return new Response(null, { status: 200 }); }
    catch { return new Response(null, { status: 400 }); }
  };
  let delivery: () => Promise<void> = async () => {};
  t.mock.method(providers.imap, "send", async () => delivery());
  try {
    await t.test("saved contacts are created, edited and deleted only through authenticated routes", async () => {
      assert.equal((await fetch(`${origin}/api/contacts`)).status, 403);
      assert.equal((await fetch(`${origin}/api/contacts`, { method: "POST", headers: desktop, body: "{}" })).status, 403);
      const created = await request("/contacts", "POST", { accountId: "work", name: "Ada Lovelace", email: "ada@example.test" });
      assert.equal(created.status, 201);
      const ada = await created.json() as SavedContact;
      assert.deepEqual({ ...ada, id: "", updatedAt: 0 }, { kind: "saved", id: "", accountId: "work", name: "Ada Lovelace", email: "ada@example.test", updatedAt: 0 });
      assert.equal((await request("/contacts", "POST", { accountId: "work", name: "Duplicate", email: "ADA@example.test" })).status, 409);
      assert.equal((await request("/contacts", "POST", { accountId: "missing", name: "", email: "ada@example.test" })).status, 404);
      assert.equal((await request("/contacts", "POST", { accountId: "work", name: "Line\nbreak", email: "x@example.test" })).status, 400);
      assert.equal((await request("/contacts", "POST", { accountId: "work", name: "", email: "not an address" })).status, 400);
      const edited = await request(`/contacts/${ada.id}`, "PUT", { name: "Ada King", email: "ada.king@example.test" });
      assert.equal(edited.status, 200);
      assert.deepEqual((await list()).saved.map(({ name, email }) => [name, email]), [["Ada King", "ada.king@example.test"]]);
      assert.equal((await request(`/contacts/${ada.id}`, "DELETE")).status, 200);
      assert.equal((await request(`/contacts/${ada.id}`, "DELETE")).status, 404);
      assert.deepEqual((await list()).saved, []);
    });

    await t.test("imports classify new, changed, unchanged and missing contacts before any write", async () => {
      const seed = async (accountId: string, name: string, email: string) => {
        const created = await request("/contacts", "POST", { accountId, name, email });
        assert.equal(created.status, 201, email);
        return await created.json() as SavedContact;
      };
      const renamed = await seed("work", "Renamed Before", "renamed@example.test");
      await seed("work", "Same Name", "same@example.test");
      await seed("work", "Empty Named", "empty-name@example.test");
      await seed("work", "", "blank@example.test");
      const absent = await seed("work", "Missing Person", "missing@example.test");
      const other = await seed("home", "Other Account Renamed", "renamed@example.test");
      const content = "Name,E-mail 1 - Value\n" + [
        "Renamed After,renamed@example.test",
        "Same Name,same@example.test",
        ",empty-name@example.test",
        "Blank Filled,blank@example.test",
        "New One,new.one@example.test",
        "New Two,new.two@example.test",
        "Invalid,not-an-address",
      ].join("\n");
      const input = { accountId: "work", format: "csv", content };
      assert.equal((await fetch(`${origin}/api/contacts/import`, { method: "POST", headers: desktop, body: JSON.stringify(input) })).status, 403);
      const before = (await list()).saved.length;
      const preview = await request("/contacts/import/preview", "POST", input);
      assert.equal(preview.status, 200);
      assert.deepEqual(await preview.json(), {
        added: 2, changed: 2, updated: 0, unchanged: 2, missing: 1, skipped: 1,
        sample: [{ name: "New One", email: "new.one@example.test" }, { name: "New Two", email: "new.two@example.test" }],
        changes: [
          { email: "renamed@example.test", name: "Renamed After", previousName: "Renamed Before" },
          { email: "blank@example.test", name: "Blank Filled", previousName: "" },
        ],
      });
      assert.equal((await list()).saved.length, before, "preview writes nothing");
      // An opted-in preview reports the renames it would write.
      const updatePreview = await request("/contacts/import/preview", "POST", { ...input, updateNames: true });
      assert.equal((await updatePreview.json()).updated, 2);
      const imported = await request("/contacts/import", "POST", input);
      assert.equal(imported.status, 200);
      const importedJson = await imported.json();
      assert.equal(importedJson.added, 2);
      assert.equal(importedJson.updated, 0);
      const saved = async () => (await list()).saved;
      assert.equal((await saved()).find(item => item.email === "renamed@example.test" && item.accountId === "work")!.name, "Renamed Before", "names stay without updateNames");
      const updated = await request("/contacts/import", "POST", { ...input, updateNames: true });
      const updatedJson = await updated.json();
      assert.equal(updatedJson.added, 0);
      assert.equal(updatedJson.updated, 2);
      const after = await saved();
      const renamedNow = after.find(item => item.email === "renamed@example.test" && item.accountId === "work")!;
      assert.equal(renamedNow.name, "Renamed After");
      assert.equal(renamedNow.id, renamed.id, "name updates keep the contact id");
      assert.equal(after.find(item => item.email === "blank@example.test")!.name, "Blank Filled");
      assert.ok(after.some(item => item.id === absent.id), "contacts missing from the file stay saved");
      assert.equal(after.find(item => item.id === other.id)!.name, "Other Account Renamed", "other accounts are untouched");
      assert.ok((await suggest("new.one", "work")).some(item => item.email === "new.one@example.test"));
      const repreview = await request("/contacts/import/preview", "POST", { ...input, updateNames: true });
      const repreviewJson = await repreview.json();
      assert.equal(repreviewJson.changed, 0);
      assert.equal(repreviewJson.unchanged, 6);
      assert.equal(repreviewJson.added, 0);
      assert.equal((await request("/contacts/import", "POST", { ...input, accountId: "missing" })).status, 404);
      assert.equal((await request("/contacts/import", "POST", { ...input, extra: true })).status, 400, "the strict schema rejects unknown fields");
      assert.equal((await request("/contacts/import", "POST", { ...input, updateNames: "yes" })).status, 400);
      const malformed = await request("/contacts/import", "POST", { ...input, content: 'private-sensitive-value' });
      assert.equal(malformed.status, 400);
      assert.doesNotMatch(await malformed.text(), /private-sensitive-value/);
      // Only new addresses count against the 1000-contact limit; saved
      // addresses in the file are classifications, not additions.
      const savedWork = (await saved()).filter(item => item.accountId === "work").length;
      const fill = 'Name,Email\n' + Array.from({ length: 1000 - savedWork }, (_, index) => `Person ${index},fill-${index}@example.test`).join('\n');
      const fit = await request("/contacts/import/preview", "POST", { ...input, content: fill + '\nRenamed After,renamed@example.test' });
      assert.equal(fit.status, 200, "existing addresses in the file do not count against the limit");
      const count = (await saved()).length;
      const overflow = await request("/contacts/import", "POST", { ...input, content: 'Name,Email\n' + Array.from({ length: 1000 }, (_, index) => `Person ${index},import-${index}@example.test`).join('\n') });
      assert.equal(overflow.status, 409);
      assert.equal((await saved()).length, count, "over-limit imports write nothing");
      for (const suffix of ["", "-wal"]) {
        const filename = path.join(directory, `mail.sqlite${suffix}`);
        if (existsSync(filename)) assert.equal(readFileSync(filename).includes(Buffer.from("renamed@example.test")), false);
      }
      for (const contact of (await saved())) await request(`/contacts/${contact.id}`, "DELETE");
    });

    await t.test("only accepted sends add recent recipients, excluding connected accounts", async () => {
      delivery = async () => { throw new Error("Synthetic rejection"); };
      assert.equal((await send("rejected@example.test")).status, 400);
      assert.deepEqual((await list()).recent, []);
      delivery = async () => {};
      assert.equal((await send("grace@example.test", ["home@example.test", "Linus@example.test"])).status, 200);
      delivery = async () => { throw new SentCopyError("Delivered, but the Sent copy failed. Do not resend."); };
      assert.equal((await send("sent-copy@example.test")).status, 200);
      delivery = async () => {};
      assert.deepEqual((await list()).recent.map(({ accountId, email }) => [accountId, email]).sort(), [
        ["work", "Linus@example.test"], ["work", "grace@example.test"], ["work", "sent-copy@example.test"],
      ]);
      await send("LINUS@example.test");
      assert.equal((await list()).recent.filter(({ email }) => email.toLowerCase() === "linus@example.test").length, 1);
    });

    await t.test("suggestions rank saved contacts first and the sending account before others", async () => {
      await request("/contacts", "POST", { accountId: "home", name: "Grace Hopper", email: "grace@example.test" });
      await request("/contacts", "POST", { accountId: "work", name: "Gregory", email: "gregory@example.test" });
      const fromWork = await suggest("gr", "work");
      assert.deepEqual(fromWork.map(({ kind, accountId, email }) => [kind, accountId, email]), [
        ["saved", "work", "gregory@example.test"], ["recent", "work", "grace@example.test"],
      ]);
      const fromHome = await suggest("GRACE", "home");
      assert.deepEqual(fromHome.map(({ kind, accountId }) => [kind, accountId]), [["saved", "home"]]);
      assert.deepEqual(await suggest("hopper", "work"), (await suggest("hopper", "home")));
      assert.deepEqual(await suggest(" ", "work"), []);
      assert.deepEqual(await suggest("nobody", "work"), []);
    });

    await t.test("recent recipients keep the newest 200 per account", async () => {
      for (let index = 0; index < 205; index++) {
        await send(`bulk-${index}@example.test`);
        // Let HTTP keepalive and outbox timers progress during synchronous storage work.
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const recent = (await list()).recent.filter(({ accountId }) => accountId === "work");
      assert.equal(recent.length, 200);
      assert.equal(recent[0].email, "bulk-204@example.test");
      assert.equal(recent.some(({ email }) => email === "grace@example.test"), false);
      const removed = recent[0];
      assert.equal((await request(`/contacts/recent/${removed.id}`, "DELETE")).status, 200);
      assert.equal((await list()).recent.some(({ id }) => id === removed.id), false);
    });

    await t.test("contacts are encrypted at rest and readable after a restart", async () => {
      for (const suffix of ["", "-wal"]) {
        const filename = path.join(directory, `mail.sqlite${suffix}`);
        if (!existsSync(filename)) continue;
        const bytes = readFileSync(filename);
        for (const text of ["Grace Hopper", "grace@example.test", "gregory@example.test", "bulk-204@example.test"])
          assert.equal(bytes.includes(Buffer.from(text)), false, `plaintext contact in SQLite${suffix}`);
      }
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
        import { listContacts } from ${JSON.stringify(new URL("./contacts.ts", import.meta.url).href)};
        console.log(JSON.stringify(listContacts().saved.map(({ name }) => name)));
      `], { env: { ...process.env, MAIL_DESKTOP_TOKEN: "", MAIL_DATA_DIR: directory, MAIL_DATA_KEY: key }, encoding: "utf8", timeout: 15000 });
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout.trim()), ["Grace Hopper", "Gregory"]);
    });

    await t.test("disconnecting an account removes its contacts and recipients", async () => {
      assert.equal((await request("/accounts/work", "DELETE")).status, 200);
      const remaining = await list();
      assert.deepEqual(remaining.saved.map(({ accountId }) => accountId), ["home"]);
      assert.deepEqual(remaining.recent, []);
      assert.deepEqual(store.all("recentRecipient"), []);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.closeStore();
    rmSync(directory, { recursive: true, force: true });
  }
});
