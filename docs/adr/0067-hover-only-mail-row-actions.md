# 0067: Hover-only mail-row actions

Date: 2026-10-25
Status: Accepted
Amends: ADR 0066, action-strip visibility and geometry only.

## Decision

Show direct row actions only while a fine pointer hovers over that row.
Selection and keyboard focus do not expose them. Do not retain an action strip
in narrow or touch layouts, and do not reserve extra virtual-row height for it.

Keep the existing message context menu and its keyboard invocation, mail
shortcuts and reader toolbar. Direct actions reuse their original handlers,
target identity and disabled guards. Preserve confirmed reads, local Pin and
Snooze, and Trash confirmation. Keep the flat theme styling.

## Verification

Check visibility rules, row and virtualizer height agreement, own-message
action identity, context-menu access and disabled behavior. Native pointer
appearance is checked separately on the packaged candidate.
