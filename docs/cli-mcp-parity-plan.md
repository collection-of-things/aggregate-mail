# CLI and MCP cached-mail parity

Expose existing app search, pins and snooze metadata through the authenticated
MCP mail tools and CLI. Accept recipient arrays and Bcc in reviewed CLI draft
proposals. Preserve grants, legacy substring search and explicit proposal review.

## Implementation

1. Add synthetic CLI regression assertions and observe the missing behavior.
2. Reuse shared/mail-search.ts for opt-in search syntax app. Default to substring.
   Compile with permitted accounts only. Add pinnedOnly before paging, and return
   pinned and snoozedUntil metadata. Advertise additive searchSyntax and
   mailFilters capabilities; require them for CLI --syntax and --pinned.
3. Accept bounded recipient arrays and Bcc in existing plain draft input.
4. Update CLI docs, KB, changelog and a new ADR. Run focused CLI/MCP tests,
   full serial suite, build and isolated MCP smoke through the bounded runner.
5. Review the exact candidate independently before delivery. Use the release-skip
   PR title. Publishing and live accounts are outside scope.

Sources: ADR 0070, ADR 0077, server/mcp.ts, server/drafts.ts,
shared/mail-search.ts and scripts/emc2*.mjs.

## Limits and rollback

No new grants, provider search, sending, approval command or generic API access.
Mail searches exclude saved drafts. Existing categories cover Snoozed and Archive.
Reject unsupported capabilities instead of silently widening results. Reverting
removes the additions without changing saved data or grants. Synthetic proof
leaves installed, native and real-provider behavior unverified.
