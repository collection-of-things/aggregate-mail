# ADR 0061: All CI on Blacksmith, with macOS x64 under Rosetta

Date: 2026-10-24
Status: Accepted
Amends: [ADR 0058](0058-sharded-ci-on-blacksmith.md), its Intel macOS runner only.

## Context

ADR 0058 kept the macOS x64 jobs on GitHub's `macos-15-intel`, because
Blacksmith has no Intel Macs, and CodeQL default setup also used GitHub-hosted
runners. GitHub Actions minutes are limited for this organisation, and those
jobs were the only remaining users of them.

## Decision

- Run the macOS x64 test shards and installer on `blacksmith-6vcpu-macos-15`
  with x64 Node from `setup-node`, translated by Rosetta. The job installs
  Rosetta when it is missing and fails unless `process.arch` is `x64`, so an
  arm64 build cannot pass as x64. npm then installs x64 Electron and native
  modules, and the x64 app's startup check runs translated.
- Use two x64 shards; Apple silicon under Rosetta is faster than the hosted
  Intel runners were.
- Key the Electron cache by build architecture, because both macOS jobs run on
  arm64 hosts.
- Run CodeQL default setup on the `blacksmith-2vcpu-ubuntu-2404` label.

## Consequences

- No CI, release or code-scanning job uses GitHub-hosted runner minutes.
- macOS x64 coverage is Rosetta translation, not Intel hardware. Problems that
  appear only on real Intel Macs, such as CPU-specific native code, need an
  installed check on an Intel Mac.
