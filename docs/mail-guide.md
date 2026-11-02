# Use your inbox

[Back to the README](../README.md#guides)

Find mail, reply, organise messages and use keyboard shortcuts. The sections below
cover the desktop mail workflow.

## Inbox

Custom account names can be edited in Settings, Accounts. Privacy keeps these
labels visible while hiding email addresses. Back returns from an email to the
list; immediate Forward restores that email.

The update icon opens dismissible details without a banner. All cached mail
remains reachable through the windowed list.

### Accounts and category tabs

Inbox combines all connected inboxes and splits them into Primary, Social,
Promotions, Newsletters, Transactions and Updates tabs. Gmail mail follows Gmail's
own categories; codes, security notices, support threads and replies always stay
in Primary. Numbered account controls filter the view.

Sender logos use the brand library first, with a third-party favicon service as
fallback. The first uncached favicon lookup sends the sender's domain to that
service, then caches the result on this computer. See [the security
policy](../SECURITY.md#trust-boundaries). Senders on Gmail, Outlook, iCloud and
similar hosts keep their initial, because their favicon would be the provider's
logo rather than their own.

### Density and row layout

Comfortable and Compact density each use uniform row heights. High-relevance mail
has an importance marker beside the sender. Beside the reader, rows use a card
layout.

See [interface measurements](../DESIGN.md) and [the importance-marker
decision](adr/0109-importance-marker-instead-of-row-sizing.md).

### Today and projects

Today's actions opens first, with manually confirmed Needs reply, Needs work and
Waiting lists. Each item links to its evidence and changes only through explicit
confirmation. Clients and projects groups selected conversations and decisions,
with approval before combining accounts.

### Search across accounts

Search stays visible above mail, work and Settings; `/` focuses it. A new nonempty
search opens All cached across all accounts and includes saved local drafts.
Continued typing preserves deliberate narrowing. Inbox, Snoozed, Archive, Sent and
All cached are listed in the left sidebar with account filters.

Search normalizes Unicode, Latin accents and whitespace, and reuses documents in
memory. The first text search builds the cache; no plaintext search index is
written to disk.

### Reading pane and appearance

Opened mail shows beside the list by default; Settings, Appearance can switch to
Full width, which opens mail in place of the list. The same section offers System,
Light and Dark modes, themes, accents and transparency.

### Custom themes

In Settings, Appearance, choose Create theme to customize light and dark palettes
with live preview. Advanced colors adjusts individual surfaces and text. Save
keeps the theme on this device; Cancel restores the previous appearance.

Select a custom theme to edit, duplicate, export or delete it. Import theme
accepts an Emc² JSON file or pasted JSON. Exported files include both palettes and
can be shared with another Emc² installation.

### Local and optional AI sorting

Local sorting works without an AI service. Add a Jev or OpenAI key under Settings,
Google and connections to classify new mail with Jev by TypeSafe AI (used when its
key is set) or OpenAI. Sender, subject and up to 220 characters of preview text go
to that provider, a few messages at a time so a first sync stays quick. A failed
call names the provider, then falls back to local sorting for the rest of that
account's sync.

### Teach a sorting rule

Teach previews an account-scoped sender rule and optional literal condition before
saving. Future-only is the default; applying to existing matches requires its
checkbox. The question condition checks question marks and does not infer intent.

Removing a rule reapplies local sorting.

### Archive

Archive removes mail from the Gmail inbox or moves IMAP mail to an archive folder.
It does not delete mail.

### Snooze

Snooze is local to this client. Messages return to their category after the chosen
time.

### Compose, reply and attachments

Compose and reply send plain text by default, with optional bold, italic,
underline, links, lists and quotations and a matching plain-text alternative, with
Cc, Bcc, multiple To recipients and up to 20 attachments (25 MiB total). Reply all
retains the other participants. IMAP mail gets a Sent copy. If copying fails after
delivery, the draft closes with a warning rather than encouraging a duplicate
send.

### Background sync

IMAP watches for inbox changes while the app runs. Gmail API checks its mailbox
revision every 15 seconds and syncs only when it changes, with backoff after
failures. Opening, manual sync and a five-minute background recovery sync fetch
the full inbox; large mailboxes can take time.

Gmail reuses cached bodies and checks labels.

### Formatted messages, remote images and privacy

Bodies preserve a bounded, safe subset of the sender's formatted layout, with
readable plain text when formatting is unavailable or rejected. Sender scripts,
forms, stylesheets and resource-loading CSS are excluded. Show images sits above
the body; images stay blocked until activated for that opening.

Show images also works while personal text is hidden; image descriptions and
captions stay masked. Image URLs containing detected private information remain
blocked in that mode. Image pixels may contain personal information.

Loading remote images can tell the sender you opened the email. HTTP and HTTPS
links open in your default browser on desktop. Personal-information hiding
suppresses links containing known recipient names or email addresses. Received
attachments show metadata and an explicit, cancellable download for parts up to 25
MiB; automatic imports retain their smaller limits.

Formatted composition uses a separate bounded outbound subset. Embedded images,
arbitrary CSS, tables and pasted HTML are not supported; paste inserts text.
Search covers the chosen cached view, including retained archives and explicitly
imported Sent evidence.

### Saved drafts

Drafts autosave in the encrypted store, including recipients and attachment bytes.
Closing retains the draft; discarding is separate. Unknown send outcomes remain
visible to prevent accidental duplicates.

## Search and compose tools

### Search cached mail

Start a search to find cached mail and saved local drafts across all accounts,
including Sent, Archive and Snoozed. Use words, quoted phrases and combined
filters. Plain unquoted words tolerate one typo.

For example, `from:team@example.com is:unread after:2026-10-01
-subject:newsletter` combines sender, unread state, date and exclusion. Supported
fields are `from:`, `to:`, `subject:`, `body:`, `account:`, `is:read`,
`is:unread`, `is:pinned`, `before:` and `after:`. Dates use `YYYY-MM-DD` at
midnight UTC; before excludes that day and after includes it.

Account matches the full account ID, email address or custom label. After search
starts, account, mailbox and mail filters can narrow results. Draft dates use the
last saved time.

Read/pin predicates and mail-only filters exclude drafts. Only imported mail and
local drafts are searched; this does not fetch complete provider history.

### Save a view

After searching or applying a mail filter, select **Save view** and enter a name.
Commands also offers **Save current view**. Use Commands to open, rename or delete
a saved view.

Opening restores its query, account, mailbox, Inbox tab, filters and sort. Saved
views stay in encrypted local storage and search the same cached mail and drafts.
A view whose account or label was removed cannot open. Privacy mode hides view
names and unfocused search text.

### Find a command

Select Commands beside search, or press Command+K on macOS and Control+K
elsewhere, to search app actions. Up/Down move through the command choices; Enter
runs one. In the closed mail list, Up/Down select an email without opening or
reading it. j/k remain available.

### Templates and signatures

Settings, Writing manages reusable plain-text templates and per-account
signatures. Save preferences before composing. A new message or reply gets its
account's signature. Changing From replaces an unchanged signature; edited text
stays intact.

In the composer, type in the Template field to filter templates by name and text,
move with the arrows and insert with Enter or Insert template. Inserting appends
text and only fills the subject if it is empty. These preferences use the
encrypted local store.

### Local pins

Pin email in the toolbar or context menu marks a cached message locally. Search
`is:pinned`, or choose Show pinned emails in this view in Commands, to find it.
Pins do not change the provider mailbox or mail sorting.

### Notifications and send warnings

In-app toasts report new unread arrivals after the initial import, sending and
action outcomes. Errors and delivery warnings remain until dismissed. A send
warning can mean delivery succeeded but the Sent copy failed; check the stated
outcome before sending again.

## Contacts

Open **Contacts** from the sidebar or Commands. **Saved contacts** lets you add,
edit, delete and find people. **Recent recipients** lists people you have emailed
from Emc². The sidebar account filter applies to both lists, and saved contacts
appear in recipient suggestions when composing.

To bring an existing address book, choose **Import contacts**, select the source
and destination account, then choose a UTF-8 CSV or vCard file. Review the preview
before saving. Imports add new addresses without overwriting existing contacts.

Google, Yahoo and Outlook-compatible CSV exports and Apple/iCloud vCards are
supported. No developer account or paid service is required. See [contact import
steps and limits](contacts-import.md).

## Review unsubscribe requests

When a message supplies a supported unsubscribe destination, select
**Unsubscribe** in the reader and review the destination before continuing. The
sender supplies this destination; Emc² does not authenticate it. In privacy mode,
reveal it before confirming.

Depending on the message, you can send a direct HTTPS unsubscribe request, create
a normal draft to review and send yourself, or check a link and choose **Open in
browser**. Nothing unsubscribes automatically. Unsafe destinations are refused.

The sender controls when mail stops; an accepted request is not proof that a
subscription has ended. An uncertain result is never retried automatically.

## Keyboard and mouse

New preferences use Gmail shortcuts for supported actions. Existing saved bindings
stay unchanged.

| Key | Action |
| --- | --- |
| `j` / `k` | Move selection |
| `o` or Enter | Open message |
| Escape | Go back |
| `i` / Shift+`o` | Show Inbox / next Inbox category |
| `0` to `9` | Filter by account |
| `/` | Search |
| `c` | Compose |
| `r` | Reply |
| `e` | Archive |
| `b` | Snooze |
| `s` | Pin or unpin locally |
| `a` | Reply all |
| Shift+`i` | Mark as read |
| `u` | Return from reader to list |
| `g` then `i` / `t` / `d` | Go to Inbox / Sent / Drafts |
| `g` then `a` / `s` / `b` | Go to All cached / Pinned / Snoozed |
| `m` or `t` | Teach |
| `d` | Toggle Comfortable / Compact |
| `p` | Hide email addresses and known connected-recipient names, select a hidden value to reveal it |
| `,` | Settings |
| `?` | Shortcut list |

Settings, Keyboard and mouse lets you customize each action with a single key or a
two-letter sequence. Focus a binding to record a single key, or choose Sequence
and press two letters. Conflicting keys and sequence prefixes are rejected.

Sequences must finish within 1.5 seconds and cancel on focus changes, dialogs,
editing or an invalid printable second key. Reset interaction defaults applies the
Gmail defaults. Unsupported Gmail actions, such as mute and spam, are not added.

Pin stays local to this app.

Click selects a row; double-click opens it by default. Settings, Keyboard and
mouse can enable single-click opening and turn mouse side-button navigation on or
off. Right-click opens mail actions; hover or focus reveals row actions.

Alt+Left/Right go back and forward; macOS also supports Command+[ and Command+],
including browser sessions. Tab moves focus on controls; on the page body it moves
to the next Inbox category. Editing fields and dialogs retain their own keys.

## Undo send and scheduled mail

Undo send holds outgoing mail in an encrypted local outbox for 10 seconds by
default. Change the delay in the composer's Undo delay control. Undo restores the
exact draft before submission.

Emc² must be running to send. Restarted pending mail needs review, and unknown
outcomes are never retried automatically. There is no recall after provider
acceptance.

Send later adds local scheduling while Emc² is running and online. Open Scheduled
from Commands to edit, cancel or reschedule. Restart, sleep and missed offline
schedules require review before sending.
