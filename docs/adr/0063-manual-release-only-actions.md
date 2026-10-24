# ADR 0063: Keep only manual installer and release Actions

Date: 2026-10-24
Status: Proposed
Amends: [ADR 0062](0062-simple-blacksmith-ci.md), workflow triggers and automation;
[ADR 0061](0061-all-ci-on-blacksmith.md), CodeQL execution;
[ADR 0041](0041-post-build-automatic-release-tags.md), automatic releases.

## Context

Automatic CI, repeated release builds and scheduled dependency/security
workflows consume runner capacity. Keeping disabled definitions and their
historical Actions entries also obscures the one release operation still needed.

## Decision

- Delete standalone CI, automatic patch-release and CodeQL workflow files and
  Dependabot configuration. Keep dependency review and auto-merge helpers absent.
- Keep `release.yml`, with `workflow_dispatch` as its sole trigger, and one
  budgeted, opt-in `ci.yml`: it runs only on pull requests labelled `ci` and
  manual dispatch, splits work between GitHub (budget gate, typecheck) and
  Blacksmith (tests), caps each job at 8 minutes and disables itself after 150
  runs in a calendar month. Blacksmith and GitHub minutes are each capped at 3000 a month. No merge-group, push, tag-push
  or scheduled event starts Actions.
- Fold the existing shared platform jobs into this manual workflow. Preserve
  platform/architecture checks, pins, signing policy, installer integrity,
  artifact validation and publication gates. Add no replacement automation.
- Require an explicitly selected existing stable version tag matching the run
  commit and source version. Publish only after every required job succeeds.
  Never create a tag or version commit from this workflow.
- Keep local verification and independent review separate from hosted execution.
  A task owner can prohibit execution; report unrun checks without passing claims.
  Manual dispatch and publication still need explicit release authorization.
- Treat repository Actions enablement and branch/tag protections as separate
  settings. This source patch neither changes nor bypasses them. Reconcile
  obsolete required-check settings before merging, without fabricated statuses.

## Consequences and proof limits

Only pull requests labelled `ci` start Actions; ordinary pushes start nothing. Releases and
security/dependency maintenance become deliberate maintainer operations. Local
release scripts remain available without automatic invocation. Older ADRs stay
unchanged as history.

Tests, builds, actionlint and hosted/manual execution were not run for this
cleanup. Static review cannot establish runtime release correctness. Installed,
real-provider and publication proof remain outside this change.
