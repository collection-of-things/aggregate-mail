import assert from "node:assert/strict";
import { test } from "node:test";
import { accountStatus } from "./account-status";
import type { Account } from "../shared/types";
const account: Account = {id: "a", email: "reader@example.test", provider: "imap"};
test("account statuses use readable fixed text and never expose provider details", () => {
 assert.match(accountStatus(account), /Connected.*incomplete/);
 assert.match(accountStatus({...account, syncStatus: "queued"}), /queued/);
 assert.match(accountStatus({...account, syncStatus: "running"}), /running/);
 assert.match(accountStatus({...account, error: "password at private.example.test"}), /needs attention/);
 assert.doesNotMatch(accountStatus({...account, error: "password at private.example.test"}), /password|private.example.test/);
 assert.match(accountStatus({...account, syncWarning: {} as Account['syncWarning']}), /cleanup failed/);
});
