# Rich-text compose plan

## Goal and approach

Add optional formatting to the existing composer without changing plain-text
messages or settings. Keep one plain-text alternative and a bounded, feature-owned
outbound HTML representation. Use existing htmlparser2 and browser editing
primitives, with no new dependency. MCP reply remains plain text.

The initial supported subset is bold, italic, underline, links, bullet/numbered
lists and quotations. Tables, embedded images, arbitrary CSS and pasted HTML
are excluded from this slice. Paste inserts plain text. A user who never applies
formatting keeps the existing textarea and sends only text/plain.

## Implementation

1. Add a shared outbound parser/serializer with explicit tags, safe link schemes,
   no resource-loading attributes or styles, and byte/node/depth limits. Derive
   readable plain text including link destinations, lists and quotations.
2. Add optional HTML to draft and send contracts, serialization, equality,
   revision/recovery and calendar snapshot validation. Validate text/HTML
   consistency at the trusted boundary. Existing encrypted records need no
   migration. Preserve unknown-send and post-delivery Sent-copy behavior.
3. Add a compact formatting toolbar and optional contenteditable surface. Keep
   selection and focus, plain-text paste, keyboard shortcuts and privacy blur.
   The shared serializer bounds and cleans every edit before saving. Preserve
   existing templates and per-account signature changes without dropping prior
   formatting. Leave account/signature settings unchanged.
4. Pass both alternatives to each MailComposer path and append the exact SMTP
   raw message to Sent. Do not widen MCP tools or inbound mail rendering.
5. Cover unsafe markup, text fallback, default plain messages, MIME ordering,
   draft save/restart/recovery and send uncertainty with synthetic tests. Run
   bounded serial tests and strict build. Independently review the exact diff,
   inspect synthetic renderer captures and rebuild/launch the Mac candidate
   before commit. No live delivery is part of verification.

## Files and integration

Shared types and a new outbound markup module; server drafts/providers;
composer editor/preferences/session and their tests; shared styles, README,
DESIGN, KB, CHANGELOG and a numbered ADR. Parent branch is
fix/app-responsiveness-compose at 41fff27; feature branch is
feat/rich-text-compose. One delivery owner and writer, @pekth, for issue #7.

## Risks and rollback

Native editing selection, undo, paste and privacy need explicit checks. HTML
must never execute or load resources in the editor or recipients. Client
rendering and real-provider delivery remain unverified. Rollback leaves old
plain drafts readable; formatted records retain their authoritative plain text.
No profile reset, schema migration, key replacement or release is authorized.

## Compact footer correction

Keep draft, save status and Send remain in one grid row at narrow reply widths.
The repeated sender/format line is removed from the footer. Sender identity
remains in From and the formatting toolbar identifies supported actions.
