# CLI and MCP upgrade

## Goal

Show a connection's permissions, select cached Inbox, Sent or All mail, and request
replies through an explicit review-to-draft contract. Issue #39 owns this work on
feat/cli-mcp-upgrade, based on main at a4e67037.

## Approach

Reuse MCP transport, account/tool grants, bounded JSON input and reply proposals.
Add no dependency, credential file or service.

- Add authenticated read-only get_connection_status with a versioned feature
  contract, granted tool names and available permitted account count. Return no
  account IDs, names, addresses or credentials. Read current grants each time.
  General-token discovery grants no account access.
- Preserve CLI status connected/tools output on older apps; include current
  permission and feature information when the status tool is available.
- Add --view inbox|sent|all to list/search. Missing view preserves existing
  behavior. Inbox excludes sent, archived and currently snoozed mail; Sent uses
  cached sent direction; All includes cached mail. Apply filters before paging.
  Include direction in summaries. Explicit views require their capability;
  older apps must fail rather than silently ignore the requested view.
- Add reply <file> --confirm with strict JSON containing id, body, optional
  replyAll and cc. Require an exact proposal-to-draft contract before invoking
  reply_to_email. Approval saves an editable draft and never delivers mail.

Read [CLI behavior](cli.md), [reply approval](adr/0053-agent-replies-open-as-drafts.md)
and [work grants](adr/0047-agent-local-work-creation.md) before coding.

## Version 1 contract

`get_connection_status` returns `version: 1`, `capabilities` and `permissions`.
Capabilities include `mailViews: ["inbox", "sent", "all"]` and
`reply: { mode: "proposal", approval: "draft", sendsMail: false }`.
Permissions include `tools` (current granted names) and `accountCount`
(existing permitted accounts). The general token receives empty permissions.
CLI status includes this data under `connection` when the tool is advertised.
Explicit views and replies fail closed on missing or incompatible contracts;
ordinary commands preserve their older-app behavior. See
[ADR 0070](adr/0070-cli-mcp-capability-contract.md).

## Scope, risk and rollback

Own scripts/emc2*.mjs, server/mcp.ts and its tests, scripts/check-mcp.mjs for the
new discovery expectation, and affected CLI docs, KB, changelog and a new ADR.
Preserve auth, encrypted storage, confirmation, grants, review, old commands
and no automatic retries. Do not change desktop, providers, store, workspace,
shared search, packaging or workflows. Tests use synthetic mail only.

A lost response can follow a saved proposal. Preserve uncertainty warnings.
Removing the new commands and capabilities rolls back this upgrade without
altering saved work or permissions.

## Acceptance and delivery

1. The worker reviews this plan before source edits and reports material gaps.
2. Run focused CLI/MCP baselines, then add synthetic real-HTTP coverage of status,
   views, pagination, pending replies, unchanged source mail and approval to
   Drafts. Cover general tokens, missing capabilities, denied/revoked grants,
   foreign accounts, invalid input and uncertain responses without retries.
3. The worker runs affected tests and isolated check-mcp. The Controller then
   runs the full serial suite and npm run build on the exact candidate.
   Use Node 24.22.1 and [bounded Fleet commands](../CONTRIBUTING.md#bounded-local-verification),
   one job at a time. Exit 125 stops execution. Keep logs/hashes outside Git.
4. Update docs and check links and whitespace. Obtain independent review of the
   exact base/head/full diff. Refresh affected proof after any source change.
5. Controller owns Git delivery. Publishing is outside scope. Use the existing
   release-skip mechanism only if it prevents publication, else stop before merge.

Automated acceptance covers synthetic CLI and service behavior. Installed,
native interaction and real-account behavior remain unverified.
