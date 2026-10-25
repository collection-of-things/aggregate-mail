# ADR 0070: Explicit CLI capabilities and reviewed replies

Date: 2026-10-25
Status: Source contract. Native and real-account acceptance are separate.

## Decision

Add authenticated read-only `get_connection_status` to the existing local MCP
endpoint. It needs no AgentTool grant. The version 1 response is:

```json
{
  "version": 1,
  "capabilities": {
    "mailViews": ["inbox", "sent", "all"],
    "reply": { "mode": "proposal", "approval": "draft", "sendsMail": false }
  },
  "permissions": { "tools": [], "accountCount": 0 }
}
```

The server reads current grants for every call. Permissions contain the grant's
tool names and the count of existing permitted accounts, never account IDs,
names, addresses, tokens or credentials. A general token has no granted tools
or account access. Capability discovery grants no authority; tools recheck
current permissions at use.

CLI status preserves `connected` and advertised `tools`, adding `connection`
when the status tool exists. An advertised invalid status contract is an error.
Older apps without that tool retain the original status output.

Explicit `list/search --view inbox|sent|all` requires version 1 and the selected
view in `capabilities.mailViews` before invoking the mail tool. This avoids
older servers silently stripping an unknown view argument. Omitted view keeps
the existing behavior. Inbox excludes sent, archived and future-snoozed mail;
Sent selects sent direction; All includes the cache within the grant. Other
filters combine before pagination. Summaries include direction, defaulting old
mail without a stored value to received.

`reply <file> --confirm` requires version 1 and the exact reply fields shown
above before invoking `reply_to_email`. Its bounded, strict JSON uses the
existing reply tool schema. Tool names and descriptive text alone cannot
prove reviewed behavior. Missing or incompatible guarantees block the request.
The server's existing reply grant still applies to the source account.

As [ADR 0053](0053-agent-replies-open-as-drafts.md) specifies, a reply request
creates a proposal. Approval saves the frozen content to editable Drafts and
never sends. A separate user Send action is required. The CLI exposes no
proposal approval or generic tool caller and never retries an uncertain reply.

## Consequences and verification

No grants, credential persistence, providers, storage or review semantics change.
The status contract distinguishes app support from connection permissions.
Removing the CLI additions and status tool leaves existing saved work intact.

Synthetic real HTTP checks cover scoped status and pagination, unchanged source
mail after a reply proposal, foreign accounts and changed grants. Fixture
checks cover old apps, missing or malformed capabilities, incompatible reply
guarantees, file validation and lost reply responses without retries. Existing
server approval checks prove draft creation without a provider send call.
Installed, native and real-provider behavior require separate proof.
