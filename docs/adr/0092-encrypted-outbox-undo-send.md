# ADR 0092: Encrypted local outbox and Undo send

Date: 2026-10-26
Status: Implementation decision; native acceptance remains separate.
Extends: ADR 0038 and ADR 0019. ADR 0053 remains unchanged.

## State and ownership

Only the user's Send queues a validated sendSchema payload. Store that payload
opaquely in the existing encrypted SQLite records, with a stable attempt UUID,
account, source draft ID/revision, exact draft snapshot and timestamps.
Pending means no provider attempt. A synchronous committed transition to
submitting precedes the provider call. Submitting ends in sent, failed only for
an explicit rejection before acceptance, or unknown for all ambiguous outcomes.
A Sent-copy warning is sent. There are no automatic retries or remote recall
after provider acceptance. Provider acceptance does not prove recipient delivery.

The composer's Undo delay control offers Off, 5, 10 (default), or 30 seconds. Off still uses the
same durable state machine. Undo atomically removes a pending entry and restores
its exact source snapshot, including Bcc, markup and attachments. Draft mutations
are blocked while its outbox record is active. Queueing is idempotent for the
same source revision. Legacy string-To normalization is read-only, preserving
the stored record and frozen revision. A delayed Undo response cannot replace
a newer composer; the restored source remains recoverable in Drafts.
The renderer protects in-flight queue admission. Lost
acknowledgements are reconciled through the outbox; unresolved failures retain
conservative uncertainty in the draft.

## Restart, quit and limits

Startup holds every recovered pending entry for explicit Send now, Edit or
Discard. Recovered submitting becomes unknown and is never auto-resent. Editing
unknown retains the warning; another Send requires duplicate-risk confirmation.
The app must be running to send. There is no new background service or schedule.
A deadline missed by sleep is held for review rather than sent silently.

Quit and update drain first hold pending entries for review and finish submitting
work. Ordinary quit asks before leaving pending mail saved for next startup.
Cancel keeps those entries held; it does not restart their countdown. Updates
hold pending entries rather than sending them to satisfy the drain. Source
drafts survive until a sent receipt is committed. Terminal entries remain until
explicit dismissal, Edit or Discard, with at most 100 outbox records per account;
overflow refuses new sends without eviction. Account removal refuses while a
submission is in progress and otherwise explicitly purges the local outbox.

The payload uses existing send validation and request limits. Attachment storage
is not reinterpreted here. Disk/key loss, power-loss guarantees, live delivery,
installed quit prompts and platform update handoff require separate proof.
Agents still only prepare drafts. Send later is outside this decision.
