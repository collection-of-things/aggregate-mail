# ADR 0116: Windows portability tests in pull-request CI

Date: 2026-11-02
Status: Proposed
Amends: [ADR 0105](0105-automatic-public-pr-ci.md), runners and job deadlines.

## Context

Contributors run `npm test` on Windows, but pull-request CI ran tests only on
Linux. On Windows, 15 tests in five files failed for reasons unrelated to the
changes under review:

- A release test read `scripts/release.mjs` without normalizing the CRLF line
  endings of a Windows checkout.
- Directory symlinks need Developer Mode or administrator rights.
- The workspace quota test truncated two 7 GiB files, which NTFS allocates
  instead of keeping sparse.
- Managed web deployment uses relative POSIX symlinks, Linux systemd and
  `SIGUSR2`, none of which a Windows host provides.

Without a Windows run, pull requests could only claim that such failures
predated them.

## Decision

- Add a `Windows tests (GitHub)` job on `windows-latest`, behind the existing
  budget gate, capped at 15 minutes. It runs the five affected files:
  `desktop/mac-source-update.test.ts`, `scripts/auto-release-workflow.test.mjs`,
  `scripts/web-deploy.test.mjs`, `scripts/web-startup.test.mjs` and
  `server/browser-access.test.ts`.
- Make those tests portable without changing production behavior:
  normalize line endings, use junctions on Windows, and pass a small limit to
  `workspaceLimit()`, whose default stays at 6 GiB.
- Linux-only deployment tests skip on Windows with a stated reason. Their pure
  checks still run there, and every test still runs on Linux.
- The full suite still runs once, on Linux. Release workflow runners and tests
  are unchanged.

## Consequences

Each ready pull request reports these Windows results at no Actions cost while
the repository is public. If it becomes private, Windows minutes bill at twice
the Linux rate and count toward the same 150-run monthly cap. Other test files
may still fail on Windows; widen the job's file list as they are made
portable. CI is still not a required check.
