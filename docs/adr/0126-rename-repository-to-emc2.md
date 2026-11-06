# ADR 0126: Rename the canonical repository to collection-of-things/emc2

Date: 2026-11-06
Status: Owner-approved; pending maintainer review.

## Context

The product was renamed to Emc² ([ADR 0006](0006-rename-to-emc2-and-data-migration.md));
the GitHub repository `collection-of-things/aggregate-mail` is renamed to
`collection-of-things/emc2` in GitHub Settings to match, before the 0.2.31
release merges.

## Decision

The canonical repository is `collection-of-things/emc2`. Every repository link,
API endpoint, updater source and publish setting points at the new slug. The
updater sources, the macOS installer check and the macOS source-build sources
list `collection-of-things/emc2` first and keep the legacy
`screen-devs/aggregate-mail` repository as the second source. App identity
(`dev.screen.aggregate-mail`), data paths, Keychain names, migration markers,
the npm package name and the git.cafe repository are unchanged.

## Consequences

GitHub redirects the old web, API and git URLs, but release asset URLs are not
redirected: installs at 0.2.30 or older pin
`collection-of-things/aggregate-mail/releases/download/` and reject assets now
served under `/emc2/`, so those users install 0.2.31 manually from the releases
page once. Contributors with an existing clone should run
`git remote set-url origin https://github.com/collection-of-things/emc2.git`.
