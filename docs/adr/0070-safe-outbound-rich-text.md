# ADR 0070: Optional safe outbound rich text

Date: 2026-10-25
Status: Implementation for issue #7, pending final verification.
Amends: ADR 0038 for the optional draft HTML field only.

## Decision

Keep unformatted composition as text/plain. A formatting action enables a
small contenteditable surface for bold, italic, underline, links, lists and
quotations. Use the existing Electron editing commands after checking support,
so edits retain the native undo buffer. Paste inserts plain text; drag and drop
never inserts HTML. No new dependency or Settings mode is added.

Use a feature-owned outbound parser/serializer, separate from received-mail
rendering. Emit only canonical semantic tags and validated HTTP(S)/mailto
links, without scripts, images, resources, styles or arbitrary attributes.
Bound input size, parser events and nesting. Derive matching plain text with
link destinations and readable list/quote markers. Require exact canonical
HTML and text at the server boundary, preserving attempted-snapshot identity
for revision recovery instead of silently changing stored content.

Persist optional HTML in existing encrypted drafts and carry it through copies,
account changes, save/retry and unknown-send recovery. Preserve preceding
formatting during template/signature suffix changes; a partially replaced
structural node may become plain text. No storage migration or settings reset.

Send both alternatives through the existing Gmail and SMTP MailComposer paths.
Retain plain text first, exact SMTP Sent bytes, Gmail's no-manual-append rules
and post-delivery Sent-copy warnings. Calendar sends compare both alternatives
against the reviewed saved draft. MCP and agent proposals remain plain text.

Tables, embedded images, pasted formatting and arbitrary CSS are excluded from
this slice. Live delivery and recipient-client rendering need separate proof.
The candidate must pass synthetic contracts, full tests, strict build,
independent review and Mac package/startup/launch before commit.


## Implementation references

[MDN documents the editing-command undo behavior and deprecation](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand).
This use is scoped to the existing Electron renderer, checked for support,
and leaves plain-text editing available when formatting is unavailable.
[Nodemailer documents text and HTML alternatives](https://nodemailer.com/message).
Provider tests inspect the generated MIME rather than inferring delivery.
