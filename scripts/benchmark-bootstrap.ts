import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

// Synthetic profiles only. No caller-supplied path; all children are owned and
// serial under the outer Fleet cgroup. Process-cold does not flush OS caches.
const phase = process.env.EMC2_BOOTSTRAP_PHASE;
if (!phase) {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-bootstrap-bench-"));
  try {
    const env = { ...process.env, MAIL_DATA_DIR: directory, MAIL_DATA_KEY: "", MAIL_DESKTOP_TOKEN: randomBytes(32).toString("hex"), MAIL_CONFIG_PATH: path.join(directory, "absent.env"),
      TYPESAFE_API_KEY: "", TYPESAFE_PROVIDER: "", TYPESAFE_ENDPOINT: "", TYPESAFE_MODEL: "",
      OPENAI_API_KEY: "", OPENAI_MODEL: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" };
    const seed = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./benchmark-web-startup.ts", import.meta.url))], { env: { ...env, EMC2_STARTUP_PHASE: "seed" }, encoding: "utf8", timeout: 180000 });
    assert.equal(seed.status, 0, seed.stderr); process.stdout.write(seed.stdout);
    for (let pair = 0; pair < 3; pair++) for (const mode of ["baseline", "bootstrap"]) {
      const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], { env: { ...env, EMC2_BOOTSTRAP_PHASE: mode }, encoding: "utf8", timeout: 60000 });
      assert.equal(child.status, 0, child.stderr); process.stdout.write(child.stdout);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
} else {
  assert.ok(phase === "baseline" || phase === "bootstrap");
  const processStart = performance.now();
  const { startServer } = await import("../server/index.js");
  const { closeStore } = await import("../server/store.js");
  const { quietImapWatch, quietGmailRevision } = await import("../server/imap-watch-fixture.js");
  const server = await startServer(0, undefined, undefined, undefined, quietImapWatch, quietGmailRevision);
  const address = server.address(); assert.ok(address && typeof address === "object");
  const serviceReadyMs = performance.now() - processStart;
  const start = performance.now(), headers = { "X-Desktop-Token": process.env.MAIL_DESKTOP_TOKEN!, Connection: "close" };
  const read = async (route: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/${route}`, { headers });
    assert.equal(response.status, 200); const text = await response.text();
    const value = JSON.parse(text); return { ms: performance.now() - start, bytes: Buffer.byteLength(text), value };
  };
  try {
    // Start bootstrap first as App does, without waiting before starting full mail.
    const statusTask = phase === "bootstrap" ? read("bootstrap") : undefined;
    const mailTask = read("state");
    const [status, mail] = await Promise.all([statusTask, mailTask]);
    assert.equal(mail.value.messages.length, Number(process.env.EMC2_BENCHMARK_MESSAGES || 34000));
    assert.equal(mail.value.mailMode, "snapshot"); assert.equal(mail.value.accounts.length, 4);
    if (status) {
      assert.equal("messages" in status.value, false); assert.equal("mailCursor" in status.value, false);
      assert.equal(status.value.accounts.length, 4); assert.equal(status.value.csrf, mail.value.csrf);
    }
    console.log(JSON.stringify({ phase, messages: mail.value.messages.length, serviceReadyMs,
      statusAvailableMs: status?.ms ?? mail.ms, statusBytes: status?.bytes ?? mail.bytes,
      fullMailMs: mail.ms, fullMailBytes: mail.bytes }));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeStore(); }
}
