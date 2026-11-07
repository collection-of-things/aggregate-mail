import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackgroundActions, type ActionScope } from "./background-actions";

test("background admission locks exact resources synchronously and releases failures without retry", async () => {
  const actions = createBackgroundActions(() => {});
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const account: ActionScope = { kind: "account", accountId: "a:1" };
  let calls = 0;
  const running = actions.run(account, async () => { calls++; await wait; throw new Error("Unknown result"); });
  assert.equal(actions.pending, true);
  assert.equal(actions.blocksMail("a:1"), true);
  assert.equal(actions.blocksMail("a"), false);
  assert.equal(actions.blocked({ kind: "settings", section: "privacy" }), false);
  await assert.rejects(actions.run(account, async () => { calls++; }), /already in progress/);
  await actions.run({ kind: "settings", section: "privacy" }, async () => {});
  assert.equal(actions.pending, true, "unrelated completion cannot unlock the account");
  finish();
  await assert.rejects(running, /Unknown result/);
  assert.equal(actions.pending, false);
  assert.equal(actions.blocked(account), false);
  assert.equal(calls, 1, "unknown work is never automatically retried");
});

for (const section of ["connection", "backup"] as const) test(`${section} protects conflicting resources without owning navigation`, async () => {
  const actions = createBackgroundActions(() => {});
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const exclusive: ActionScope = { kind: "settings", section };
  const account: ActionScope = { kind: "account", accountId: "a" };
  const first = actions.run(account, () => wait);
  assert.equal(actions.blocked(exclusive), true);
  finish(); await first;
  const second = actions.run(exclusive, () => wait);
  assert.equal(actions.blocked(account), true);
  assert.equal(actions.blocked({ kind: "settings", section: "compose" }), section === "backup");
  assert.equal(actions.blocksMail("b"), true);
  await second;
  assert.equal(actions.blocksMail("b"), false);
});
