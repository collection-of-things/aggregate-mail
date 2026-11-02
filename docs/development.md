# Build and verify Emc²

[Back to the README](../README.md#guides)

Run source commands from the repository root. CONTRIBUTING.md is the authority for
setup, required checks, coordination and releases.

## Development

The desktop app uses Electron, React and TypeScript, with a bundled mail service
and encrypted SQLite storage. Its original interface was based on Ryan Vogel's
video.

Use Node 24.22.1 or a newer 24.x from `.nvmrc` for development:

```powershell
npm ci
npm run dev
```

`npm run dev` launches the desktop app with React Fast Refresh and live CSS
updates. Choose Quit in the macOS application menu or the Windows/Linux tray menu
to stop its development server. Restart this command after changing desktop or
backend code. UI changes that require a full reload can reset an unsent draft.
OAuth uses the same [callback registration](accounts.md#advanced-google-oauth-setup)
in development. `npm start` opens the last
production build, created with `npm run build`. `npm run package` creates the
Windows installer. `npm run check:desktop` checks production startup, database
access and API isolation without driving the UI; `npm run dev -- --check-startup`
also checks the hot reload client and development API proxy. `npm run dev:web`
retains the earlier browser development target; it is not needed to use the app.

## CI

[CI](../.github/workflows/ci.yml) runs type checks and tests on ready pull
requests to `main` and on later updates. Drafts and documentation-only changes are
skipped. Manual dispatch is also available.

Local verification remains documented in [CONTRIBUTING.md](../CONTRIBUTING.md).

[Build installers and release](../.github/workflows/release.yml) runs on eligible
pushes to `main`. It tests, builds and packages Windows x64, macOS arm64, macOS
x64 and Linux x64, then publishes after all four platforms and asset validation
pass. Windows and macOS also run isolated startup checks.

Use `[skip release]` in the merge title when a change must not publish a release.
The workflow also supports an authorized manual run on an existing stable version
tag. See [CI and releases](../CONTRIBUTING.md#ci-and-releases) for the conditions
and merge requirements.

Installer artifacts expire after one day. Manual release execution consumes runner
time and artifact storage, so dispatch requires explicit authorization. Repository
Actions enablement and required-check settings are separate from these source
files.

See [the workflow contract](KB.md#ci).

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, verification and pull
requests. AI contributors must also read the project instructions in
[AGENTS.md](../AGENTS.md).

## Releasing

Release and publish commands require explicit authorization. Follow [CI and
releases](../CONTRIBUTING.md#ci-and-releases) for the current procedure. Eligible
pushes to `main` can publish automatically; use `[skip release]` when merging must
not publish.

Manual dispatch requires an existing stable `v<major>.<minor>.<patch>` tag
matching `package.json`. A tag push alone starts no workflow.

New installer filenames use the GitHub-safe `Emc2-` prefix; the application name
stays Emc². Linux x64 installers end in `linux-x86_64.AppImage`. CI validates the
Windows/Linux manifest version, filename, size and SHA512 against the packaged
installer before upload. See [ADR 0039](adr/0039-release-update-assets.md).

To cut a Windows build locally:

```powershell
node scripts/release.mjs --patch
```

That bumps the version, packages, prints the installer's SHA-256, and uploads it
to the GitHub release when a GitHub remote exists. Delete the superseded
installers in `release/`, which is ignored by git, so nothing there reaches either
host.

The installer is unsigned, so Windows SmartScreen can warn on first run.
Compatible Windows and Linux AppImage builds offer updates through the update icon
when a newer stable release supplies verified metadata. Installation requires an
explicit action and waits for mail operations and draft saves.

On macOS, the update action verifies the matching published DMG and staged app,
drains mail and drafts, then replaces the app after normal quit and requests a
restart through macOS. It preserves quarantine and retains the previous app for
recovery. No source build or developer tools are involved.

See [the macOS replacement decision](adr/0080-macos-automatic-replacement.md).
Installing a newer version over an older one keeps your mail and settings. Native
update/restart acceptance requires separate testing.

## Verification

The following notes describe earlier checks, not passing evidence for your current
checkout or installed app. For current work, follow [required
verification](../CONTRIBUTING.md#verify) and the [installed smoke
recipe](installed-smoke.md).

The macOS Apple silicon candidate builds as a DMG and ZIP. Its packaged startup
check passed through the desktop launch path, including encrypted database access,
renderer loading, native menu roles and API isolation. A maintainer confirmed the
inbox window was visible. Intel runtime, live account operations and
downloaded-app Gatekeeper acceptance remain unverified.

Strict TypeScript and production builds pass. Tests cover sender-rule precedence,
visual classification, header validation, message-link rendering and privacy,
desktop navigation restrictions, configuration preservation, and MCP
authentication, mail reads and mocked reply operations. `node
scripts/check-mcp.mjs` checks an MCP initialize/tools-list handshake against a
separate temporary server and verifies requests without a token get 401.
Development and packaged native startup checks passed, including encrypted
database access and rejection of requests outside the desktop session.

The email-link repair was tested in a browser with synthetic mail: mouse and
keyboard activation, quoted URLs, address privacy and escaped HTML. Native Windows
and macOS browser handoff were not tested for this repair. Real account sign-in,
mailbox operations and delivery remain unverified until provider credentials are
supplied.
