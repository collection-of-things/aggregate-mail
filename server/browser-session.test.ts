import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("the browser target requires its printed session link before serving /api", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-browser-session-"));
  const env: NodeJS.ProcessEnv = { ...process.env, MAIL_DATA_DIR: directory, MAIL_CONFIG_PATH: path.join(directory, "absent.env"),
    MAIL_DATA_KEY: Buffer.alloc(32, 61).toString("base64"), APP_URL: "http://127.0.0.1:3001", MAIL_DESKTOP_TOKEN: "",
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TYPESAFE_API_KEY: "", OPENAI_API_KEY: "" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    let output = "";
    const link = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No session link printed: ${output}`)), 60000);
      const read = (chunk: Buffer) => {
        output += chunk;
        const match = output.match(/Open (http:\/\/127\.0\.0\.1:3001\/api\/session\?token=[0-9a-f]{64}) /);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
    });
    const origin = "http://127.0.0.1:3001";
    const denied = await fetch(`${origin}/api/state`);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "Open the browser link printed by the mail server." });
    assert.equal((await fetch(`${origin}/api/session?token=${"0".repeat(64)}`, { redirect: "manual" })).status, 403);
    assert.equal((await fetch(`${origin}/api/session`, { redirect: "manual" })).status, 403);
    assert.equal((await fetch(`${origin}/api/session?token=${"é".repeat(32)}`, { redirect: "manual" })).status, 403);
    assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: `emc2_browser_session=${"0".repeat(64)}` } })).status, 403);
    assert.equal((await fetch(`${origin}/api/state`, { headers: { "X-Desktop-Token": "" } })).status, 403);

    const opened = await fetch(link, { redirect: "manual" });
    assert.equal(opened.status, 302);
    assert.equal(opened.headers.get("location"), "/");
    const cookie = opened.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^emc2_browser_session=[0-9a-f]{64}; Path=\/api; HttpOnly; SameSite=Strict$/);
    const allowed = await fetch(`${origin}/api/state`, { headers: { Cookie: cookie.split(";")[0] } });
    assert.equal(allowed.status, 200);
    assert.equal(typeof (await allowed.json()).csrf, "string");
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
