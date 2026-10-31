# ADR 0111: Compact toolbar placement

Date: 2026-10-31
Status: Accepted for interface layout. Native and real-account acceptance remain separate.
Replaces: Only the Back/Forward placement rule in [ADR 0052](0052-v2-workflow-corrections.md).

## Context

The compact header keeps the current view and persistent search together.
History controls need their own position without adding another toolbar row.

## Decision

Place the current view and search at the leading edge of the main toolbar.
Filters and privacy follow search. Back and Forward follow those controls and
align to the right when horizontal space is available. The phone layout keeps
its search row and existing touch targets. Settings keeps history in its dialog.

Move the existing history controls in the DOM. Keep their callbacks, disabled
states, native navigation, draft-save guards and input ownership unchanged.
Composer keyboard traversal includes the relocated controls before entering
the composer, and Shift+Tab returns through them. This changes placement only;
all other decisions in ADR 0052 remain in force.

## Verification

Use the mounted navigation tests for forward and reverse keyboard traversal,
search and privacy while composing, draft retention, history and phone navigation.
Use synthetic renderer captures for the toolbar at wide and narrow widths.
These checks do not establish native installation or real-account behavior.
