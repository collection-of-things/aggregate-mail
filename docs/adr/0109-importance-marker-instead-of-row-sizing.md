# ADR 0109: Importance marker instead of row sizing

Date: 2026-10-30
Status: Implementation; independent review pending.

## Decision

Remove the Size rows by importance appearance switch and its relevance-based
row heights. Every mail row keeps one medium height per density: 34px wide
and 100px card rows in comfortable density, 24px and 72px in compact. The
high, low, stacked and brief layouts and their tokens are gone.

High-relevance mail (relevance 3) instead carries a small filled importance
marker before the sender text, inside the 150px sender column in the theme's
sorting-reason color, so subject alignment holds across important and ordinary
rows. The `r3` text hierarchy and the accessible-name prefix `Important: `
(after `Pinned: `, before `Unread: `) carry the meaning without geometry.

A stored legacy `sizeByImportance` key in `emc2.appearance.v1` is silently
ignored. Sorting reasons stay separate status labels; narrow cards show a
preview whenever density is comfortable.

## Proof limits

Mounted-renderer and stylesheet checks cover layouts, heights, markers and
labels with synthetic mail. Native rendering and real-account appearance need
separate proof.
