import assert from "node:assert/strict";
import { test } from "node:test";
import { emailProblems, mask } from "./check-commit-emails.mjs";

const record = (sha, author, committer, body = "subject") => `${sha}\x00${author}\x00${committer}\x00${body}\x1e`;

test("noreply authors, committers and co-authors pass", () => {
  assert.deepEqual(emailProblems([
    record("a".repeat(40), "5535435+pekth@users.noreply.github.com", "noreply@github.com",
      "fix: thing\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nco-authored-by: Dev <49699333+dependabot[bot]@users.noreply.github.com>"),
    record("b".repeat(40), "screen-gd@users.noreply.github.com", "screen-gd@users.noreply.github.com"),
  ].join("\n")), []);
});

test("personal and lookalike addresses in any role are reported", () => {
  const problems = emailProblems([
    record("c".repeat(40), "someone@example.com", "noreply@github.com"),
    record("d".repeat(40), "1+x@users.noreply.github.com", "me@users.noreply.github.com.evil.test"),
    record("e".repeat(40), "1+x@users.noreply.github.com", "noreply@github.com", "x\n\nCo-authored-by: A <a@example.org>"),
  ].join("\n"));
  assert.deepEqual(problems, [
    "ccccccc author s*****@example.com",
    "ddddddd committer m*****@users.noreply.github.com.evil.test",
    "eeeeeee co-author a*****@example.org",
  ]);
  assert.equal(mask("no-at-sign"), "n*****");
});
