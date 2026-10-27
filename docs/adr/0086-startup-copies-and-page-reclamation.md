# ADR 0086: Summary copies and free-page compaction

Status: Local implementation candidate, pending integration review.
Amends: ADR 0057, default explicit vacuum eligibility only.

## Decision

Keep the full initial summary snapshot and existing cursor protocol. Copy each
summary envelope and its mutable labels, references, mailbox and attachment
metadata without a general structured-clone traversal. Captured reads still
own their metadata, yield every 32 records and honor cancellation. An unchanged
valid cursor returns an empty delta without walking the complete metadata map.
Source digest validation, encrypted companions and search behavior stay intact.

After drained attachment inventory, default explicit compaction vacuums only
when SQLite reports free pages. With no free pages, there are no already-free pages to reclaim. Repacking
partially filled pages could still reduce the file size; default compaction
skips that work. Internal
callers can still force that operation with `vacuum: true`. Automatic maintenance
keeps its existing 16 MiB and 20 percent thresholds. Orphan inventory, busy-reader
checks, transaction boundaries, encryption and crash recovery stay unchanged.

There is no storage format migration. Rolling back the code reads the same
encrypted records and may resume unconditional explicit vacuuming.

## Verification

Use synthetic profiles only. Check nested-copy isolation, account-scoped body
search, complete snapshots, cancellation, cursor updates/removals and unchanged
ciphertext, key bytes, attachments and uncertain-send draft revisions. Existing
storage tests cover orphan cleanup, corruption, busy readers and transaction
failure. Run the serial bounded suite and build before integration.

`scripts/benchmark-web-startup.ts` creates and removes its own synthetic profile.
It measures 34,000 messages across four accounts by default, with retained
attachments and a saved draft. Report cold metadata initialization, warm copy,
decryption, parsing, hashing, serialization, full HTTP payload and compaction
separately. Crypto instrumentation adds overhead; these are synthetic Node
measurements, not browser paint, installed-app or power-loss guarantees.

## Separate transport candidate

`server/state-response.ts` is an unmounted response helper for integration by
its route owner. It keeps the JSON and cursor contract. Standard Accept-Encoding
negotiation honors zero quality and wildcards. Responses below 16 KiB remain
plain, including unchanged deltas. Responses vary by Accept-Encoding and retain
no-store. Serialization yields every 32 messages; stream pipelines own
backpressure, disconnect cancellation and error cleanup.

The gzip representation has two RFC 1952 members: a stored, level-zero status
envelope followed by a compressed message array with a fresh dictionary. The
existing CSRF field is never entered in the message compression dictionary.
No request cookies, authentication headers or session credentials are included.
The parent must mount the helper only after its existing auth/origin checks.
The integration diff and runtime receipts stay outside the repository. Browser
and reverse-proxy acceptance of the concatenated members remains unverified;
Node HTTP, gunzip and fetch checks are synthetic transport proof.
