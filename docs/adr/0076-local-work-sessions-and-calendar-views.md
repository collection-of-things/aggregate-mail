# ADR 0076: Local work sessions and calendar views

Date: 2026-10-25
Status: Local source candidate. Independent review, full-suite reconciliation and
installed/native acceptance remain separate gates.
Extends: [ADR 0043](0043-built-in-follow-up-calendar.md) and
[ADR 0054](0054-emc2-calendar-events.md).

## Decision

Use existing encrypted calendar events for explicit work sessions linked to a
confirmed commitment. Optional metadata holds the immutable parent ID, Busy
Boolean, planned/finished/removed status and canonical creation-input digest.
Account, source and bounded title snapshot derive from the parent at creation.
There is no store migration, new record kind or dependency.

A task can have multiple sessions. Each planned session can move, finish or be
removed independently. Finish retains history at its saved time. Removal retains
an encrypted replay tombstone and hides it from normal lists and Calendar.
Removed is terminal even when a caller submits its current revision. Task dates,
follow-up, status and history, and email state, remain independent.

Scheduling requires current parent and session revisions, an open parent, its
connected account and same-account cached source. Bindings cannot be changed or
unlinked. Parent closure or loss/change of source/account blocks scheduling and
moves. Local finish/removal remain available with the saved session revision.

Busy saves check current local busy periods in the transaction. Touching edges
are permitted and edits exclude only themselves. Free explicitly allows overlap.
Only planned Busy sessions block offers; finished/removed/Free do not. Legacy
events retain their busy meaning. Malformed session metadata fails closed.
Session checks exclude Google. Offered-time booking retains its complete fresh
checks for the sources included in that offer.

Sessions are timed, bounded to 14 days and local only. The form defaults to 60
minutes and rejects nonexistent and ambiguous device-local times, including
half-hour DST transitions. The API accepts explicit offset ISO instants and a
validated IANA zone. Ordinary event mutation, invitation preparation and Google
creation reject session IDs. Session controls expose no attendee, account,
source-unlink, notification or sending action.

Create carries one UUID and a canonical initial-input digest. Exact replay
returns the saved current state, including later edits or a removed tombstone.
Changed payloads and ordinary-event collisions conflict. Unknown outcomes freeze
input and revision. Recovery reads the same ID and requires explicit review;
it never retries a mutation. An acknowledged save with failed refresh remains
saved and cannot resubmit. Workbench retains the controller through detail/source
changes. A genuine remount first reads saved sessions without creating replacements.
No private session state is persisted in localStorage.

## Calendar compatibility

Month remains the default alongside Day, Monday-based Week and Agenda. Timed
spans use elapsed instants and local UTC-offset labels; date-only deadlines and
all-day events stay separate from point reminders. Cross-month views read the
existing exact month caches serially. Source/account/calendar identity, stale or
conflicting coverage and explicit per-month Google Sync remain visible. Sessions
reuse these views and existing privacy, focus and narrow-pane behavior.

Offered-time preferences retain compact disclosures, visible busy coverage,
original grouped slot indexes and complete endpoint dates/offsets. Optional
recipient-zone display changes no instants or reply identity. Session work does
not replace those existing view/offer changes.

## Acceptance limits

Use synthetic HTTP and mounted App checks for revisions, conflicts, lifecycle,
fresh offer booking, immutable bindings, source/account loss, encrypted reopen,
malformed metadata, response loss, GET recovery, remount, privacy and keyboard
controls. Compare exact parent/mail state before and after session operations.
Distinguish explicit App startup sync and source opening from session actions;
require zero non-session writes during session controls.

Run affected calendar, offer and invitation guards and the strict build under
the repository's bounded serial runner. Source and synthetic results do not prove
provider delivery, native/installed behavior, viewport geometry, theme/text-scale
rendering or physical keyboard focus. Full-suite acceptance remains a separate gate. No release or
repository delivery authority follows from this record.
