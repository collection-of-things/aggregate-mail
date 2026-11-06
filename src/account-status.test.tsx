import assert from "node:assert/strict";
import { test } from "node:test";
import { accountStatus, accountsNeedingAttention } from "./account-status";
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
test("accountsNeedingAttention counts only failed connections, not busy or warned states", () => {
 assert.equal(accountsNeedingAttention([]), 0);
 assert.equal(accountsNeedingAttention([account]), 0);
 assert.equal(accountsNeedingAttention([{...account, syncStatus: "running"}]), 0);
 assert.equal(accountsNeedingAttention([{...account, syncStatus: "queued"}]), 0);
 assert.equal(accountsNeedingAttention([{...account, syncWarning: {} as Account['syncWarning']}]), 0);
 assert.equal(accountsNeedingAttention([{...account, error: "connection refused"}]), 1);
 assert.equal(accountsNeedingAttention([{...account, syncFailure: {} as Account['syncFailure']}]), 1);
 assert.equal(accountsNeedingAttention([
  {...account, error: "connection refused"},
  {...account, id: "b", syncFailure: {} as Account['syncFailure']},
  {...account, id: "c", syncStatus: "running"},
 ]), 2);
});
