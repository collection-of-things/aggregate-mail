# Local storage and backups

[Back to the README](../README.md#guides)

Understand where Emc² stores data, how it protects credentials and what an
encrypted workspace backup can restore.

## Local storage

Mail, account credentials, rules and sync metadata are AES-256-GCM encrypted in
the app-data folder's `mail` directory. The app-data folder is `%APPDATA%/Emc²` on
Windows, `~/Library/Application Support/Emc²` on macOS and
`$XDG_CONFIG_HOME/Emc²` (normally `~/.config/Emc²`) on Linux. Renamed from
Aggregate Mail in `0.1.4`.

The first launch under the new name moves the `mail` directory, `settings.env` and
`Local State` from the old app-data folder into the new one, leaves the old folder
behind, and records `.renamed-to-emc2` so it never runs twice. Electron
safeStorage protects the database key using Windows DPAPI, the macOS Keychain or
an available Linux system keyring. The renderer is sandboxed and has no Node
access.

On Linux, when system encryption is unavailable, a fresh profile may store its
database key in `mail/key.local` with mode `0600` and display a persistent
weaker-protection warning. The database stays encrypted, but anyone who can read
that key can decrypt it. An existing local-key profile keeps using that fallback;
an existing `key.protected` is never replaced or bypassed. See
[the Linux fallback decision](adr/0027-linux-local-key-fallback.md).

Mail/configuration endpoints require a random desktop-session token, in addition
to origin and CSRF checks.

### Managed connection settings

Managed Google OAuth, OpenAI and Typesafe connection settings are encrypted in the
mail database with the existing installation key. Startup migrates managed entries
from `settings.env` after committed encrypted readback and preserves unrelated
settings. Launch-environment values retain precedence.

Earlier filesystem or backup copies are not securely erased by migration. Protect
your operating-system account and app-data folder. Never commit them or attach
them to issues.

Ignore rules and packaging exclusions cover local environment files, private keys
and mail databases. `.env.example` contains placeholders only. Review source
changes, commit metadata, logs, screenshots and packaged contents before sharing;
exclusions cannot detect every secret embedded in source.

### Legacy data and development profiles

The first development launch copies the earlier `.data` database using SQLite's
backup API and preserves the original files. Packaged and development desktop
builds share the app-data folder. `.data` and `.env` remain available to the
earlier browser development target.

### Service lifetime

This is a single-user desktop client. Its mail service runs while its window is
open or hidden and stops when you quit. Updates require an explicit action through
the update icon; browser hosting uses the separate profile described in the
[browser guide](browser-access.md#local-browser-access).

## Encrypted workspace backups

In the desktop app, open **Settings → About and storage → Encrypted workspace
backup**. Enter and confirm a passphrase of at least 12 characters, then choose
**Export encrypted backup** and a destination. Keep the passphrase separately; it
cannot be recovered.

The file works independently of the original computer's protected storage key.
Files are limited to 128 MiB.

### What a backup contains

Backups contain local commitments, projects, decisions, Teach rules, pins,
snoozes, drafts, templates, signatures and agent history. They exclude account
credentials, OAuth tokens, agent/MCP secrets and cached provider mail bodies.
Drafts and history can contain private text.

This does not back up your mailbox or calendar and does not replace your
provider's own recovery options.

### Preview and restore

To restore, connect the same accounts first. Enter the backup passphrase, choose
**Open backup and preview**, inspect the counts, then choose **Merge into current
profile**. Exactly one connected account must match each required email address
and provider.

Existing record IDs, templates, signatures and active pin/snooze flags win;
nothing is deleted. Pending/interrupted agent actions return as inactive, unknown
history. Import does not send mail or change your provider mailbox.

Reload afterward to refresh all views. Missing source mail can stay unavailable
after resync, especially if provider message IDs changed.

### Attachment limits

Draft attachments are carried as encrypted backup content and restored as new
account-bound encrypted uploads. Device upload IDs, received attachment caches and
queued/scheduled outbox actions are excluded. Missing or corrupt referenced bytes
stop export.

The encrypted file limit is 128 MiB, including both encoding layers; an oversized
workspace must be reduced before export.
