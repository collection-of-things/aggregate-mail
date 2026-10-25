# ADR 0071: Shared footer track and compact saved drafts

Date: 2026-10-25
Status: Implementation, pending final verification.
Supersedes: ADR 0069 bottom-bar height only.

## Decision

Use one 42px minimum footer track for the sidebar, collapsed coverage and
compose actions. Keep New Message and Send at 30px. Measure only the compose
action row, add 12px clearance and apply the resulting height to its app
instance. Observe wrapped status changes without making the measured row
itself depend on that height. Disconnect and remove the override on unmount.
Recovery controls remain above the measured row.

Reserve the footer strip below original-message content. During composition,
one pointer-transparent app-wide divider joins the columns. Background panes
reserve the same strip; covered work coverage is hidden while composing.
Preserve focus, no-drag regions, native glass, privacy and save/send guards.

Use compact recipient/account, subject/preview and time columns for saved
drafts. Reflow narrow lists and retain full uncertain-send warnings. Refresh
shares the account-tabs row. Keep healthy saved-count text accessible without
a visible banner; loading, cached/unavailable and open errors remain visible.
Do not change stored drafts, account filters, identity or settings.

Verify geometry, dynamic height cleanup, account/privacy/recovery contracts,
and exact Mac candidate packaging/startup/launch before commit.

Saved draft rows offer a direct Delete draft action on pointer hover or keyboard
focus, always visible on touch. Confirm before deletion, including the existing
unknown-send warning. Use the exact account, draft ID and saved revision; remove
the row only after confirmed success. Retain failed rows with refresh guidance,
refresh the sidebar count and return focus to the next row or Refresh.
