import { test } from "node:test";
import assert from "node:assert/strict";
import { plainSendSchema, sendSchema } from "./providers.js";

test("send requires one to 100 To recipients and accepts Bcc", () => {
  const value = { accountId: "synthetic", to: ["one@example.test", "two@example.test"], bcc: ["hidden@example.test"], subject: "Synthetic", body: "Body" };
  assert.deepEqual(sendSchema.parse(value).to, value.to);
  assert.deepEqual(sendSchema.parse(value).bcc, value.bcc);
  assert.deepEqual(plainSendSchema.parse({ ...value, to: "legacy@example.test" }).to, ["legacy@example.test"]);
  for (const recipients of [["invalid"], Array(101).fill("one@example.test")]) {
    assert.equal(sendSchema.safeParse({ ...value, bcc: recipients }).success, false);
    assert.equal(sendSchema.safeParse({ ...value, cc: recipients }).success, false);
  }
  assert.equal(sendSchema.safeParse({ ...value, to: [] }).success, false);
  assert.equal(sendSchema.safeParse({ ...value, to: Array(101).fill("one@example.test") }).success, false);
});
