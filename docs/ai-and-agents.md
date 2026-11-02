# AI sorting and agents

[Back to the README](../README.md#guides)

Local sorting works without an AI key. This guide covers optional AI
classification, MCP grants and reply review.

## Jev sorting

Jev classifies mail into Important and Other and rates relevance in one call per
message. It is a decision model: it returns one option from a list you define
rather than generated prose, which is why rows show a fixed label such as "Needs a
reply".

Pick the provider under Settings, Google and connections, then save that
provider's API key beneath it. Sender rules still take priority, and Teach still
overrides any classification.

| Provider | Key from | Endpoint and model |
| --- | --- | --- |
| TypeSafe | `console.typesafe.ai` | `api.typesafe.ai/v1/systemone`, `jev-latest` |
| Vercel AI Gateway | the Vercel AI Gateway in your Vercel dashboard | `ai-gateway.vercel.sh/typesafe/v1/systemone`, `typesafe-ai/jev` |
| OpenRouter | `openrouter.ai/keys` | `openrouter.ai/api/alpha/decisions`, `typesafe/jev-1.13` |

All three serve Jev and accept the same request and answer shapes. Switching
provider changes the URL, model name and API key. Check account availability
with the provider before configuring it.

For any other endpoint that speaks this protocol, set the URL and model yourself
in the app-data folder's `settings.env` (see [local
storage](storage-and-backups.md#local-storage)):

```
TYPESAFE_API_KEY=<that endpoint's key>
TYPESAFE_ENDPOINT=https://example.com/v1/systemone
TYPESAFE_MODEL=<model id>
```

A call sends `state` (sender, subject and up to 220 characters of preview) with
typed `questions` asking for a category, a relevance level and a row label.
`server/sorting.ts` holds those questions, and a non-`http(s)` endpoint is refused
before anything is sent.

## MCP

AI clients can read synced mail and prepare reply drafts through the running app at
`http://127.0.0.1:32145/mcp`. The server uses MCP Streamable HTTP. It shares the
app's encrypted store and provider operations; no separate database process is
needed. Approving a reply saves a local draft; only your own Send action in the
composer delivers it.

1. Open Settings, AI and agents and turn on Enable MCP. It is off by default.
2. Open Agent review. Create a grant for the exact accounts and tools that client needs, then copy its credential. The legacy Settings token grants no account access.
3. Review prepared drafts, sends, read changes and archives in Agent review’s Review queue. Each proposal needs separate approval. Approving a reply saves it to Drafts and opens it for editing; agents never send, so only your own Send delivers it.

### Configure a reply provider

Each grant also offers **Bring your own key** for OpenAI-compatible providers.
Choose OpenAI (default model `gpt-4.1-mini`), DeepSeek (`deepseek-chat`), or Other
OpenAI-compatible with a custom public HTTPS base URL. Models stay editable.

Save key encrypts the key on this device; it does not test the connection. Leave
the key blank to keep it for the same endpoint. Changing the endpoint requires a
new key.

Remove key deletes the settings; revoking the agent also deletes them.

### Prepare and review a draft

To prepare a reply, the grant needs `read_email` and `propose_draft` for the
selected account. Select one received email from the searchable local cache,
optionally enter a short instruction, check the displayed provider destination,
and click Prepare draft. That click sends only the selected email's subject,
sender address, recipient and plain text (up to 24,000 characters), plus your
instruction, to that provider.

Attachments and other mail are excluded. Review the resulting pending proposal in
action history and approve it to create a local draft. Nothing is sent.

Existing approval requires MCP enabled in Settings; saving a key and preparing a
proposal do not enable MCP or sending. BYOK testing and independent review are
pending; see [ADR 0045](adr/0045-agent-review-byok.md).

### Connect an MCP client

For Claude Code:

```sh
read -rs EMC2_MCP_TOKEN   # paste the token, then press Enter; nothing is shown
claude mcp add --transport http emc2 http://127.0.0.1:32145/mcp --header "Authorization: Bearer $EMC2_MCP_TOKEN"
unset EMC2_MCP_TOKEN
```

Reading the token into a variable keeps it out of shell history; do not paste it
into the command itself. In bash and zsh, `read -rs` does not echo the token.
The expanded token is still briefly visible to other processes on the machine
while the command runs, and Claude Code saves it in its own configuration file;
keep that file private. Alternatively, use the JSON configuration below.

For JSON-config clients that support Streamable HTTP `url` and `headers` entries,
including compatible Claude Desktop/Cursor configurations:

```json
{
  "mcpServers": {
    "emc2": {
      "url": "http://127.0.0.1:32145/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Replace `<token>` with that agent's credential. Client support and configuration
locations vary by version. Codex and other MCP clients should use the same HTTP
URL and Authorization header through their HTTP-server settings.

The app must remain running.

### Set up OpenCode

For OpenCode, each grant in Agent permissions and review has a Set up OpenCode
button. On the desktop app it saves that grant's connection into your OpenCode
user config (`~/.config/opencode/opencode.json`, or an existing `opencode.jsonc`)
on this computer, editing only the `mcp.emc2` entry and keeping a private backup
beside the file. It enables MCP on the same click when MCP is off.

An existing different `emc2` connection is replaced only after you confirm.
Restart OpenCode, then run `opencode mcp list`. If the app cannot find one safe
config file to edit, or in the browser target, open Advanced: manual setup to copy
the JSON instead: if you have no user config yet, save the copied JSON as one; if
you already have one, add only the copied `mcp.emc2` entry to its existing `mcp`
object and never the whole root.

Never use a project config. The saved config contains that grant's credential, so
keep it private.

### Available tools

Tools: `list_accounts`, `list_emails`, `search_emails`, `read_email`,
`get_thread`, `propose_draft`, `reply_to_email`, `archive_email`, `mark_read`,
`list_projects`, `list_commitments`, `create_project`, and `track_commitment`.
Each requires its named grant and permitted account. Email lists return summaries
with ISO dates and numeric offset pagination (25 by default, maximum 100).

Search matches sender, address, subject and plain-text body in cached mail.
Threads link cached messages within one account using Gmail thread IDs or
Message-ID references and report missing evidence. Older cached mail may lack
Reply-To, Cc or References until fetched again.

Reply-all includes the original To/Cc addresses except your own, plus optional
extra Cc. IMAP replies save a Sent copy; a Sent-copy warning means delivery
succeeded and you must not resend.

### Credentials and approval boundaries

The listener is bound to `127.0.0.1`. Agent credentials and action history are
encrypted in the same SQLite store as mail, protected by Electron safeStorage on
desktop. Credentials are never stored in `settings.env`.

Requests with browser origins or non-local hostnames are rejected. Disabling MCP
or revoking a grant blocks its access and pending approvals. Keep copied client
configurations private because they contain credentials. A grant permits its
selected reads, proposal preparation and any explicitly selected local creation
tools.

Mail-action approval rechecks the exact payload, current grant and conversation
evidence before execution. Mail text is untrusted input and cannot authorize an
action.

### Allow local work creation

Local work creation is off by default, including for existing grants and the Reply
assistant preset. In Advanced: allowed tools, select `create_project` and/or
`track_commitment` only if the agent may save that local work immediately without
per-item approval. Select `list_projects` and `list_commitments` separately for
discovery and readback.

These tools require an explicit `accountId`. Projects need one or more
`sourceMailIds` from that account. Commitments need `sourceMailId`, `text`,
`reason`, and one open status: `needs-reply`, `needs-work`, or `waiting`; optional
fields are same-account `evidenceMailIds`, a single-account `projectId`, a
`dueDate` (YYYY-MM-DD) or legacy `dueAt` (epoch milliseconds), and `followUpAt`
(epoch milliseconds displayed in local time).

They appear in the existing Projects, Today and Calendar views. This does not
schedule an external calendar event or operating-system notification.

### Handle retries and uncertain results

Each create requires a caller-generated UUID `requestId`. Generate it once for
each intended project or deliverable, and retain it with the exact input.
Identical retries by the same agent and tool return the same unchanged record.

Different input or later user edits cause an error; a new UUID creates a distinct
item even when its text matches. After an uncertain response, read saved work and
retry only the identical request with its original UUID. Revocation, removed
accounts or unavailable sources block retries.

Work lists omit mixed-account projects, commitments linked to them, and items
whose evidence is unavailable or belongs to another account. Lists include closed
commitments for readback. These grants never complete, cancel, reopen or update
work, approve proposals, or send mail.

See [ADR 0047](adr/0047-agent-local-work-creation.md).

Approved replies use the same send path as the compose window. Sent imports remain
explicit and separate from Inbox reconciliation. An unknown send result consumes
the approval and requires a manual delivery check; it never triggers an automatic
resend.

## Command line

Use the [Emc² CLI](cli.md) from a Node 24 source checkout. Run `npm run cli --
help`. It connects to the running app through scoped MCP grants; the desktop
installer does not add a command to your PATH.
