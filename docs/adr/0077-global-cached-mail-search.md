# ADR 0077: Global cached-mail and draft search

Date: 2026-10-25
Status: Authorized search improvement; implementation verification pending.
Supersedes: The search-entry scope in ADR 0048 and separate draft-search behavior in ADR 0052. Other navigation and draft safeguards remain in force.

## Decision

Start each new nonempty search in All cached across every connected account.
Reset inherited account, Gmail-label, read and relevance filters atomically.
Continued typing preserves deliberate narrowing. Account and mailbox choices
narrow the active query. Clear and Escape remove it while retaining the current
view and filters; the next nonempty search starts globally again. Back/Forward
restores scope and query together. Search never opens or marks mail read.

Search cached Inbox, Sent, Archive and Snoozed mail and saved local drafts.
These results represent imported history and local drafts, not complete
provider history. Show drafts separately and open them through draft recovery;
mail actions never target a draft. Draft-control focus disables mail-specific
shortcuts and traversal while Search, Privacy and native button activation
remain available. Return summaries without attachment bytes.

Reuse the shared query compiler, canonical Unicode and Latin accent handling.
Plain unquoted words tolerate one insertion, deletion, substitution or adjacent
transposition. Phrases, addresses, field terms and exclusions remain exact.
Draft sender fields use the connected account identity; recipient fields use
To/Cc; date operators use the draft's last saved time. Read/pin predicates and
mail-only filters exclude drafts.

Use one debounced local-service request. Superseded queries abort. Search runs
for profiles containing only drafts, and same-count draft edits invalidate it.
Search and opening responses must still match their query, account, identity
and version. Reject stale draft openings rather than replacing a newer compose
session. Preserve uncertain-send warnings and all existing recovery guards.

Scan encrypted records with cancellation and yields between batches. Retain
bounded search data in memory and result summaries, without writing a plaintext
index or retaining all draft bodies. Do not change storage encryption, provider
operations, authentication or mailbox state.

Account and Gmail-label controls use the existing local account labels and
privacy rules. Keep distinct account identities visible in narrow controls.
Custom names remain usable with address redaction. Unnamed private accounts use
numbered provider labels. Hidden addresses must stay out of tooltips and
accessible names.

## Verification

Require synthetic query, global navigation, draft-only/full-body search,
same-count save invalidation, cancellation, stale opening, over-256-document,
account/label privacy and keyboard checks. Run the serial full suite and strict
build through the approved bounded runner and independently review the complete
delta. Native interaction, installed-app and real-provider behavior need separate
proof. No release or installed-app replacement is part of this decision.
