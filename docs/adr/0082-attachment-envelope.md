# ADR 0082: Attachment envelope

Date: 2026-10-26
Status: Authorized implementation

## Decision

Allow 20 outgoing files, each at most 25 MiB, with 25 MiB decoded bytes in
total. Keep automatic received imports at 10 files, 512 KiB each and 1 MiB
total. Keep raw message parsing at 8 MiB. Large received parts require an
explicit download, at most 25 MiB and 60 seconds, with cancellation.

Upload one raw file at a time through the authenticated local API. Store
immutable bytes in independently authenticated encrypted chunks in SQLite.
Drafts and sendSchema carry account-bound IDs and exact sizes. Existing inline
base64 drafts remain readable within their original limits. Keep Express JSON
at 2 MB. Stream attachment and MIME bytes; do not collect a whole envelope in
memory. Reject concurrent byte-heavy work. Cap stored uploads at 256 MiB per account,
1 GiB globally and 2,000 entries, reserving the request maximum on admission.

Gmail API accepts raw MIME up to 35 MiB (base64url transport adds another third).
Base64 MIME lines add about 37 percent, so 25 MiB of files can approach that
cap; measure encoded MIME before submission. SMTP servers commonly cap encoded
messages at 25 MB, 35 MB or 50 MB. Use a conservative 35 MiB local encoded cap
and enforce any advertised positive SMTP SIZE on the submission connection
before MAIL/DATA. Selection shows decoded sizes; provider rejection preserves
the draft and never causes an automatic retry.

Uploads are immutable and belong to one account. Account copies cannot silently
reuse another account's IDs. Cleanup traces IDs in encrypted records, including
opaque outbox send payloads, drafts and durable send holds. Unknown/in-flight
sends retain holds until explicitly resolved. Successful sends release holds;
remaining draft/outbox references still protect bytes. Discard and maintenance
remove only unreferenced uploads after an upload grace period. Interrupted
uploads and cancelled downloads remove partial chunks immediately. Received
retrieval verifies account, message identity and provider part identity before
fetching and again before caching. IMAP uses UID plus UIDVALIDITY and PEEK;
retrieval never sets Seen or changes mailbox state.

For streamed SMTP messages, retain provider-managed Gmail Sent copies. Other
SMTP providers receive a successful-delivery warning because ImapFlow APPEND
requires a complete Buffer. Do not buffer the whole envelope or retry delivery
to make an optional Sent copy. Small legacy sends retain existing copy behavior.

## Verification boundary

Use synthetic stores and provider transports. Native save dialogs, installed UI
and real Gmail/SMTP/IMAP acceptance require separate authorized proof.
