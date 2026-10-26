# ADR 0082: Practical attachment envelope

Date: 2026-10-25
Status: Proposed. Size feedback and mixed-size import accounting are implemented;
the practical envelope and provider-part retrieval are not implemented.

Keep the current JSON and automatic import limits until larger attachments have
a bounded transport. Raising a global JSON limit would amplify base64 bytes in
every autosave, recovered draft and frozen send snapshot.

The intended transport uploads bytes to the authenticated local service and
stores them encrypted. Draft and send snapshots reference immutable stored IDs.
A practical envelope targets about 25 MiB and 20 files, with provider-specific
MIME overhead accounted for before sending. Exact provider caps, reference
ownership, account-copy behavior, orphan retention and interrupted-upload
cleanup must be settled with that implementation. Other JSON routes stay tight.

Large received files need explicit bounded retrieval of one Gmail attachment or
IMAP body part, separate from whole-message parsing. Preserve unavailable
metadata and distinguish skipped downloads from parse failures. Cancellation
must stop retrieval without replacing cached bytes or changing mailbox state.

The current partial implementation counts only successfully cached parts toward
the automatic import envelope and shows exact decoded attachment sizes. Mixed
sizes, file counts, exact selection boundaries, cancelled selections and failed
local file reads have synthetic coverage. Provider-download interruption,
practical send sizes and installed saving remain unverified.
