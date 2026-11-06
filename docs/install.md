# Install Emc²

[Back to the README](../README.md#guides)

Choose the desktop download for your system. Source-build and macOS update details
are below.

## Install

[Releases](https://github.com/collection-of-things/emc2/releases/latest)
contains the desktop downloads. Choose the installer for your system.

| System | Download |
| --- | --- |
| Windows x64 | `.exe` setup installer |
| macOS, Apple silicon | `mac-arm64.dmg` |
| macOS, Intel | `mac-x64.dmg` |
| Linux x64 | `.AppImage` |

### Windows

Download the newest published Windows setup installer from
[Releases](https://github.com/collection-of-things/emc2/releases), named
`Emc2-<version>-win-x64.exe` in new releases. It installs for the current user and
creates Start menu and desktop shortcuts. Launch Emc² and connect accounts in
Settings.

To build it yourself instead, run `npm run package` and open the installer it
writes to `release/`. You can also run `release/win-unpacked/Emc².exe` directly;
keep its surrounding files together. The installer is unsigned, so Windows may
show an unknown-publisher or SmartScreen warning.

### macOS

Published releases include `Emc2-<version>-mac-arm64.dmg` for Apple silicon and
`Emc2-<version>-mac-x64.dmg` for Intel. For a first installation, drag Emc² into
Applications and open it there. In an automatic-update-capable build, select
**Download, install and restart**.

Emc² verifies the architecture-matching DMG against its release's
`SHA256SUMS.txt`, prepares the app, finishes pending mail and saved drafts,
replaces the running app and asks macOS to reopen it. Run the app from a writable
Applications folder, not a mounted disk image. Your mail and settings stay outside
the app.

The previous app is retained until a later update confirms the exact replacement
started successfully with the same profile. If replacement cannot finish, Finder
shows the existing app or retained recovery files. Keep both copies and stop if
macOS blocks the replacement.

Downloaded releases are ad-hoc signed and not notarized; macOS can still show
trust prompts or block opening. Checksums do not establish publisher trust. No
quarantine attribute is removed and Gatekeeper remains enabled.

This flow needs no Git, Node, npm, Xcode or Apple Developer account. It requires
built-in curl 8.4 or newer for bounded transfers. Older builds retain their
existing update behavior until replaced.

See [ADR 0080](adr/0080-macos-automatic-replacement.md).

### Build from source on macOS

For a local source installation, build Emc² on the Mac that will run it. This
route requires no Apple Developer account or signing certificate. Install
[Node.js](https://nodejs.org/en/download) 24.22.1 or a newer 24.x release with npm,
then install Apple's Command Line Tools if needed:

```sh
xcode-select --install
```

Clone the source with Git, install the locked dependencies and build the app:

```sh
git clone https://github.com/collection-of-things/emc2.git
cd emc2
npm ci
npm run package:mac:dir
```

On Apple silicon, the app is `release/mac-arm64/Emc².app`; on Intel, it is
`release/mac/Emc².app`. The command builds for the current Mac's architecture.
Check the finished signature before opening the app in Finder:

```sh
# Apple silicon; use release/mac on Intel.
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Emc².app"
open "release/mac-arm64"
```

You can drag the app to your user Applications folder for later launches. Quit an
existing copy first and keep it until the new build works. Replacing an app does
not require deleting its saved accounts or mail.

Node and build tools are needed to compile; the finished app includes its runtime.

The packaging hook signs explicitly ad hoc and skips certificate and
provisioning-profile discovery. Build and run the app locally. Copying it to
another Mac creates a separate downloaded-app trust question.

The existing GitHub macOS binaries are unnotarized, and the published 0.1.4 arm64
app has invalid signatures. Use the source route instead.

Do not remove quarantine or disable Gatekeeper to make a build launch. If
signature verification or startup fails, stop and report the error. See [the
source-installation decision](adr/0011-macos-source-installation.md).

### Package a local macOS build

For local DMG and ZIP output, `npm run package:mac` uses the same signing hook.
Local packaging never publishes downloads. Public binary distribution with a
verified publisher still requires Developer ID signing and notarization by an
authorized Apple team.

The version-tag release workflow remains unchanged.

### Close the window or quit

The macOS menu provides standard Command shortcuts for editing, closing and
quitting. The window controls sit at the top left, over the sidebar header.
Closing the window keeps the app running in the background.

On macOS, reopen it from the Dock and quit through the application menu. Windows
and Linux retain Open and Quit in the tray menu. Unsent drafts still require
confirmation.

### Linux

Download the `.AppImage` from the latest release. In your file manager, allow it
to run as a program, then open it. Keep the file where you want to launch Emc².

See [local storage](storage-and-backups.md#local-storage) for how the app protects
its mail data.
