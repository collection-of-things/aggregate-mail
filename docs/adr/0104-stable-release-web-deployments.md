# ADR 0104: Stable-release web deployments

Date: 2026-10-28
Status: Proposed; live activation held

## Decision

Implement issue #109 with an operator-installed Linux user-systemd updater.
Select published stable releases from the canonical repository, never main
merges, drafts, prereleases or unassociated tags. Reject automatic downgrades
and moved accepted tags. Retain a reviewed controller outside deployed source.

Build each exact revision in a separate directory with no inherited mail
credentials. Run serial tests, a strict web build and an isolated encrypted
startup probe under enforced memory/swap/time controls. Deploy only releases
that declare managed-startup support and the same profile-format generation
as the current source. A changed profile generation requires operator migration.

Stop through the existing mail drain, never force-kill an unsuccessful drain.
Switch the source pointer, verify the served public revision, and retain the
previous build. Failed startup restores compatible previous source. Interrupted
switches require explicit recovery; failed releases require explicit retry.

## Limits

A source rollback cannot undo database writes. Maintainers must increment the
profile generation before any incompatible data change. The first managed
deployment requires an operator compatibility check against the existing
profile and has no managed predecessor. Old releases without the protocol
marker cannot deploy through this controller. No automatic pruning or backups.

Keep credentials and encrypted profiles outside deployment directories, preserve
private routes and account/key identities, and leave desktop updates unchanged.
Templates do not enable services. Live activation, source merge and publication
remain held for the final owner. See [the operator guide](../web-updates.md).
