# ADR 0105: Automatic pull-request CI on a public repository

Date: 2026-10-29
Status: Proposed
Amends: [ADR 0065](0065-github-hosted-runners.md), budget gate.

## Context

Pull-request CI became opt-in (the `ci` label) and self-disabling after 150
runs a month to protect a 3000-minute Actions allowance. The repository has
been public since it was created on 2026-10-23. GitHub does not bill
GitHub-hosted standard runners in public repositories, so the label and cap
only suppressed free checks: none of the 14 CI runs on 2026-10-28 ran, and
11 pull requests merged without hosted CI.

## Decision

- Run CI automatically on non-draft pull requests to `main` when opened,
  reopened, marked ready and pushed. Skip changes that touch only Markdown or
  `docs/`. Keep manual dispatch and cancel superseded runs.
- The budget gate reads the repository visibility on every run. Public: it
  passes without counting. Private, or visibility unknown: the 150-run monthly
  cap and the job deadlines apply. The cap counts only runs that executed jobs,
  so draft-PR runs that skip every job do not use it up. At the cap, CI jobs
  are skipped; only a repository known to be private also disables the
  workflow, and a failed disable call does not fail the gate.
- Runners, job deadlines and the release workflow are unchanged.

## Consequences

Every ready pull request that changes more than Markdown or `docs/` gets
typecheck and test results without a label, at
no Actions cost while the repository is public. Changing visibility restores
the cap without a workflow edit. CI is still not a required check; local
verification and independent review stay required.
