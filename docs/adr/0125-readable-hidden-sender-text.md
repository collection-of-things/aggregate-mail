# ADR 0125: Show sender-hidden text with readable contrast

Date: 2026-11-06
Status: Proposed; pending maintainer review.
Extends: [ADR 0102](0102-isolated-sender-styles.md), which keeps sender colors
in the isolated document. [ADR 0014](0014-themed-formatted-mail.md),
[ADR 0020](0020-explicit-images-with-hidden-text.md) and
[ADR 0121](0121-remote-image-service-fallback.md) are unchanged.

## Context

Marketing mail often starts with a "preheader": text written for the inbox
preview and hidden in the body with `display:none`, `max-height:0`,
`font-size:0` or a text color equal to the background, followed by long runs
of invisible padding such as `&zwnj;&nbsp;` or `&#847;` that keep the next
text out of the preview
([#223](https://github.com/collection-of-things/aggregate-mail/issues/223)).

The sanitizer already rejects hiding declarations (`display:none`, zero
sizes, sub-6px text), so that no sender text is concealed from the reader.
The isolated document still keeps the sender's colors (ADR 0102). The
preheader therefore renders in a color matching the background, and its
non-breaking padding wraps over several lines. The result is a tall band
that looks empty but holds text. The same mechanism can hide any text a
sender wants unread, including a link.

Two options were considered:

1. Collapse blocks the sender hid and show their text nowhere, as most mail
   clients do.
2. Keep every block visible and guarantee readable contrast.

Option 1 changes the rule that all sender text is visible. It needs a
heuristic for which blocks count as hidden. A sender could use it to put text
and links in the body that the reader never sees, while sorting, search,
assistants and MCP tools still read them. Option 2 creates no new hiding path
and keeps reading and automation consistent.

## Decision

- Keep every sender text block visible. The sanitizer's hiding rules stay as
  they are, and no new style property is admitted.
- In the isolated document, after each render, theme change and resize, the
  host checks every element with direct visible text. It composites the
  computed text color over the effective background: the nearest opaque
  sender backgrounds and, behind them, the reader surface. Text below 3:1
  contrast is marked, and a host rule gives it whichever of a fixed dark or
  light ink has the higher contrast against that background. 3:1 is the WCAG
  minimum for large text. Sender colors that already meet it, including most
  muted footers, are unchanged. Links keep their underline. Privacy-mode
  address bars and image placeholders are skipped.
- The themed (non-isolated) renderer already replaces sender colors with app
  colors and needs no check.
- When text is parsed, a run of at least three invisible padding units
  becomes one space: a zero-width non-joiner, zero-width space, combining
  grapheme joiner, word joiner, byte-order mark or soft hyphen, each with any
  spacing after it. Single occurrences are kept, so script shaping (ZWNJ),
  emoji sequences (ZWJ is never touched) and hyphenation hints stay intact.
  Removing these characters reveals nothing and hides nothing, because they
  have no visible form.

## Consequences

The preheader shows as one readable line at the top of the body instead of
an empty band. Text in the sender's background color can no longer hide
content or links. Isolated mail written for a white background stays legible
when its text falls back onto the dark reader surface. Low-contrast sender
designs below 3:1 lose their exact color. Image pixels are never recolored.
Text over an image cannot be checked, but the allowlist admits no
background images or positioning, so text cannot sit over one.

## Proof

Synthetic parser tests cover padding-run normalization and the characters
that must be kept. Mounted isolated-document tests cover the marked
elements, ink choice, skipped privacy and placeholder elements, and
re-evaluation after re-render. A headless-Chromium check on a synthetic
preheader fixture records band height and text contrast in light and dark.
It does not prove installed desktop rendering or live-provider mail.
