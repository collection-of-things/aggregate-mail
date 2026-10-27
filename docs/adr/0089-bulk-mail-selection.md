# ADR 0089: Bounded mail selection and sequential triage

Date: 2026-10-27
Status: Implementation for issue #52; independent review pending.

Selection is separate from the opened message and uses local message ID plus
account ID. X toggles the focused row by default through the editable shortcut
registry. Shift+Up/Down and Shift-click select inclusive ranges. Existing custom
bindings retain priority. Escape clears selection. Control+A on Linux/Windows
and Command+A on macOS select the current filtered list, including unmounted
virtual rows, up to 200 in list order. Editors, dialogs and opened readers keep
their own select-all. View/filter changes clear selection; cache changes prune
missing or account-changed messages. Selection never opens or marks mail read.

POST `/api/messages/batch` accepts `items: [{id, accountId}]` and one `operation`
using the existing action shape. It accepts at most 200 unique messages and
rechecks account identity inside each serialized operation. Return one result
per item with status `done`, `failed` or `unknown`. Errors before provider work
are failed; exceptions after provider work starts are unknown. Continue other
items, retain successes and never retry or roll back automatically. Losing the
response makes every submitted item unknown. Refresh failures stay separate.

Done archives. Pins and snooze stay local. Trash captures one exact-count
confirmation, never a single-key bulk delete. Keep result details by batch
position, account and privacy-redacted subject without raw provider errors.
