# ADR 0080: Replace verified macOS updates without manual dragging

Date: 2026-10-26
Status: Implementation decision for the requested automatic replacement; native acceptance recorded separately.
Supersedes: ADR 0078's manual-only replacement and restart.
Extends: ADR 0019. Signing, quarantine, Keychain and release boundaries remain.

## Decision

Preserve canonical release selection, bounded HTTPS download and exact DMG
size/SHA256 checks. Mount only the verified image, read-only and without Finder.
Copy its sole expected app into a private workspace beside the canonical writable
installed app. Transfer image quarantine explicitly to the staged app; copying
with extended attributes alone does not propagate image quarantine. Verify bundle
identifier/version/executable, thin Mach-O architecture, strict deep
signature and complete bundle digest. Detach the owned mount with an independent
bounded cleanup signal and never remove a still-mounted workspace recursively.
No source build, lipo, Git, Node installation, npm or Xcode belongs in this path.

After mail/send and renderer drain and the existing draft/unknown-send native
close guard, recheck the image and staged bundle. Run a dedicated bundled helper
with the current Electron executable in RunAsNode mode. Keep the executable entry
separate from the pure library imported by the normal app. Use private IPC with
ready/commit/armed agreement. Validate parent identity, canonical same-parent
workspace, owner/mode, installed destination, candidate, digest, quarantine and
explicit temporary-profile binding. The helper waits for original process exit
before changing either app.

Move the installed app to the workspace as `previous.app`, promote the verified
stage by same-volume rename, recheck the promoted bundle and call normal
LaunchServices `open -n`. The previous app remains available. If failure is known
before launch dispatch, restore the original app and show it in Finder with a
bounded native recovery message. After dispatch, the new app may have opened its
data: retain both copies and show recovery files on failed or uncertain dispatch,
without automatic downgrade. Record a small local result receipt; never call a
successful launcher exit installed-startup proof.

On a later update, the running app has already reached healthy backend startup.
It may retire one of its prior successful workspaces only when the receipt kind,
format, successful dispatch state, canonical installed path, current version,
architecture, complete current bundle digest and exact explicit-profile binding
match. Failed, uncertain, malformed or unmatched workspaces stay intact and block
new staging. This bounds successful backup retention without treating dispatch
alone as startup proof or deleting uncertain recovery material.

## Trust and proof

Keep ad-hoc signing and quarantine. Do not disable Gatekeeper, clear attributes,
require or install a developer certificate, or bypass a rejected app. Normal
macOS trust prompts may remain. An `spctl` rejection is recorded separately from
actual LaunchServices acceptance; it is not proof that launch was attempted.
Source installation, Windows/Linux updating, Keychain identity and encrypted
profile contents remain unchanged. No release workflow changes belong here.

Synthetic tests cover architecture and byte/quarantine rejection, private helper
requests, emitted-entry isolation, cancellation cleanup, helper readiness,
pre-dispatch rollback, retained recovery after failed dispatch and bounded
backup cleanup. Full tests, strict build and isolated desktop startup are required.
Native helper replacement, actual restart, installed data continuity, Intel
runtime and downloaded-app trust acceptance remain separate proof obligations.
