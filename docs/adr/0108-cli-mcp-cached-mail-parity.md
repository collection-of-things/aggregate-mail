# ADR 0108: CLI and MCP cached-mail parity

Date: 2026-10-30
Status: Source contract; installed and real-account acceptance are separate.
Extends: ADR 0070. Existing grants and proposal approval remain unchanged.

## Decision

Keep search_emails substring semantics as the default. Add explicit syntax app
using the shared cached-mail query compiler from ADR 0077. It supports fields,
phrases, exclusions, read/pin state, UTC dates and the app's bounded typo matching.
Compile account aliases from permitted accounts only. Mail tools exclude saved
drafts and provider history; no provider operation or new grant is introduced.

Add pinnedOnly to list/search filters and expose pinned and snoozedUntil in
mail summaries. Existing account, view, category, unread and pin filters combine
before paging. Pins and snooze timestamps are local metadata, not provider flags.

Version 1 connection capabilities add searchSyntax (substring, app) and
mailFilters (pinnedOnly). Keep mailViews and reply contracts unchanged. The CLI
requires these guarantees before passing explicit --syntax or --pinned, so an
older app cannot silently ignore the requested narrowing. Legacy commands retain
existing arguments and output handling.

CLI plain draft proposals accept bounded To arrays and Bcc matching the app's
existing draft schema. Keep string To compatibility and strict file validation.
Attachments, HTML, send-state input, proposal approval and sending stay outside
CLI scope. Existing review saves the exact recipients into editable Drafts.

## Verification and rollback

Synthetic HTTP checks cover capability rejection, scoped app queries, invalid
syntax, pin filtering before pagination, local metadata and recipient preservation
through review without sending. No retry, credential or persistence behavior
changes. Reverting removes new options without altering existing saved data.
Installed, native and real-provider outcomes require separate proof.
