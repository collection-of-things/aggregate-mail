# ADR 0058: Sharded CI on Blacksmith with reused test results

Date: 2026-10-24
Status: Accepted
Extends: [ADR 0002](0002-cross-platform-ci.md) and
[ADR 0055](0055-ci-release-workflow-maintenance.md).

## Context

Each platform job ran the serial suite and then packaged an installer. The
hosted Intel macOS job took about 15 minutes, 10 of them in `npm test`, and set
the pace of every pull request and release. A push to `main` then ran the same
suite twice more on all four platforms, once in CI and once in the release
lane, although the pull request had already tested that exact commit. Electron
was downloaded on every run, and one download failure failed a release
candidate.

## Decision

- Run Linux, Windows and Apple silicon macOS jobs on Blacksmith runners. Intel
  macOS stays on GitHub's `macos-15-intel`, because Blacksmith has no Intel
  Macs.
- Every platform still runs the whole suite. `scripts/test.mjs` splits it by
  file, balanced by measured duration; shards run on separate runners at once,
  and each shard stays serial.
- Packaging runs alongside the tests instead of after them.
- One `Test and package (<platform>)` job per platform keeps the check names
  the `main` rule requires, and passes only when every shard and installer did.
- On pushes, reuse tests only when the exact commit already passed all four
  required checks. This is sound because `main` moves only by fast-forward, so
  the pushed commit is the tested pull request head. Any other commit runs the
  full suite. Installers are always rebuilt for releases, because the release
  version is stamped into them.
- Cache Electron and electron-builder downloads by OS, architecture and
  lockfile.

## Consequences

- A merge commit or squash commit is new code and reruns everything; reuse
  depends on fast-forward merges.
- Blacksmith's GitHub app must stay installed on the repository, or its jobs
  queue without a runner. Blacksmith Windows runners are in public beta; if
  they prove unreliable, return that platform to `windows-latest`.
- A failing shard fails every platform's required check, because the
  aggregate job sees the test matrix as a whole. The failing shard's own job
  name still identifies the platform.
