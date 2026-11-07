# Bulk-action visual evidence

Synthetic source-renderer captures for [PR #239](https://github.com/collection-of-things/emc2/pull/239).

- Before: `ab08a0d470119ccbfb7a834b0497dfe5fa8a6b20`.
- After: application source at `b82cb9b07895152204163e96e96a2b297ac9ddd8`.
- Identical CSS viewport: 1440 × 900; captures are scaled by the preview tool.
- Both render the actual App and complete stylesheet cascade with the same
  synthetic inbox, a mocked desktop bridge and synthetic API responses.
  No saved accounts, real mail or provider requests are used.
- Sequence: open Inbox, open “Review notes for Friday,” select the two Primary
  messages, submit Mark as read and hold its batch response pending.

Before, navigation and the reader are inert and dimmed. After, a status below
the toolbar says “Applying message actions… You can keep browsing mail.”
Navigation and reader content remain interactive; conflicting actions remain
disabled. DOM inspection confirms both inert ancestors are absent after the
change and present before it.

These images show the pending-state visual change. They do not establish
installed Electron behavior, provider latency, retained RAM or rendering speed.
The readable-text allocation optimization intentionally preserves appearance.


These captures predate the operation-scoped follow-up in ADR 0128. They show
the initial progress UI only, not the corrected availability of Drafts,
compose saving, unrelated mail actions or settings controls. Those workflows
are covered by the later held-response App regressions.
