# ADR 0057: Encrypted settings and drained storage maintenance

Date: 2026-10-23
Status: Implemented and verified with synthetic Linux source and unpacked-app checks. Native macOS/Windows and installed acceptance remain pending.

## Decision

Store managed Google OAuth, OpenAI and Typesafe connection settings in the
existing encrypted record store, using the unchanged installation key. Preserve
launch-environment precedence and unrelated environment-file entries. Commit
and read back migrated settings before atomically replacing the legacy file
with its unmanaged entries. A cleanup failure retains a usable encrypted copy
and the legacy file for the next attempt. Never create a plaintext backup.
Removing an entry does not securely erase earlier filesystem or backup copies.
An existing database with a missing or invalid key must stop without creating
a replacement key.

Provide authenticated `POST /api/storage/compact` with a strict
`{"confirm":true}` body and the existing desktop-session, origin and CSRF
checks. Block concurrent maintenance and new mail work, stop watchers and drain
admitted provider operations before maintenance. Always resume normal mail
admission afterward, including on failure.

Checkpoint WAL before cleanup and refuse busy readers. Enumerate exact
attachment references from every retained mail record, including Archive and
Sent. Skip deletion when unknown record kinds or incomplete metadata prevent
a complete reference inventory. Decryption or enumeration failure aborts the
cleanup transaction. Draft attachments remain inline in encrypted drafts.
Only unreferenced attachment records may be deleted.

Run SQLite `VACUUM` on the existing encrypted values. Its temporary database
contains ciphertext, with no decrypted export or key rotation. Cleanup commits
separately because SQLite cannot vacuum inside that transaction. A later vacuum
failure does not restore removed orphans, but surviving records remain intact.
Compaction reclaims unused pages; it does not compress live message content.

Automatic maintenance reuses the same drained operation. Probe every five
minutes after at least 60 seconds of genuine mail-work idle. Vacuum only when
free pages occupy at least 16 MiB and 20 percent of the database. Inventory
orphan attachments independently every 24 hours, persisting its timestamp in an
encrypted maintenance record. Recheck space after cleanup and avoid vacuuming
healthy databases. Success defers another attempt for six hours; failures back
off from 30 minutes to six hours. Updates, shutdown and busy work defer attempts.
The timer does not make synchronous SQLite vacuum cancellable.

## Required proof

Use synthetic migration, failure, restart, admission-drain and busy-reader
tests. Compare every surviving ciphertext record and the installation key
before and after compaction. Check draft revisions and uncertain-send markers.
Record RAM, database/WAL size and built-app size separately. Source checks do
not establish power-loss behavior on every filesystem, installed acceptance,
native macOS interaction or real-provider behavior.

## Observed verification

The task #92 candidate passed 1,016 tests, strict build, MCP access checks and
sandbox-enabled Linux source and unpacked-app startup. An observed active
SQLite vacuum was interrupted with SIGKILL. Reopening passed integrity checks
and preserved surviving ciphertext, the installation key and draft revision
and uncertain-send markers. This proves that synthetic process-interruption
case, not power-loss safety on every filesystem.

Separate measurements and their limits are recorded in
[the knowledge base](../KB.md#storage-and-memory-measurements).
