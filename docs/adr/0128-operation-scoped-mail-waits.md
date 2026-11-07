# ADR 0128: Keep background mail waits out of foreground busy state

Date: 2026-11-07
Status: Implementation candidate; pending maintainer review.
Amends: [ADR 0127](0127-responsive-bulk-mail-and-reader-compositing.md).

## Context

The initial responsive-bulk candidate kept mail navigation available but
combined batch pending state with App's foreground busy flag. That still
blocked Drafts, compose saving, Contacts controls and settings forms. Ordinary
single-message provider operations also used that global flag.

## Decision

Keep foreground editor admission separate from background work. A bulk job
owns exact account/message identities. Single-message mutations own their
identities independently; synchronous locks prevent duplicate admission even
before React commits a render. Pending jobs survive pane replacement.

Lock conflicting actions only for the affected messages. Reading unrelated
mail retains normal automatic Mark as read. Replying, new compose, saving and
closing drafts, Contacts, settings preferences and page navigation remain
available. Local bulk selection also remains usable during a job; a second
batch waits for the current batch, and a selection containing another pending
mutation or read cannot submit yet.

Protect account disconnect/reconnect for accounts with pending mail jobs.
Provider configuration and backup controls wait for mail jobs without disabling
other settings sections. General settings saves and Sent import use their own
admission state rather than foreground editor busy state. Browser replacement
continues to wait for all pending work and uncertain writes.

After explicit Trash, Snooze or label confirmation, release the dialog/popover
before awaiting provider work. Keep failed or uncertain results in notices;
never reopen a blocking modal or retry automatically. A late Trash or Snooze
completion closes only its own selected source, preserving any different
reader opened while it waited. Forward preparation also runs in the background;
if navigation or compose context changes, retain its saved draft without
opening it over the user's new context.

Provider serialization, exact batch targets, Trash confirmation, local-only
pins/snooze, no automatic retries and send/draft recovery remain unchanged.
Foreground send/draft admission and unsaved-editor/modal guards remain.

## Verification boundary

Mounted synthetic App checks hold batch and single-message responses while
using Drafts, saving a compose draft, editing and saving signatures, opening
Contacts and reading/acting on unrelated mail. Check per-message locks,
account-disconnect guards, local selection, one batch admission, Sent import,
Forward context and delayed Trash completion. Existing partial-result,
privacy, keyboard, draft recovery and send checks remain applicable.

The previous screenshots capture the initial ADR 0127 candidate. They do not
prove this correction. Installed interaction and real-provider behavior remain
separate acceptance; no real accounts or mail are used in synthetic checks.
