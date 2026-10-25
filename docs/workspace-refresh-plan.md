# Workspace refresh memory plan

## Goal and evidence

Stop periodic workspace/proposal refresh from materializing unrelated cached
message bodies. A synthetic 3,000-message cache with one proposal and one related
message decoded all 3,000 bodies, took 22.2 seconds and reached 528MB peak heap.
This reproduces the allocation mechanism; it does not prove the source of every
native CPU or memory spike.

## Smallest change

1. Extract the existing account-scoped conversation membership rule into a pure
   helper. Index thread and reference tokens separately per account and select
   the same transitive membership. Keep existing date/ID ordering, gaps and
   body-sensitive fingerprint fields.
2. Add a store reader using the existing summary capture and SQLite WAL scan.
   Select the union of proposal conversations from summaries synchronously,
   then decode only those full records in one coherent read snapshot. Preserve
   external-write invalidation and missing-source behavior.
3. Use that reader for visible proposal checks. Reuse one snapshot and one hash
   per source. Preserve proposal approval/revalidation, encryption, account
   scope and all sending contracts. Explicit synchronous approval paths retain
   their current contract; no cache may hide changes to bodies or threads.
4. Exercise equivalent membership, shared reference/thread tokens across
   accounts, missing sources, transitive replies, body changes, unrelated mail,
   concurrent writes and changed-source guards. Update the existing exact
   parse-count regression to require only relevant records.
5. Repeat the matched synthetic HTTP probe and report decoded records, CPU,
   elapsed time and peak memory. Run bounded serial application tests, strict
   build and affected MCP/desktop checks, independent source review, then exact
   Mac package/startup/launch before commit. No live mailbox writes or release.

## Ownership and delivery

Issue #37; one writer and delivery owner, @pekth. Branch
fix/workspace-refresh-memory, stacked on feat/rich-text-compose at fa3fe6d.
Owned paths: server conversation helper/store/workspace, affected tests,
CHANGELOG, KB and a numbered ADR. No dependencies or user-setting changes.

Rollback restores the prior reader without a migration. Native long-running
resource use remains separate from this synthetic workload.
