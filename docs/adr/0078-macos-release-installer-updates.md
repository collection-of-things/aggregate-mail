# ADR 0078: Open verified macOS release installers

Date: 2026-10-25
Status: Implemented in source; independent review and delivery pending.
Supersedes: ADR 0042 for the ordinary macOS update action only.
Extends: ADR 0019. ADR 0001 and ADR 0011 signing and release boundaries remain.

## Decision

Use the canonical repository's published stable DMG for the running app's
architecture. Require its exact versioned filename, bounded size and SHA256
from the same release's SHA256SUMS.txt. Reject missing or ambiguous assets,
foreign download URLs, malformed metadata and downgrades. No source checkout,
build, package-version stamping or developer tools belong in this action.
Keep local source installation and its helper available for maintainers.

Download into a private directory under Downloads with built-in macOS curl,
HTTPS-only redirects, a size ceiling and deadline. Require curl 8.4 or newer,
whose streaming size ceiling also covers missing Content-Length. Verify the
regular nonsymlink file's size and SHA256 and explicitly add quarantine metadata.
Recheck bytes and quarantine before opening. Checksums establish release-byte
integrity, not an independent publisher identity.

Ad-hoc signing cannot supply notarized publisher trust. Therefore open only the
verified DMG through macOS. Reuse the mail/send and renderer drain and normal
native draft/unknown-send confirmation before handoff. Cancel resumes mail;
failed handoff restores the window and resumes mail. Quit after successful
DMG dispatch and retain the installer. Do not replace or automatically launch
the downloaded app. Ask users to keep a backup of their current app before
replacement, then drag Emc² to Applications, confirm replacement and reopen it.
If macOS blocks the replacement, stop. Never remove quarantine, disable Gatekeeper or alter Keychain identity.

Windows/Linux version, architecture, size, SHA512 and publisher checks remain.
No credentials, Apple Developer account, certificate, notarization, publishing
or release-workflow changes are part of this decision.

## Proof required

Synthetic tests cover asset and checksum rejection, both process architectures,
byte tampering, symlinks, cancellation, tool arguments, quarantine retention,
installer-open failure and the existing drain/restore boundaries. Run the full
serial suite, strict build and isolated desktop startup. Native DMG dispatch,
downloaded-app trust acceptance, Finder replacement and replacement startup
are separate claims. Opening a DMG does not prove an installed update.
