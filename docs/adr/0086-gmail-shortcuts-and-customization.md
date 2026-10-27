# ADR 0086: Gmail shortcuts and interaction customization

Date: 2026-10-26
Status: Owner-requested implementation; verification and independent review required.

## Decision

Use Gmail defaults for supported mail operations and go-to navigation. O opens,
S pins locally, B snoozes, A replies all, Shift+I marks read and U returns to the
list. G then I/T/D/A/S/B opens Inbox/Sent/Drafts/All cached/Pinned/Snoozed.
Go-to navigation clears account and mail filters. Unsupported Gmail actions
remain absent. Pin never changes provider stars.

Keep all actions in the existing editable shortcut registry. Users can record
single keys or two-letter sequences. Reject duplicate bindings and conflicts
between a single key and a sequence prefix. Preserve system, editing, account
filter and Teach alias reservations. Enter remains an opening alias when the
default O binding is active and Enter is not assigned to another action.

Expire sequences after 1.5 seconds. Clear pending state on focus changes,
window blur, composition, repeats and blocked interactions. An invalid second
key consumes the sequence without dispatching a mail mutation. Editors, dialogs
and compose guards retain their existing ownership. Mail operations reuse their
existing eligibility checks and never send automatically.

Keep complete older preferences, including old O and S behavior. Allocate
unused bindings to newly added actions when their defaults conflict. Reset
interaction defaults explicitly adopts Gmail defaults. Store mouse-history
on/off beside the existing opening mode; retain double-click as the default.
Help explains click, double-click, right-click, row actions and side buttons.
Recognize browser Mac modifiers without requiring the Electron bridge.

## Proof limits

Synthetic interaction and mounted App tests cover preferences, navigation,
action dispatch and guards. Strict builds prove type and bundle compatibility.
These do not establish physical mouse delivery, installed desktop behavior,
real mailbox changes or release readiness.
