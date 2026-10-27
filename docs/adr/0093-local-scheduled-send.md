# ADR 0093: Local scheduled send

Date: 2026-10-27
Status: Implementation decision; native acceptance remains separate.
Extends: [ADR 0092](0092-encrypted-outbox-undo-send.md).

## Decision

Extend the encrypted outbox with an optional scheduled timestamp, without a
second delivery engine. User Send later freezes the same validated draft and
payload, then queues a future time within one year. Presets reuse local-calendar
follow-up helpers. The time is stored as an absolute timestamp; the picker and
Scheduled list show local time. A timezone change changes its display, not its
instant.

Scheduled provides inspection, Edit, Cancel schedule and Reschedule. Edit and
Cancel restore the exact draft without a provider call; Edit opens compose.
Reschedule changes only the pending timestamp and review flag. It cannot change
the frozen payload, source revision or attempt ID. Submitting and terminal
records cannot be rescheduled. Unknown Edit preserves duplicate-risk confirmation.
Immediate Undo shortcuts do not cancel scheduled messages.

The app must be running and online. Conservatively retain all pending schedules
for review after restart or sleep, including schedules whose future deadline has
not passed. Quit/update holds remain unchanged. Due mail observed offline is
held and reconnect never rearms it. OS connectivity is advisory: provider
transport failures can still be unknown. A native suspend/resume hook and the
existing timer-gap guard hold pending records before automatic dispatch.

Dispatch commits submitting before awaiting the provider. Competing dispatch,
cancel and reschedule actions reread committed state and cannot create another
provider attempt. Unknown results are never retried. Sent warnings stay sent.
The persistent Scheduled notice exposes review needs without mail content.
There is no service while the app is closed, cloud credential hosting or recall.

## Proof limits

Synthetic adapters cover due dispatch, offline/missed review, restart, active and
unknown state locks, exact snapshots and authenticated routes. Mounted checks
cover presets/custom time, Commands, reschedule, cancel and Edit recovery.
Actual OS sleep, provider availability and installed delivery need separate
acceptance.
