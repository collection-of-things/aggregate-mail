# ADR 0106: Publish release notes from CHANGELOG.md

Date: 2026-10-30
Status: Proposed

## Context

The release workflow published with `gh release create --generate-notes`, so
GitHub wrote each release body from pull request titles. Those titles carry
`[skip release]`, `ci:` and `Release 0.2.x` noise and are not user-facing
notes. `.github/release.yml` only grouped that generated list. CONTRIBUTING.md
asked the release owner to replace it by hand with the CHANGELOG.md section
afterwards; that step was skipped for v0.2.21, v0.2.19 and earlier releases, so
the Releases page mixed curated notes with PR-title lists.

## Decision

- The publish job writes the body with `scripts/release-notes.mjs`, which
  takes the `## <version>` section of CHANGELOG.md, and passes it to
  `gh release create --notes-file`.
- A manual stable-tag release requires its exact version section. A push
  release chooses its version while running, so it falls back to the
  Unreleased section when no version section exists.
- Missing or empty notes fail the job before the release tag is created or
  the release is published. `.github/release.yml` is removed.

## Consequences

Published notes match CHANGELOG.md without a manual edit, and a release
cannot ship with a PR-title list or empty notes. Releases published before
this change keep their existing bodies unless edited. Editing a published
body afterwards still uses `gh release edit <tag> --notes-file <file>`.
