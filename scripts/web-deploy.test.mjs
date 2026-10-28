import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { releaseTag, newer, deploy, recover, buildEnvironment, probe, deploymentPackage } from "./web-deploy.mjs";
const old = "a".repeat(40), next = "b".repeat(40), older = "c".repeat(40);
const tag = "v1.1.0";
const metadata = { tag_name: tag, draft: false, prerelease: false, published_at: "2026-01-01T00:00:00Z" };

test("only published stable releases qualify, with monotonic numeric versions", () => {
  assert.equal(releaseTag(metadata), tag);
  for (const changes of [{ draft: true }, { prerelease: true }, { published_at: null }, { published_at: "invalid" }, { tag_name: "main" }, { tag_name: "v1.0.0-rc.1" }, { tag_name: "v01.0.0" }]) assert.throws(() => releaseTag({ ...metadata, ...changes }));
  assert.equal(newer("v1.10.0", "v1.9.9"), true);
  assert.equal(newer("v1.1.0", "v1.1.0"), false);
  assert.equal(newer("v1.0.0", "v1.1.0"), false);
  const env = buildEnvironment("/synthetic/build-home");
  assert.deepEqual(Object.keys(env).sort(), ["CI", "ELECTRON_SKIP_BINARY_DOWNLOAD", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TERMINAL_PROMPT", "HOME", "NODE_OPTIONS", "PATH", "TMPDIR"].sort());
});
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "emc2-deploy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function release(revision, version, profile = 1) {
    const directory = path.join(root, "releases", revision);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, ".web-deployment.json"), JSON.stringify({ revision, tag: version, profile }));
    return directory;
  }
  await release(old, "v1.0.0");
  await release(older, "v0.9.0");
  await symlink(`releases/${old}`, path.join(root, "current"));
  await symlink(`releases/${older}`, path.join(root, "previous"));
  const calls = [];
  const options = { root, latest: async () => tag,
    prepare: async () => ({ revision: next, directory: path.join(root, "releases", next), build: async () => { calls.push("build"); await release(next, tag); } }),
    service: { stop: async () => { calls.push("stop"); }, start: async () => { calls.push("start"); } },
    health: async (_port, revision) => { calls.push(revision); },
  };
  return { root, options, calls, release, current: () => readlink(path.join(root, "current")) };
}
test("verified deployment switches current and retains previous", async t => {
  const f = await fixture(t);
  assert.deepEqual(await deploy(f.options), { status: "updated", revision: next });
  assert.deepEqual(f.calls, ["build", "stop", "start", next]);
  assert.equal(await f.current(), `releases/${next}`);
  assert.equal(await readlink(path.join(f.root, "previous")), `releases/${old}`);
});
test("failed build leaves service untouched and requires an explicit retry", async t => {
  const f = await fixture(t);
  const build = f.options.prepare;
  f.options.prepare = async () => ({ ...await build(), build: async () => { throw new Error("synthetic build failure"); } });
  await assert.rejects(deploy(f.options), /synthetic build failure/);
  assert.deepEqual(f.calls, []);
  await assert.rejects(deploy(f.options), /explicit retry/);
  f.options.prepare = build;
  assert.equal((await deploy({ ...f.options, retry: true })).status, "updated");
});
test("failed drain leaves current unchanged and never starts replacement", async t => {
  const f = await fixture(t);
  f.options.service.stop = async () => { throw new Error("busy"); };
  await assert.rejects(deploy(f.options), /did not stop safely/);
  assert.equal(await f.current(), `releases/${old}`);
  assert.deepEqual(f.calls, ["build"]);
});
test("failed revision check restores the previous service and pointers", async t => {
  const f = await fixture(t);
  f.options.health = async (_port, revision) => { if (revision === next) throw new Error("wrong revision"); f.calls.push(revision); };
  await assert.rejects(deploy(f.options), /previous deployment restored/);
  assert.equal(await f.current(), `releases/${old}`);
  assert.deepEqual(f.calls, ["build", "stop", "start", "stop", "start", old]);
  assert.equal(await readlink(path.join(f.root, "previous")), `releases/${older}`);
});
test("failed rollback preserves an interrupted-switch record and blocks updates", async t => {
  const f = await fixture(t);
  f.options.health = async () => { throw new Error("unhealthy"); };
  await assert.rejects(deploy(f.options), /operator recovery required/);
  await assert.rejects(deploy(f.options), /Run recover/);
  const pending = JSON.parse(await readFile(path.join(f.root, "pending.json"), "utf8"));
  assert.equal(pending.from, `releases/${old}`);
  assert.equal((await deploy({ ...f.options, command: "status" })).pending, true);
  f.options.health = async (_port, revision) => assert.equal(revision, old);
  assert.equal((await recover(f.options)).status, "recovered");
  assert.equal(await f.current(), `releases/${old}`);
  await assert.rejects(deploy(f.options), /explicit retry/);
});
test("automatic updates never downgrade and reject moved installed tags", async t => {
  const f = await fixture(t);
  assert.equal((await deploy({ ...f.options, latest: async () => "v0.9.0" })).status, "up to date");
  assert.deepEqual(f.calls, []);
  await assert.rejects(deploy({ ...f.options, latest: async () => "v1.0.0" }), /tag moved/);
  assert.deepEqual(f.calls, []);
});
test("incompatible profile formats block activation", async t => {
  const f = await fixture(t);
  f.options.prepare = async () => ({ revision: next, directory: path.join(f.root, "releases", next), build: () => f.release(next, tag, 2) });
  await assert.rejects(deploy(f.options), /Profile format changed/);
  assert.equal(await f.current(), `releases/${old}`);
  assert.deepEqual(f.calls, []);
});
test("manual rollback suppresses automatic redeployment of the same release", async t => {
  const f = await fixture(t);
  await deploy(f.options);
  assert.equal((await deploy({ ...f.options, command: "rollback" })).status, "rolled back");
  assert.equal(await f.current(), `releases/${old}`);
  await assert.rejects(deploy(f.options), /explicit retry/);
});
test("concurrent runs and unsafe pointers are rejected before service actions", async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, "update.lock"));
  await assert.rejects(deploy(f.options), /lock exists/);
  await rm(path.join(f.root, "update.lock"), { recursive: true });
  await rm(path.join(f.root, "current"));
  await symlink("../other-profile", path.join(f.root, "current"));
  await assert.rejects(deploy(f.options), /Unsafe deployment pointer/);
  assert.deepEqual(f.calls, []);
});
test("probe accepts only the requested revision from the protected browser gate", async t => {
  const server = createServer((_req, res) => { res.writeHead(200, { "X-Emc2-Browser": "1", "X-Emc2-Revision": next }); res.end("synthetic"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await probe(server.address().port, next, 1);
  await assert.rejects(probe(server.address().port, old, 1), /revision check failed/);
});

test("synthetic service processes switch and roll back using actual HTTP revision probes", async t => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const f = await fixture(t);
  let child, port;
  const service = {
    async stop() {
      if (!child) return;
      const exited = once(child, "exit");
      child.kill("SIGTERM"); await exited; child = undefined;
    },
    async start() {
      const revision = path.basename(await f.current());
      child = spawn(process.execPath, ["-e", 'const http=require("node:http");const server=http.createServer((q,s)=>{s.writeHead(200,{"X-Emc2-Browser":"1","X-Emc2-Revision":process.argv[1]});s.end("synthetic")});server.listen(0,"127.0.0.1",()=>console.log(server.address().port));', revision], { stdio: ["ignore", "pipe", "ignore"] });
      port = Number(String((await once(child.stdout, "data"))[0]).trim());
    },
  };
  t.after(() => service.stop());
  await service.start();
  await probe(port, old, 1000);
  const options = { ...f.options, service, health: (_port, revision) => probe(port, revision, 1000) };
  await deploy(options);
  await probe(port, next, 1000);
  await deploy({ ...options, command: "rollback" });
  await probe(port, old, 1000);
});

test("empty deployments bootstrap without touching an existing profile", async t => {
  const f = await fixture(t);
  await rm(path.join(f.root, "current"));
  await rm(path.join(f.root, "previous"));
  assert.equal((await deploy(f.options)).revision, next);
  await assert.rejects(readlink(path.join(f.root, "previous")), { code: "ENOENT" });
});


test("published automatic release stamps its isolated source and lock roots before deployment", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "emc2-web-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  for (const name of ["set-build-version.mjs", "release-version.mjs"]) await cp(new URL(name, import.meta.url), path.join(root, "scripts", name));
  const pkg = { name: "emc2", type: "module", version: "0.2.17", webDeployment: { protocol: 1, profile: 1 }, dependencies: { example: "1.0.0" } };
  const lock = { name: "emc2", version: pkg.version, lockfileVersion: 3, packages: { "": { name: "emc2", version: pkg.version, dependencies: pkg.dependencies }, "node_modules/example": { version: "1.0.0" } } };
  await writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify(lock));
  const stamped = await deploymentPackage(root, "v0.2.18", next);
  assert.deepEqual(stamped, { ...pkg, version: "0.2.18" });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8")), { ...lock, version: "0.2.18", packages: { ...lock.packages, "": { ...lock.packages[""], version: "0.2.18" } } });
  assert.deepEqual(await deploymentPackage(root, "v0.2.18", next), stamped);
  await assert.rejects(deploymentPackage(root, "v0.2.17", next));
});
