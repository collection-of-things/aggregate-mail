# ADR 0103: Update an installed app from an identical read-only launch copy

Date: 2026-10-27
Status: Implementation for issue #110; native acceptance recorded separately.
Extends: ADR 0080. Quarantine, Gatekeeper, signing and recovery rules remain.

macOS can launch a quarantined app from a read-only mirror. Deriving the
replacement destination from its executable then rejects an otherwise writable
installation. Moving an app through a scripted Finder operation does not prove
that a subsequent launch will use its writable location.

Keep the existing writable destination when available. Otherwise, inspect only
`Emc².app` in the system and current user's Applications folders. Require
canonical bundle and parent directories, replacement permissions, free space
and a complete bundle digest equal to the actual running app. Exactly one
eligible match is required. Never guess an original path, use private
translocation APIs, remove quarantine or change Gatekeeper.

Stage beside the selected installation and keep the actual running Electron
executable as the helper runtime. Bind the private helper request to the old
installation digest as well as the verified new bundle digest. Verify the
running helper bundle and installed target before readiness, then recheck the
installed target after parent exit immediately before moving it to the backup.
A changed target stops replacement and retains recovery material.

Release selection, version and architecture checks, download integrity,
mail/draft drain, close cancellation, retained previous apps and normal
LaunchServices restart remain unchanged. Windows/Linux and source-build update
routes remain unchanged. Synthetic tests cover target selection, ambiguous or
changed counterparts, canonical paths, handoff binding and target changes after
readiness. Native startup and installed update acceptance remain separate proof.
