# ADR 0065: GitHub-hosted runners for every workflow

Date: 2026-10-24
Status: Proposed
Amends: [ADR 0062](0062-simple-blacksmith-ci.md), runner selection;
[ADR 0064](0064-balanced-auto-release.md), minute balancing.

## Context

CI and releases split work across two 3000-minute monthly allowances: GitHub
for Linux jobs, Blacksmith for Windows, macOS and the pull-request test job.
The Blacksmith allowance is exhausted, so no Blacksmith minutes remain.

## Decision

- Run every workflow job on GitHub-hosted runners: `ubuntu-latest` for checks,
  typecheck, tests, Linux packaging and publishing; `windows-2025` for Windows;
  `macos-15` for macOS arm64; `macos-15-intel` for macOS x64.
- macOS x64 returns to native Intel hardware and keeps its x64 Node
  architecture guard.
- Raise the Windows and macOS release job deadlines to 45 minutes and the CI
  test job to 15 minutes; GitHub-hosted runners are slower than the previous
  pool.
- Platform, architecture, pin, signing, updater-integrity and artifact checks
  are unchanged.

## Consequences

GitHub bills Windows and macOS minutes at 2x and 10x the Linux rate, so each
release is more expensive than under the split. Jobs can also run slower. The
budget gate's monthly cap is unchanged.
