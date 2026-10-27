# ADR 0091: Conditional Undo for local mail actions

Date: 2026-10-27
Status: Implementation contract for issue #69; independent review pending.

Single-message Pin/Unpin and Snooze/Return return an optional Undo receipt from
PATCH `/api/messages/:id`. Existing callers may ignore it. Batch operations and
provider actions do not create Undo receipts. No archive, trash or send reversal
is offered.

The receipt contains the local message ID, account ID and an opaque signed token.
The token binds the prior local value, account, local ID, remote ID, Message-ID
and the encrypted row's post-write SHA256. A process-local HMAC key authenticates
the token without retaining message history. Restart invalidates receipts.

POST `/api/messages/:id/undo` accepts the receipt's account ID and token. Inside
mail serialization and one SQLite writer transaction, verify the signature,
identities and exact encrypted row version, then restore only the affected local
field. Every rewrite changes the encrypted row version, including changes that
later return to the same value. Missing, replaced, changed or already-undone mail
is refused without a write. A later sync or body refresh may therefore invalidate
Undo conservatively. No provider is contacted. Existing authentication, origin,
CSRF, sync and update-drain guards apply.

The renderer keeps the latest receipt independently of confirmation preferences.
Each local confirmation can carry its own Undo button; Commands exposes Undo last
action even with confirmations off or no selected mail. Failed or lost Undo
responses consume that UI receipt and report the failure without retry. A refresh
failure after confirmed Undo is reported separately. No Ctrl/Cmd+Z handler is
added; editors retain their native undo.

Use synthetic server and mounted renderer regressions for exact identities,
stale/replayed/ABA receipts, unrelated-field preservation, no provider calls,
confirmations off, toast target capture and editor keyboard ownership. Require
strict build and complete bounded serial application coverage before delivery.
Native, installed and real-provider behavior remain separate proof.
