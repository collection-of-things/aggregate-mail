# ADR 0072: Conversation-scoped proposal refresh

Date: 2026-10-25
Status: Implementation, pending final verification.

## Context

Periodic workspace/proposal reads hydrated every cached mail body whenever a
proposal had a source. A synthetic 3,000-message workload decoded all bodies for
one related message, allocating substantially more memory and CPU than needed.

## Decision

Extract the existing conversation membership rule into a pure indexed helper.
Keep thread IDs and reference tokens separate, account boundaries intact and
the transitive closure equivalent to the prior rule. Preserve date/ID ordering,
coverage gaps and all fingerprint fields.

Select the union of source conversations from captured summaries synchronously.
Use the existing WAL reader to hydrate only that union, without a yield between
selection and snapshot establishment. Retain external-write invalidation and
missing-row failures. Share a snapshot and source fingerprint within each
response, without a persistent approval cache.

Synchronous approval/execution checks retain their existing full-record
contract. Missing sources stay changed. No schema, encryption, key, settings,
provider, image-consent or mail-operation changes are included.

Verify equivalent membership, cross-account/token isolation, missing sources,
body changes, coherent concurrent-write snapshots and external invalidation.
Compare matched synthetic HTTP CPU/time/memory, run the bounded suite/build,
independent review and exact Mac package/startup/launch before commit. Native
long-running CPU/RAM and every reported spike require separate acceptance.
