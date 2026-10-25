# ADR 0062: Simple Blacksmith CI

Date: 2026-10-24
Status: Accepted
Amends: [ADR 0058](0058-sharded-ci-on-blacksmith.md), test sharding and reuse;
[ADR 0059](0059-merge-queue-and-reviews.md), release test reuse;
and [ADR 0061](0061-all-ci-on-blacksmith.md), shard count and CodeQL scheduling.

## Context

Parallel shards repeat runner setup. Pull request, merge queue and release
runs consume paid runner minutes. Maintaining sharding weights and a
check-result reuse planner adds complexity.

## Decision

- Use one Checks job for actionlint and commit email privacy.
- Pull requests run the full serial test suite and build on Linux. The other
  three required platform jobs report skipped for that event.
- The merge queue tests and packages all four platforms before landing a
  commit. Manual and release runs also test and package all four platforms.
- Use one job per platform with a shared YAML step list. Remove sharding,
  timing weights and check-result reuse. Keep download caching.
- Run all jobs on Blacksmith. Keep macOS x64 on Rosetta, with an architecture
  guard and a shell that preserves setup-node's PATH.
- Run CodeQL weekly or manually, and group dependency updates monthly.
  Maintainers review and queue dependency pull requests; remove dedicated
  dependency review and auto-merge workflows.
- Preserve commit privacy checks, release asset checks and protected tags.

## Consequences

Pull request CI is cheaper and the workflow is smaller. Windows/macOS failures
can first appear in the merge queue. Serial tests can take longer than shards.
Release runs repeat tests deliberately. This decision changes no repository
protection settings or release eligibility rules.
