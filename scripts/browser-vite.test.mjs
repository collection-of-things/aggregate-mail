import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "vite";
import config from "../vite.config.ts";

test("browser development server denies private files including /@fs access", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-vite-private-"));
  const files = [".env", ".env.local", "settings.env", "mail.sqlite", "mail.sqlite-wal", "key", "key.protected", "key.local", "private.pem", ".git/config", ".data/mail/key"];
  for (const name of files) {
    const file = path.join(directory, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "SYNTHETIC-PRIVATE-CONTENT");
  }
  const server = await createServer({ ...config, configFile: false, root: directory, plugins: [], logLevel: "silent", server: { ...config.server, host: "127.0.0.1", port: 0, proxy: undefined } });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    for (const name of files) for (const target of [`/${name}`, `/@fs/${path.join(directory, name)}`]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${target}`);
      assert.ok([403, 404].includes(response.status), `${target} must be denied`);
      assert.equal((await response.text()).includes("SYNTHETIC-PRIVATE-CONTENT"), false);
    }
  } finally { await server.close(); rmSync(directory, { recursive: true, force: true }); }
});
