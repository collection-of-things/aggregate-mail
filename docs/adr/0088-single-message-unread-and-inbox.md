# ADR 0088: Single-message unread and Move to Inbox

Date: 2026-10-27
Status: Implementation for issue #53; independent review pending.

## Decision

Extend the serialized message action route with `unread` and `inbox`.
Gmail adds UNREAD or INBOX. IMAP removes Seen for unread. Restoring archived
IMAP mail resolves exactly one matching Message-ID in a unique flagged archive
folder, checks its headers, and requires confirmed destination identifiers.
Require UIDPLUS and MOVE; Gmail over IMAP uses COPY from All Mail instead of
removing that message. Unsupported or ambiguous identities stop with an error.

Keep the local message ID across a destination UID change. Sync resolves the
new provider identity back to that local ID, preserving pins and linked work.
Marking an open message unread does not reopen or immediately read it again.

Use the existing action menu, Commands and editable shortcut registry.
Shift+U marks unread and V moves to Inbox. Existing U return-to-list and B
snooze bindings remain. Saved custom bindings win over new defaults.
Done still archives. Snooze stays local. Sent read-state changes stay disabled.

## Proof limits

Synthetic provider and mounted-renderer checks cover identity, sync and action
routing. Installed interaction and real-provider behavior need separate proof.
