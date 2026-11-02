# ADR 0119: Sidebar collapse without a header toggle

Date: 2026-11-02
Status: Accepted for interface layout. Device acceptance remains separate.

## Decision

Remove the Hide sidebar button from the sidebar header; the header keeps the
app lockup and the platform window-control space only. Collapse and restore
run through the customizable Show / hide sidebar shortcut (default `[`) and
the same-named Commands entry. While the sidebar is hidden, the persistent
toolbar keeps a Show sidebar button at its leading edge, and the saved
`sidebar` open state is unchanged. Below 760px the button opens the
navigation drawer as before, focusing New message.

Hiding the sidebar moves focus to Show sidebar when focus would otherwise
stay inside the inert tree or be lost. The shortcut also works while focus
is inside the sidebar and while composing, as long as focus is outside the
composer's text fields, but not in Settings, matching the existing command
guards.

## Verification

Mounted App checks cover the missing header button, `[` collapse and focus
transfer, toolbar reopen, the Commands entry with its shortcut, drawer focus
below 760px and the saved choice across restarts. Stored interaction
preferences that predate the action keep their custom bindings and receive
`[` or a free Shift+letter. Device and provider behavior require separate
proof.
