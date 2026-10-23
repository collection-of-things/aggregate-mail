import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

test("connection settings preserve other config and reject line injection", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aggregate-config-"));
  process.env.MAIL_DATA_DIR = path.join(directory, "mail");
  process.env.MAIL_CONFIG_PATH = path.join(directory, "settings.env");
  process.env.MAIL_DESKTOP_TOKEN = "test-only-token";
  writeFileSync(
    process.env.MAIL_CONFIG_PATH,
    "# Keep this\nAPP_URL=http://127.0.0.1:3001\nGOOGLE_CLIENT_ID=old\n",
  );
  const { startServer } = await import("./index.js");
  const server = await startServer(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      "X-Desktop-Token": "test-only-token",
      "Content-Type": "application/json",
    };
    const state = (await (
      await fetch(`${origin}/api/state`, { headers })
    ).json()) as { csrf: string };
    const mutationHeaders = { ...headers, "X-CSRF-Token": state.csrf };
    const saved = await fetch(`${origin}/api/config`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        googleClientId: "new-client",
        googleClientSecret: "test-secret",
      }),
    });
    assert.equal(saved.status, 200);
    const config = readFileSync(process.env.MAIL_CONFIG_PATH, "utf8");
    assert.match(config, /# Keep this\nAPP_URL=http:\/\/127\.0\.0\.1:3001/);
    assert.ok(!config.includes("new-client"));
    assert.ok(!config.includes("test-secret"));
    const { get } = await import("./store.js");
    assert.equal(get("config", "connection")?.GOOGLE_CLIENT_ID, "new-client");
    assert.equal(get("config", "connection")?.GOOGLE_CLIENT_SECRET, "test-secret");
    assert.ok(!config.includes("GOOGLE_CLIENT_ID=old"));
    const rejected = await fetch(`${origin}/api/config`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ googleClientSecret: "bad\nINJECTED=1" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(readFileSync(process.env.MAIL_CONFIG_PATH, "utf8"), config);
    assert.equal((await fetch(`${origin}/api/state`)).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    (await import("./store.js")).closeStore();
    rmSync(directory, { recursive: true, force: true });
  }
});

function isolatedConfig(directory: string, source: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, MAIL_DATA_DIR: directory, MAIL_DATA_KEY: "",
    MAIL_CONFIG_PATH: path.join(directory, "settings.env") };
  for (const name of ["NODE_TEST_CONTEXT", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OPENAI_API_KEY", "TYPESAFE_API_KEY", "TYPESAFE_PROVIDER"]) delete env[name];
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { env, encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
}

test("encrypted settings migrate, retain launch precedence and recover after failed plaintext cleanup", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-config-migration-"));
  const legacy = '# Keep this\nAPP_URL=http://127.0.0.1:3001\nexport GOOGLE_CLIENT_SECRET="synthetic-first\nsecond-line"\nGOOGLE_CLIENT_ID=legacy-client\nOTHER="keep\nGOOGLE_CLIENT_ID=inside-unrelated-value"\n';
  writeFileSync(path.join(directory, "settings.env"), legacy);
  try {
    isolatedConfig(directory, `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      process.env.GOOGLE_CLIENT_ID='launch-client';
      const c = await import('./server/config.ts');
      const s = await import('./server/store.ts');
      const original = fs.renameSync;
      fs.renameSync=()=>{throw new Error('synthetic cleanup failure')}; syncBuiltinESMExports();
      assert.throws(()=>c.loadConfiguration(),/synthetic cleanup failure/);
      fs.renameSync=original; syncBuiltinESMExports();
      assert.equal(s.get('config','connection').GOOGLE_CLIENT_ID,'legacy-client');
      assert.ok(fs.readFileSync(process.env.MAIL_CONFIG_PATH,'utf8').includes('synthetic-first'));
      s.closeStore();
    `);
    isolatedConfig(directory, `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      process.env.GOOGLE_CLIENT_ID='launch-client';
      const c = await import('./server/config.ts');
      const s = await import('./server/store.ts');
      c.loadConfiguration();
      assert.equal(process.env.GOOGLE_CLIENT_ID,'launch-client');
      assert.equal(process.env.GOOGLE_CLIENT_SECRET,'synthetic-first\\nsecond-line');
      assert.equal(process.env.OTHER,'keep\\nGOOGLE_CLIENT_ID=inside-unrelated-value');
      const cleaned = fs.readFileSync(process.env.MAIL_CONFIG_PATH,'utf8');
      assert.ok(!cleaned.includes('synthetic-first'));
      assert.ok(cleaned.includes('# Keep this'));
      assert.ok(cleaned.includes('GOOGLE_CLIENT_ID=inside-unrelated-value'));
      c.saveConfiguration({GOOGLE_CLIENT_SECRET:'synthetic-updated',OPENAI_API_KEY:'synthetic-openai'});
      assert.equal(process.env.GOOGLE_CLIENT_ID,'launch-client');
      const raw = new DatabaseSync(process.env.MAIL_DATA_DIR+'/mail.sqlite');
      const value = raw.prepare("SELECT value FROM records WHERE kind='config'").get().value;
      assert.ok(!value.includes('synthetic-updated')); raw.close(); s.closeStore();
    `);
    isolatedConfig(directory, `
      import assert from 'node:assert/strict';
      const c = await import('./server/config.ts'); const s = await import('./server/store.ts');
      c.loadConfiguration();
      assert.equal(process.env.GOOGLE_CLIENT_ID,'legacy-client');
      assert.equal(process.env.GOOGLE_CLIENT_SECRET,'synthetic-updated');
      assert.equal(process.env.OPENAI_API_KEY,'synthetic-openai'); s.closeStore();
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test("settings write and readback failures retain legacy plaintext and prior durable settings", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-config-failure-"));
  writeFileSync(path.join(directory,"settings.env"),'GOOGLE_CLIENT_SECRET=synthetic-legacy\nKEEP=value\n');
  try {
    isolatedConfig(directory, `
      import assert from 'node:assert/strict';
      import fs from 'node:fs'; import { DatabaseSync } from 'node:sqlite';
      const c = await import('./server/config.ts'); const s = await import('./server/store.ts');
      const raw = new DatabaseSync(process.env.MAIL_DATA_DIR+'/mail.sqlite');
      const before = fs.readFileSync(process.env.MAIL_CONFIG_PATH,'utf8');
      raw.exec("CREATE TRIGGER fail_config BEFORE INSERT ON records WHEN NEW.kind='config' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END");
      assert.throws(()=>c.loadConfiguration(),/synthetic write failure/);
      assert.equal(fs.readFileSync(process.env.MAIL_CONFIG_PATH,'utf8'),before);
      raw.exec('DROP TRIGGER fail_config');
      raw.exec("CREATE TRIGGER bad_readback AFTER INSERT ON records WHEN NEW.kind='config' BEGIN UPDATE records SET value='invalid' WHERE kind='config'; END");
      assert.throws(()=>c.loadConfiguration());
      assert.equal(s.get('config','connection'),undefined);
      assert.equal(fs.readFileSync(process.env.MAIL_CONFIG_PATH,'utf8'),before);
      raw.exec('DROP TRIGGER bad_readback');
      raw.close(); s.closeStore();
    `);
    isolatedConfig(directory, `
      import assert from 'node:assert/strict';
      const c = await import('./server/config.ts'); const s = await import('./server/store.ts');
      c.loadConfiguration();
      assert.equal(s.get('config','connection').GOOGLE_CLIENT_SECRET,'synthetic-legacy'); s.closeStore();
    `);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
