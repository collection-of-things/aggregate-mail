# ADR 0102: Preserve supported sender styles in an isolated document

Date: 2026-10-28
Status: Implementation decision; independent review and native acceptance pending.
Supersedes: [ADR 0014](0014-themed-formatted-mail.md) color normalization for
mail with supported stylesheets. Its themed fallback remains.
Extends: [ADR 0013](0013-safe-formatted-mail-and-personal-privacy.md) and
[ADR 0020](0020-explicit-images-with-hidden-text.md).

## Decision

Keep supported sender colors and class-based layout inside a blank sandboxed
iframe. Grant only same-origin access so the host can render the sanitized React
tree and install a resource-free stylesheet. Enable no document scripts, forms,
popups or top navigation. Never inject sender HTML, load remote CSS/fonts or
loosen request CSP. Unsupported style APIs retain the cached/themed fallback.

Bound style text, rule count, selectors, declarations and media nesting. Use
opaque identifiers for sender class/ID names. Reject private attribute selectors,
pseudo selectors, active properties, resource functions, positioning and hidden
text. Preserve the existing redaction, link validation and image consent paths.
Host privacy controls retain protected styling. Link activation uses the host's
existing external-window policy.

Replace the document on message, HTML, privacy or consent changes. Bind embedded
image results to the exact message and attachment inputs. Remove observers and
listeners on cleanup. Forward reader shortcuts after document controls, keeping
Tab, Enter and Space local for navigation, links and privacy controls.

## Proof

Require synthetic parser rejection and mounted privacy/consent/source-binding,
keyboard and cleanup checks, then the combined serial suite and strict build.
DOM tests prove document structure and lifecycle, not native paint, physical
keyboard input, live-provider behavior or installed acceptance.
