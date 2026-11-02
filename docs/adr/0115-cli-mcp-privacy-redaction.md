# ADR 0115: CLI and MCP privacy redaction

Date: 2026-11-02
Status: Source contract; installed and real-account acceptance are separate.
Extends: ADR 0070 and ADR 0108. Existing grants, proposals and permissions remain unchanged.

## Decision

Add opt-in per-call output redaction to the local MCP server and CLI without changing
stored grants, proposal workflows or default output:
- Direct MCP account and mail read tools (`list_accounts`, `list_emails`, `search_emails`,
  `read_email`, `get_thread`) accept `redact: boolean` (default `false`). Omitting `redact`
  or passing `false` preserves existing output byte for byte.
- CLI read commands (`accounts`, `list`, `search`, `read`, `thread`) accept `--redact`,
  applying redaction to both default indented JSON and compact `--json` output.

Per-call opt-in was chosen over connection-level grant mutation so existing assistants,
saved `AgentGrant` records, and unredacted scripts keep working without migration while
callers can request masked output whenever terminal transcripts, pipes or saved files are
shared. `redact` is caller-requested output masking, not an access-control boundary; all
account and tool grant checks run before redaction.

Version 1 `get_connection_status` advertises `redaction: ["accounts", "mail"]` under
`capabilities`. Because older servers strip unknown tool arguments, the CLI requires
`'accounts'` in `capabilities.redaction` for `accounts --redact` and `'mail'` for
`list`, `search`, `read` and `thread --redact`, failing closed with exit code 1 and empty
stdout before calling the target tool when missing or malformed. Commands that do not
support redaction (`status`, `archive`, `mark-read`, `projects`, `commitments` and file
creation/proposal commands) reject `--redact` before connecting with exit code 2.

`shared/privacy.ts` holds the single masking engine shared by the renderer and MCP server.
Mail redaction scopes candidate names to permitted account names plus header participants in
each message's same-account cached conversation: replies quoting earlier thread participants
are masked across `list`, `search`, `read` and `thread`, while unrelated conversations on a
list or search page never pool names or trip the bounded matcher limit:
- **What is masked**:
  - Account `email` values in `list_accounts` (`"••••••••"`).
  - Sender and recipient display names and email addresses in `from`, `to`, `cc` and `replyTo`.
  - Whole-word and phrase mentions of permitted account names and header participant names
    (excluding honorifics `Mr`/`Mrs`/`Ms`/`Mx`/`Dr`), plus email addresses (including
    percent-encoded URLs), in `subject`, `preview` and `body`. When candidate names exceed
    64 unique names, 160 characters or 16 words, non-empty text fields collapse to `"••••••••"`.
  - RFC 5322 Message-IDs in `messageId`, `inReplyTo`, `references` and thread `gaps`
    (for example `"<••••••••>"`), and participant names/addresses in `coverage.error`.
- **What is not masked**:
  - Third-party names appearing only in `subject`, `preview` or `body` without appearing in
    permitted account names or the message/conversation headers.
  - Phone numbers, physical addresses, and non-TLD local addresses in free-form body text.
  - Attachment metadata and filenames (`attachments`).
  - Opaque identifiers (`id`, `accountId`, `threadId`), provider types, timestamps,
    pagination `nextOffset`, and status/sorting flags (`unread`, `pinned`, `category`,
    `relevance`, `reason`, `archived`, `snoozedUntil`, `direction`).
  - Unrelated message text and JSON control-character escaping (such as `\u001b`).

## Verification and rollback

Isolated synthetic checks in `src/privacy.test.tsx`, `server/mcp.test.ts` and
`scripts/emc2.test.mjs` cover shared name/address masking, 25-sender list scoping,
thread-wide participant and gap masking, byte-for-byte parity when `redact` is omitted or
`false`, CLI option and capability rejection, and preserved control-character escaping.
Reverting removes `--redact` and MCP `redact` without database or grant migration.
