import assert from "node:assert/strict";
import { test } from "node:test";
import { browserShutdown } from "./browser-shutdown.mjs";

test("managed browser drains before closing and ignores repeated stop signals", async () => {
  const calls = [];
  let finish;
  const draining = new Promise(resolve => { finish = resolve; });
  const stop = browserShutdown({ ready: Promise.resolve({ quiesceMail: async timeout => { assert.equal(timeout, 30_000); calls.push("drain"); await draining; }, server: { close: done => { calls.push("close"); done(); } } }), exit: code => calls.push(code), warn: () => assert.fail() });
  const first = stop();
  await Promise.resolve();
  await stop();
  assert.deepEqual(calls, ["drain"]);
  finish(); await first;
  assert.deepEqual(calls, ["drain", "close", 0]);
});

test("failed drain resumes admission without closing or exiting", async () => {
  const calls = [];
  const stop = browserShutdown({ ready: Promise.resolve({ quiesceMail: async () => { throw new Error("synthetic"); }, resumeMail: () => calls.push("resume"), server: { close: () => assert.fail() } }), exit: () => assert.fail(), warn: message => calls.push(message) });
  await stop();
  assert.equal(calls[0], "resume");
  assert.match(calls[1], /must not continue/);
});
