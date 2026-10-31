import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { ImapFlow } from "imapflow";
import { guardSearchExpansion } from "./imap-search-budget.js";

// Exercise the pinned dependency callback before its range allocation.
const search = createRequire(import.meta.url)("imapflow/lib/commands/search.js");
test("protocol search budgets apply before compact range expansion", async () => {
  for (const [ranges, expected] of [
    [["1:4294967295"], false], [["1:6000", "6001:12000"], false], [["2:4,8"], [2, 3, 4, 8]],
  ] as const) {
    let closed = false;
    const client = {
      state: 3, states: { SELECTED: 3 }, mailbox: { exists: 4294967295 }, log: { warn() {} },
      close() { closed = true; },
      async exec(_command: string, _attrs: unknown, options: any) {
        for (const range of ranges) await options.untagged.ESEARCH({ attributes: [{ type: "ATOM", value: "ALL" }, { type: "ATOM", value: range }] });
        return { next() {} };
      },
    };
    guardSearchExpansion(client as unknown as ImapFlow);
    const started = performance.now();
    assert.deepEqual(await search(client, true, { uid: true }), expected);
    assert.equal(closed, expected === false);
    assert.ok(performance.now() - started < 1000);
  }
});
