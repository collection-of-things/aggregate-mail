# ADR 0127: Browse mail during bulk actions and bound reader scratch memory

Date: 2026-11-07
Status: Implementation candidate; pending maintainer review.
Extends: [ADR 0089](0089-bulk-mail-selection.md) and
[ADR 0125](0125-readable-hidden-sender-text.md).

## Decision

Keep the bulk job's pending state, synchronous admission lock and latest result
in App, above keyed mail panes. Confirmation and snooze dialogs still block
navigation, but a submitted batch does not make the list or reader inert.
Users can open cached mail, navigate folders and search while the batch runs.
Conflicting mail actions remain disabled until the request and cache refresh
settle. Opening mail during a batch does not automatically mark it read; use
Mark as read or reopen after completion. A pending status remains visible.

Pane remounts retain the job lock and failed/unknown result details. Capture
only the submitted rows, rather than retaining the selection's full mailbox
index through the request. Match returned results by account and local message
identity. Preserve the 200-item limit, serialized provider operations, exact
Trash confirmation, partial results and no automatic retries. This does not
cancel provider work or speed up provider requests.

For readable text, cache one composited background color per visited ancestor,
instead of retaining each ancestor's complete background-layer array and
compositing it again for every text element. This makes the background cache
linear in visited elements. Keep the existing clear/read/write phases,
translucent background semantics, 3:1 contrast threshold and protected privacy
and image-placeholder controls. No sender allowlist or image-consent changes.

## Verification and limits

A held synthetic batch in `src/navigation.test.tsx` covers browsing, pane
remounts, action guards, no automatic read and completion. Existing
`src/bulk-mail.test.tsx` covers exact identities, partial/unknown results,
selection limits, confirmations and refresh failures. Readable-ink and
sender-style suites cover contrast and privacy behavior.

`scripts/benchmark-readable-ink.ts` measures seven passes over 20 synthetic
branches, each 80 levels deep, with fixed computed styles. The fixture must
pass the actual mail parser's node and depth limits. It isolates traversal
and compositing, not browser layout. Heap growth is temporary allocation, not
retained RAM or a whole-app memory measurement. Native geometry, installed
acceptance and real-provider latency remain separate checks.
