# Security policy

## Supported versions

Security fixes land on `main` and ship in the next tagged release. Installers are
published as `Emc²-<version>-<os>-<arch>.<ext>`.

| Version | Supported |
| --- | --- |
| 0.1.3 and later | Yes |
| Earlier | No |

## Report a vulnerability

Report privately through GitHub's [private vulnerability
reporting](https://github.com/collection-of-things/aggregate-mail/security/advisories/new)
(Security → Advisories → Report a vulnerability). Include the version, the
platform, and the steps or proof of concept that show the problem.

Do not open a public issue for a vulnerability, and do not include mail content,
addresses, account names or credentials in a report. A reproduction against a
throwaway profile is easier to act on than one against real mail.

This is a volunteer project with no bug bounty. Expect an acknowledgement within
a few days and either a fix or an explanation of the risk in the next release.

## In scope

- The desktop app: Electron main process, preload bridge and React renderer.
- The bundled mail service and its local HTTP and MCP endpoints, including their
  authentication and CSRF handling.
- Credential and storage handling: OAuth tokens, `settings.env`,
  `key.protected`, and the encrypted mail store.
- The release installers, the update path between versions, and the one-time
  app-data migration that carries an installation across the Emc² rename.

## Out of scope

- Mail providers' own services and the mail servers they run.
- Problems that require an attacker to already hold administrator rights on the
  machine, or to hold the key that decrypts the local mail store.
- Missing hardening with no path to exploit, and reports from automated scanners
  with no reproduction.

## Threat model

This section describes how the project weighs security reports and scan
findings. It supplements the scope above and does not widen it.

### Trust boundaries

1. **Mail content → app.** Bodies, headers, sender formatting, images and links
   are attacker-controlled. They render only through the allowlist in
   `shared/mail-content.ts` and `src/mail/FormattedMail.tsx`. Remote images need
   activation for each opening ([ADR 0020](docs/adr/0020-explicit-images-with-hidden-text.md)).
2. **Local software and web pages → loopback mail service.** The bundled service
   listens on `127.0.0.1` only. `/api/*` checks the Host header, an Origin
   allowlist, the per-launch desktop token and, for mutations, a CSRF token. The
   Google OAuth routes skip the desktop token and instead rely on OAuth `state`
   bound to a cookie.
3. **Local AI clients → MCP endpoint.** Off by default, behind timing-safe bearer
   tokens or per-agent grants. Sending needs its own opt-in. Read and archive
   tools change mailbox state even with sending off. Agent replies open as
   drafts ([ADR 0053](docs/adr/0053-agent-replies-open-as-drafts.md)).
4. **Renderer → Electron main.** The renderer is sandboxed and context-isolated
   with no Node integration. The preload bridge exposes enum-validated IPC.
   Navigation stays on the app origin and permission requests are denied.
5. **Release channel → installed app.** The updater checks version,
   architecture, size and SHA512. macOS replacement also verifies the code
   signature ([ADR 0019](docs/adr/0019-app-update-prompt.md),
   [ADR 0080](docs/adr/0080-macos-automatic-replacement.md)).
6. **App → third parties.** Logo and favicon lookups use sender domains. AI
   sorting and agent providers receive mail content when the user configures
   them.

### Components

| Component | Code |
| --- | --- |
| Renderer | `src/`, `shared/mail-content.ts` |
| Desktop shell | `desktop/main.ts`, `desktop/preload.ts`, `desktop/navigation.ts`, `desktop/notifications.ts`, `desktop/migrate.ts` |
| Mail service API | `server/index.ts`, `server/mail-actions.ts`, `server/drafts.ts`, `server/workspace.ts`, `server/calendar*.ts`, `server/config.ts` |
| Providers & sync | `server/providers.ts`, `server/imap-watch.ts`, `server/gmail-watch.ts`, `server/google-*.ts`, `server/ical.ts`, `server/sorting.ts`, `server/logos.ts`, `server/avatars.ts`, `server/agent-provider.ts` |
| MCP & agents | `server/mcp.ts`, agent grants in `server/workspace.ts`, `desktop/opencode.ts`, `scripts/emc2*.mjs` |
| Storage & keys | `server/store.ts`, `server/storage-maintenance.ts`, `desktop/keychain*.ts`, key handling in `desktop/main.ts` |
| Updates & release | `desktop/updates.ts`, `desktop/mac-*.ts`, `scripts/`, `.github/workflows/` |
| Satellite clients | `android/`, `website/` |

### Attackers

All of these matter:

- A malicious email sender.
- A web page or unprivileged local process reaching the loopback service or MCP.
- Prompt injection through mail that reaches MCP clients or the AI features.
- A compromised release or update channel.
- Another non-administrator user on the same machine.

### Assets

These assets weigh equally:

- Account credentials and OAuth tokens.
- Mail content and personal data.
- The ability to send mail or change mailbox state as the user.
- `MAIL_DATA_KEY`, `MAIL_DESKTOP_TOKEN` and MCP tokens.
- `settings.env`.
- The integrity of the installed app and its updates.

### Lower priority

These areas are ranked lower:

- The experimental Android client (`android/`).
- The project website (`website/`).
- Developer and release scripts and CI workflows (`scripts/`, `.github/`).
  The installed app's own update verification (`desktop/updates.ts`,
  `desktop/mac-*.ts`) keeps full weight.
- The Linux `key.local` fallback ([ADR 0027](docs/adr/0027-linux-local-key-fallback.md)).
