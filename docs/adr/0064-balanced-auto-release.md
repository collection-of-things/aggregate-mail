# ADR 0064: Restore automatic patch releases on balanced runners

Date: 2026-10-24
Status: Proposed
Amends: [ADR 0063](0063-manual-release-only-actions.md), release triggers.

## Context

ADR 0063 removed the automatic patch-release lane. It is needed again, but
GitHub-hosted and Blacksmith minutes are each capped at 3000 a month.

## Decision

- `release.yml` runs on pushes to `main` as well as manual dispatch on an
  existing stable tag. Pushes that only touch Markdown, `docs/`, `website/`,
  `.impeccable/` or issue templates, commits containing `[skip release]` and
  `Release ` commits start no release.
- A push builds the next unused patch version (`scripts/release-version.mjs`),
  creates its tag through the API only after all four installer jobs pass, then
  publishes. An existing tag must point at the same commit.
- One release runs at a time and an in-progress publish is never cancelled; a
  newer push replaces any queued run.
- Minutes are balanced: checks, Linux packaging and publishing run on GitHub's
  `ubuntu-latest` (1x rate); Windows and both macOS jobs stay on Blacksmith,
  where GitHub would bill 2x and 10x. `npm test` runs once, on Linux; other
  platforms build, startup-check and package.
- Platform, architecture, pin, signing, updater-integrity and artifact checks
  are unchanged.

## Consequences

Every eligible merge to `main` costs one release build. Use `[skip release]`
for changes that should not ship.
