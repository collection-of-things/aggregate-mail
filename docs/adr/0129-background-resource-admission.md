# ADR 0129: Declare resources for background action admission

Date: 2026-11-07
Status: Implementation candidate; pending maintainer review.
Amends: [ADR 0128](0128-operation-scoped-mail-waits.md).

## Context

Separating generic requests from composer admission still left one shared
pending flag for all settings saves and Sent imports. A slow import could
disable unrelated signature editing and mail actions on another account.
The account connection dialog also refused dismissal during provider checks.

## Decision

Require a typed resource scope for App's general background action helper.
The App-owned registry admits one action per resource synchronously, before
React renders. Jobs and their locks survive settings section replacement.
Its aggregate pending value is for progress and replacement safety only;
navigation, search and independent forms never consume it as a busy flag.

Account actions, including Sent import, claim that account. Settings actions
claim their section. Provider configuration conflicts with account, connection
and sorting work, while independent preferences remain usable. Backup conflicts
with every registered write. Configuration and backup still wait for pending
mail jobs; message actions consult the registry for their account conflicts.
The existing exact-message and batch controllers remain separate.

An explicit Close or Escape can dismiss a submitted connection check. App owns
the check after the dialog unmounts, suppresses duplicate submissions, reports
late errors in notices and refreshes successful connections. A dialog generation
prevents a late result from dismissing a newly opened form, including one for
the same provider. Closing does not cancel the admitted request or retry it.
Credentials remain in the submitted request only; no client disk cache is added.

Rename the foreground flag to `composeBusy`: draft/send admission alone owns
it. Preserve draft uncertainty, duplicate-send protection, attachment admission,
unsaved edits and work/calendar editor recovery guards. Those editors retain
input needed to reconcile writes; this change does not discard their state to
allow dismissal. No persistent background queue or worker is introduced.

## Verification boundary

Reproduce the held Sent import disabling signature editing. Mounted App checks
then hold imports, logo fetches and successful/failed connection checks while
using independent settings, cached mail, search and draft saving. Verify locks
survive section changes, connection results preserve replacement dialogs, and
unknown failures never retry themselves. Registry tests cover synchronous
duplicate rejection, independent resource completion and conflict symmetry.

Full synthetic checks and strict build are separate from installed interaction,
real-provider latency and whole-app memory measurements. Earlier screenshots
remain historical evidence for the initial bulk candidate, not this revision.
