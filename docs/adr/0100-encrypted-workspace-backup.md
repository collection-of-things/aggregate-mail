# ADR 0100: Passphrase-encrypted local workspace backups

Date: 2026-10-25
Status: Implemented in source. Installed and native acceptance pending.

## Decision

Settings, About and storage offers explicit export and preview-before-import.
This is a portable file operation, with no schedule, cloud storage or sync.
Keep profile encryption and OS-protected key handling unchanged under
[ADR 0015](0015-macos-keychain-identity.md),
[ADR 0021](0021-macos-keychain-name-migration.md) and
[ADR 0027](0027-linux-local-key-fallback.md).

Version 1 files are UTF-8 JSON envelopes identified by
`format: emc2-workspace-backup` and `version: 1`. The `.emc2-backup` extension
is a file-picker hint. Derive a 32-byte key using Node's asynchronous scrypt,
with N=131072, r=8, p=1 and a random 32-byte salt. Record these parameters
in `kdf`, with `name: scrypt`. Accept only this fixed parameter set in v1,
so an untrusted file cannot choose excessive KDF costs. Require a passphrase
of 12 to 1024 characters. There is no recovery key.

Encrypt with AES-256-GCM, a random 12-byte IV and a 16-byte authentication tag.
Authenticate the constant `emc2-workspace-backup:1` as additional data. Salt,
IV, tag and ciphertext use base64. The encrypted payload contains account
identity hints, whitelisted records and a manifest with format version,
application version, creation time and counts for every record type.
Reject unknown versions, invalid records/counts, duplicate record IDs,
truncated files and failed authentication before writing. Limit files to
32 MiB and serialize backup KDF operations per server instance. This uses
`node:crypto` and adds no dependency.

## Contents and exclusions

Include commitments and their history, projects, decisions, Teach rules,
drafts including their saved content and send-unknown markers, templates,
signatures, agent proposals/history and local pin/snooze flags. Export
account ID, email and provider only for identity matching. Flags contain only
mail/account IDs, pin state and snooze time. Do not copy provider messages,
mail headers/bodies, received attachment caches, account credentials, OAuth
tokens, provider configuration, MCP settings, agent grants/tokens, agent
provider keys, OS-wrapped keys or profile files. Drafts, templates and agent
history can still contain private user-authored text and draft attachments.
This is not an anonymized export.

## Restore policy

Preview authenticated counts without writes. A short-lived, single-use preview
receipt binds confirmation to the encrypted file. Import repeats validation
and recalculates conflicts in one SQLite write transaction. A write failure
rolls back all imported records, preferences and flags. Never delete records.
Skip existing IDs. Merge templates by ID and signatures by account, preserving
existing values. Existing active pins/snoozes win; empty local flags can be
restored. Uncached flags wait in encrypted records for the exact mail ID to
be materialized, then apply once. No provider call is made by import.

Match account hints to exactly one connected account with the same email
(case-insensitive) and provider. Missing or ambiguous required accounts block
import. Rebind typed account IDs and account-prefixed mail references, never
free text. No account or credential is created. Mail identity can change after
provider retention, mailbox rebuilds or IMAP UID changes. Missing source mail
stays unavailable; import does not guess replacements or recover attachments
from provider caches. Calendar events and replay receipts are excluded.

Restore pending/executing agent proposals as `unknown` history so they cannot
resume. Restore no agent grant. Existing proposals remain untouched. Import
never sends, approves agent actions or changes a provider mailbox.

## Boundaries and limits

The routes inherit loopback, desktop-token, origin, CSRF, sync and update guards.
The narrow preload bridge opens/saves only bounded encrypted backup files via
native dialogs. Renderer input never selects a filesystem path. Recheck the
trusted main-frame sender after each dialog. Save through a private temporary
file, flush and rename. Keep the old destination until the rename succeeds.

A passphrase protects the file independently of the profile's OS key. JavaScript
cannot guarantee erasure of plaintext strings from memory. Native dialogs,
installed-app behavior, Windows/macOS execution and live-provider continuity
require separate acceptance. Reload after import to refresh all renderer views.
