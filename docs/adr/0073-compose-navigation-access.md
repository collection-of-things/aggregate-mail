# ADR 0073: Compose navigation access

Date: 2026-10-25
Status: Implementation, pending final verification.
Amends: ADR 0069 compose interaction boundary only.

## Decision

Keep the composer nonmodal. Make its backdrop pointer-transparent and the
composer pointer-active. Covered mail/work content remains inert; sidebar and
exposed toolbar controls are reachable by mouse and the explicit Tab cycle.

Use the existing draft action lock, attachment drain and session flush before
history, sidebar navigation, account selection, Settings, a new message, Add
account, Commands or Filters leaves composition. Queue the requested action
only after save success, then consume it in a fresh render after closing.
A failed save retains the composer and text. Do not send or discard as part of
navigation. Forward without history retains the draft.

Allow mouse history over composer fields without intercepting native selects
or menus. Keep Electron's single native side-button source on Windows/Linux.
Retain typing, selection, dropdown arrows, formatting and native editing keys.
Nonediting compose shortcuts may reach safe app actions. Search and Privacy
remain available without closing the composer. Other dialogs stay modal.

Verify pointer hit testing, keyboard cycle/editing ownership, mouse/native
history, account and draft identity, save failure, attachment/pending-send
locks, settings persistence and native input in an isolated synthetic profile.
Require independent review, bounded checks/build and exact Mac package/startup/
launch before commit. Real mail operations and release remain outside scope.

Attachment reads finish before edit freezing; failed reads retain the composer
and error. Inert descendants are excluded from the explicit keyboard cycle.
Insert link uses a compact inline address field with Add link and Cancel link.
Enter applies the validated link without submitting email; Escape cancels only
link entry. Selected text, plain alternatives and safe URL rules are retained.

The composer From selector uses the shared themed dropdown: a 30px trigger, compact account rows, arrow/Home/End selection, Enter to confirm and Escape or Tab to dismiss. Private mode omits account addresses. Account switching retains the existing signature and saved-copy behavior.
