# ADR 0066: Flat direct mail-row actions

Date: 2026-10-25
Status: Accepted by explicit maintainer direction.
Supersedes ADR 0043 for visual treatment. Restores direct controls after the
menu-only row layout.

## Decision

Restore direct Read, Pin, Reply, Archive, Snooze and Trash buttons on mail rows.
Use the current flat icon controls and theme tokens, without bevels or shadows.
Keep More actions for the full menu. Hover, selection and keyboard focus expose
the controls; narrow lists and devices without hover show them below each message, with horizontal
scrolling on narrow lists and matching windowing height.

Reuse the menu action definitions so row buttons retain message identity,
disabled guards, confirmed reads, local Pin and Snooze, and Trash confirmation.
Snoozed rows show Return to inbox. Direct actions do not select or open a row.
