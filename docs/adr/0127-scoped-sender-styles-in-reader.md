# ADR 0127: Render styled mail in the reader with scoped sender styles

Date: 2026-11-07
Status: Proposed; pending maintainer review.
Supersedes: the separate-document part of [ADR 0102](0102-isolated-sender-styles.md).
Its stylesheet grammar, bounds and opaque identifiers remain.
Keeps: [ADR 0013](0013-safe-formatted-mail-and-personal-privacy.md),
[ADR 0020](0020-explicit-images-with-hidden-text.md) and
[ADR 0125](0125-readable-hidden-sender-text.md).

## Context

ADR 0102 put mail with sender style rules in a blank sandboxed iframe sized to
its content. The iframe is a second document inside the reader's scroller,
which caused two reported faults:

- The frame's document does not inherit the app's hidden-scrollbar rule. A
  hidden image's placeholder kept its full declared width inside table cells,
  where a loaded image shrinks, so newsletters overflowed the frame sideways
  and showed a horizontal scrollbar until Show images was used.
- Wheel input over the mail sometimes stayed with the frame's scrollers instead
  of reaching the reader, so the reader only scrolled with the pointer outside
  the mail.

The iframe existed only to keep sender selectors such as `p` or `table` from
restyling the app. Electron's Chromium supports `@scope` and container
queries, which provide that confinement within one document.

## Decision

Render all formatted mail in the reader document. Install sender rules as one
constructable stylesheet per message, wrapped in
`@scope ([data-mail-scope="<id>"]) to (.address)`, and remove it when the
message unmounts. Request CSP is unchanged: no `<style>` element is inserted.

- Anchor every sender selector at `:scope`, which stands in for the sender's
  html and body. Anchoring confines the rules and gives them enough
  specificity to override the reader's own element defaults, as they did in
  the separate document. Selectors with a non-leading html/body, or a sibling
  of it, are dropped.
- Address controls are the scope's lower boundary, so no sender rule can
  restyle or reveal a hidden address.
- Reader controls for links, quotes, code ink, prose measure and readable ink
  follow the sender rules in the same scope.
- Rewrite screen-width `@media` queries as `@container` queries against a
  `formatted-mail-frame` wrapper. The sender wrote them for the width of the
  message, not the window.
- Keep readable-ink re-evaluation (ADR 0125) on render, resize and ancestor
  theme changes. Ink layers stop at the message root, and the host surface
  below it is composited separately.
- Size a blocked-image placeholder as `min(width, 100%)` with the declared
  aspect ratio, so it narrows exactly as its image would.
- Zoom mail wider than the reader down to fit, with a 0.5 floor, as desktop
  mail clients do. Content still too wide at the floor scrolls sideways inside
  the message, without a visible bar.

Engines without constructable stylesheets keep the themed fallback text, as
before.

## Consequences

The reader is the only vertical scroller around a message, so wheel input and
the hidden-scrollbar rule behave the same over mail as elsewhere. Keyboard
forwarding, height measurement and theme copying for the frame are removed.
Sender CSS now shares the page with app CSS, and `@scope` is what keeps them
apart, so the selector grammar and anchoring remain security-relevant.

## Proof

Synthetic tests check selector anchoring, container conversion, sheet
install and removal, the address boundary, code ink, privacy, consent,
readable ink, placeholder shape and the fit calculation. A standalone
Electron 44 harness rendered the real component: sender rules applied only
inside the message, the container query responded to the message width,
hidden and shown images gave equal layout height, a 700px block zoomed to fit
a 472px message, and no element inside the mail could scroll vertically.
Physical wheel input, installed builds and real accounts are separate proof.
