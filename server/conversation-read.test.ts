import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Mail } from "../shared/types.js";

test("conversation hydration decodes only related mail and preserves coherent body snapshots", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-conversation-read-"));
  process.env.MAIL_DATA_DIR = directory; process.env.MAIL_DATA_KEY = Buffer.alloc(32, 89).toString("base64");
  const store = await import("./store.js");
  const mail = (id: string, extra: Partial<Mail> = {}): Mail => ({ id, accountId: "a", remoteId: id, sender: "Synthetic", address: "sender@example.test", to: "reader@example.test", subject: id, body: "Synthetic body " + id, preview: "Synthetic", date: 1, unread: false, archived: false, category: "important", relevance: 2, reason: "Synthetic", snoozedUntil: null, messageId: `<${id}@example.test>`, ...extra });
  const root = mail("root");
  try {
    for (const item of [root, mail("reply", { inReplyTo: root.messageId }), mail("later", { references: ["<reply@example.test>"] }), mail("foreign", { accountId: "b", inReplyTo: root.messageId })]) store.put("mail", item.id, item);
    for (let i = 0; i < 120; i++) { const item = mail("unrelated-" + i, { body: "Synthetic unrelated ".repeat(1000) }); store.put("mail", item.id, item); }
    await store.mailSummaryChanges();
    let decoded = 0;
    const parse = JSON.parse;
    const spy = t.mock.method(JSON, "parse", (value: string, ...rest: unknown[]) => {
      if (value.includes('"body"') && value.includes('"remoteId"')) decoded++;
      return Reflect.apply(parse, JSON, [value, ...rest]);
    });
    let selected: Mail[];
    try { selected = await store.readConversationMail([root.id, root.id, "missing"]); }
    finally { spy.mock.restore(); }
    assert.equal(decoded, 3);
    assert.deepEqual(selected.map(item => item.id).sort(), ["later", "reply", "root"]);
    assert.deepEqual(await store.readConversationMail(["missing"]), []);
    const { fingerprint } = await import("./workspace.js");
    assert.equal(fingerprint(root.id, new Map(selected.map(item => [item.id, item]))), fingerprint(root.id));

    // Cross the 32-row yield boundary while an admitted writer changes a body.
    for (let i = 0; i < 40; i++) { const item = mail("snapshot-" + i, { threadId: "snapshot" }); store.put("mail", item.id, item); }
    const reading = store.readConversationMail(["snapshot-0"]);
    const write = new Promise<void>(resolve => setImmediate(() => { store.put("mail", "snapshot-39", mail("snapshot-39", { threadId: "snapshot", body: "Changed after snapshot" })); resolve(); }));
    const snapshot = await reading; await write;
    assert.equal(snapshot.length, 40);
    assert.equal(snapshot.find(item => item.id === "snapshot-39")?.body, "Synthetic body snapshot-39");
    assert.equal((await store.readConversationMail(["snapshot-0"])).find(item => item.id === "snapshot-39")?.body, "Changed after snapshot");

    // An external writer invalidates the metadata before the next selection.
    const external = mail("external", { inReplyTo: root.messageId });
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import {put,closeStore} from ${JSON.stringify(new URL("./store.ts", import.meta.url).href)};put('mail','external',${JSON.stringify(external)});closeStore();`], { env: process.env, encoding: "utf8", timeout: 15000 });
    assert.equal(child.status, 0, "synthetic external writer completes");
    assert.ok((await store.readConversationMail([root.id])).some(item => item.id === "external"));
    store.remove("mail", root.id);
    assert.deepEqual(await store.readConversationMail([root.id]), []);
  } finally { store.closeStore(); rmSync(directory, { recursive: true, force: true }); }
});
