import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { savedViewSchema } from "../shared/saved-views.js";
import { quietImapWatch } from "./imap-watch-fixture.js";

test("saved views persist encrypted exact definitions with authenticated CRUD and stale-write protection", { timeout: 60000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-saved-views-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 57).toString("base64");
  process.env.MAIL_CONFIG_PATH = path.join(directory, "absent.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-saved-views";
  process.env.TYPESAFE_API_KEY = ""; process.env.OPENAI_API_KEY = "";
  const backend = await import("./index.js");
  const server = await backend.startServer(0, undefined, undefined, undefined, quietImapWatch);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const desktop = { "X-Desktop-Token": "synthetic-saved-views", "Content-Type": "application/json" };
  const { csrf } = await (await fetch(`${origin}/api/state`, { headers: desktop })).json();
  const headers = { ...desktop, "X-CSRF-Token": String(csrf) };
  const request = (method = "GET", body?: unknown, id = "") => fetch(`${origin}/api/saved-views${id ? `/${id}` : ""}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const definition = { view: "archive", tab: "newsletters", query: 'from:newsletter@example.test "private phrase"',
    accountFilter: "synthetic-account", labelFilter: "synthetic-account:label", readFilter: "unread", relevanceFilter: "2", sort: "oldest" };
  try {
    assert.equal((await fetch(`${origin}/api/saved-views`)).status, 403);
    assert.equal((await fetch(`${origin}/api/saved-views`, { method: "POST", headers: desktop, body: "{}" })).status, 403);
    assert.equal((await request("POST", { name: "Bad\nname", definition })).status, 400);
    assert.equal((await request("POST", { name: "Invalid", definition: { ...definition, view: "actions" } })).status, 400);
    assert.equal((await request("POST", { name: "", definition })).status, 400);
    const created = await request("POST", { name: "Private named view", definition });
    assert.equal(created.status, 201);
    const saved = savedViewSchema.parse(await created.json());
    assert.deepEqual(saved.definition, definition);
    assert.deepEqual(await (await request()).json(), [saved]);
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { all } from ${JSON.stringify(new URL("./store.ts", import.meta.url).href)};
      process.stdout.write(JSON.stringify(all("savedView")));
    `], { encoding: "utf8", env: process.env, timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), [saved]);
    for (const suffix of ["", "-wal"]) {
      const file = path.join(directory, `mail.sqlite${suffix}`);
      if (existsSync(file)) for (const text of [saved.name, definition.query, definition.accountFilter])
        assert.equal(readFileSync(file).includes(Buffer.from(text)), false);
    }
    const renamed = savedViewSchema.parse(await (await request("PATCH", { name: "Renamed view", revision: saved.revision }, saved.id)).json());
    assert.equal(renamed.name, "Renamed view");
    assert.deepEqual(renamed.definition, definition);
    assert.equal((await request("DELETE", { revision: saved.revision }, saved.id)).status, 409);
    assert.equal((await request("DELETE", { revision: renamed.revision }, renamed.id)).status, 200);
    assert.deepEqual(await (await request()).json(), []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    (await import("./store.js")).closeStore();
    rmSync(directory, { recursive: true, force: true });
  }
});
