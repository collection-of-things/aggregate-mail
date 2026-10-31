import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";

if (!process.env.EMC2_DEMO_TEST_CHILD) {
  test("demo mailbox through the real sync and store", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "emc2-demo-"));
    const env: NodeJS.ProcessEnv = { ...process.env, EMC2_DEMO_TEST_CHILD: "1", MAIL_DATA_DIR: directory,
      MAIL_CONFIG_PATH: path.join(directory, "absent.env"), MAIL_DATA_KEY: randomBytes(32).toString("base64"),
      MAIL_DESKTOP_TOKEN: "synthetic-session", TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" };
    delete env.NODE_TEST_CONTEXT;
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", "--test", fileURLToPath(import.meta.url)], {
        env, encoding: "utf8", timeout: 120000,
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  test("demo accounts sync into every inbox tab and keep local actions", async () => {
    const directory = process.env.MAIL_DATA_DIR!;
    const { installDemoMailbox, demoAccounts, demoMessages } = await import("./demo-mail.js");
    const { readMail, mailSummary } = await import("./store.js");
    const { providers } = await import("./providers.js");
    installDemoMailbox(directory);
    const { syncMail } = await import("./index.js");
    assert.deepEqual(await syncMail(), { errors: [] });

    const received = (await readMail()).filter((m) => m.direction !== "sent");
    assert.equal(received.length, demoMessages.length);
    assert.deepEqual(new Set(received.map((m) => m.accountId)), new Set(demoAccounts.map((a) => a.id)));
    assert.deepEqual(new Set(received.map((m) => mailSummary(m).inboxTab)),
      new Set(["primary", "social", "promotions", "newsletters", "transactions", "updates"]));
    const invite = received.find((m) => m.subject === "Invitation: Design review")!;
    assert.equal(invite.invitation?.status, "ok");
    assert.equal(received.find((m) => m.subject.startsWith("Can you review"))!.attachments?.[0].filename, "q4-launch-plan.csv");

    // Archive, read and send stay local and survive the next sync and a restart.
    const work = demoAccounts[0];
    const unread = received.find((m) => m.accountId === work.id && m.unread)!;
    await providers[work.provider].update(work, invite, "archive");
    await providers[work.provider].update(work, unread, "read");
    await providers[work.provider].send(work, { accountId: work.id, to: "priya@northwind.example", subject: "Synthetic reply", body: "Synthetic body" });
    assert.deepEqual(await syncMail(), { errors: [] });
    const after = new Map((await readMail()).map((m) => [m.id, m]));
    assert.equal(after.get(invite.id)?.archived, true);
    assert.equal(after.get(unread.id)?.unread, false);
    installDemoMailbox(directory);
    const sent = await providers[work.provider].sent(work, 100);
    assert.ok(sent.messages.some((m) => m.subject === "Synthetic reply" && m.direction === "sent"));
  });
}
