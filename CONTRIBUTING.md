# Contributing to Emc²

For people and AI contributors. Project map, change rules and mail privacy
rules are in [AGENTS.md](AGENTS.md). Before starting, AI contributors must
read it and [SKILLS.md](SKILLS.md), then follow the procedures that match the
task. Report vulnerabilities privately via
[SECURITY.md](SECURITY.md), never in public issues.

## Coordinate before starting

1. Find the canonical upstream from metadata and remotes; a fork's `origin`
   may not be it. If you cannot inspect upstream, stop and report the gap.
2. Before creating an issue or PR, search open and closed upstream issues
   and PRs for the same problem or change. Read matching discussions and
   check ownership. Record matches or that none were found. If the search
   cannot be completed, stop creation and report the gap.
3. Reuse matching work with its owner's agreement. Do not create duplicates,
   reopen rejected work or repeat a completed fix.
4. Create a new issue only if none covers the task. A small isolated docs fix
   may use its PR as the record. Link an existing issue from a new PR, and
   confirm no existing PR covers the change.
5. In that one issue or PR, record scope, owned paths, base and feature branch,
   owner, linked PR, required checks and status.
6. Before editing, resuming or pushing, confirm the current owner. Get the
   owner's or a maintainer's agreement before overlapping or taking over.
   Record splits, pauses, transfers and releases. Silence or staleness never
   transfers ownership. If claims conflict, stop for a maintainer.
7. One task per feature branch and worktree, one delivery owner, one writer
   per branch. Helpers work on non-overlapping scopes and return evidence. A
   human owner is accountable for agent output.

## Keep git.cafe task state current

Anyone using git.cafe must keep the issue's State current. Set In progress
when work starts and Done only after required checks and acceptance, including
merge when required. Update State when work pauses, resumes or is canceled.
Record blockers and confirm updates were saved. Report failed updates.

## Issues and labels

Use the matching [issue template](.github/ISSUE_TEMPLATE/) for web, CLI and
API submissions. Keep its sections and fill required fields. Mark fields
that do not apply; do not invent evidence. Apply one type label:

| Label | Use for |
| --- | --- |
| `bug` | Broken behavior |
| `feature` | A new capability |
| `enhancement` | Improvement to existing behavior |
| `documentation` | Documentation-only changes |
| `chore` | CI, dependencies, releases, maintenance |

## Closing issues and pull requests

Anyone closing an issue or PR must comment with the reason. If it is linked
to another issue or PR, include that link and comment there with the reason
and a link back. If the fix already exists or is being implemented elsewhere,
link to the fixing commit or PR and state whether it is merged or still in
progress. Confirm the comments are posted before closing.

## Set up

Node 24.22.1 or a newer 24.x (see `.nvmrc`) and npm. From the repository root:

```sh
npm ci
npm run dev      # Electron with React/CSS hot reload; restart after desktop or server changes
```

`npm run dev:web` is the optional browser target. Follow the required password,
external encryption-key and isolated-profile setup in
[Local browser access](README.md#local-browser-access). Export these startup
variables before launching; `.env` is not the browser security configuration.
The browser gate authenticates browser requests; desktop requests retain their
per-launch token. Never commit secrets. Other environment variables
(Jev/`TYPESAFE_*`, `MAIL_*`) are described in [README.md](README.md) and
[docs/KB.md](docs/KB.md).

## Branches and commits

- Branch from current `main` as `<type>/<topic>`, using `feat`, `fix`, `docs`,
  `chore` or `test`.
- Imperative commit subjects; `feat:`, `fix:` or `test:` prefixes are common.
- Never start a subject with `Release `; it is reserved for manual version
  commits.
- Check author/committer metadata for private details before pushing.

## Verify

| Change | Run |
| --- | --- |
| Application | `npm test` and `npm run build` (build = strict `tsc`; there is no lint script) |
| MCP | Also `node scripts/check-mcp.mjs` (isolated handshake and access check; not live delivery) |
| Electron, preload, storage, packaging | Also `npm run check:desktop` with an isolated profile per [docs/KB.md](docs/KB.md); require startup result and exit |
| Native Windows or macOS | Startup on the affected OS and architecture (macOS needs desktop and Keychain access) |
| Android (`android/`) | Bounded unit tests, lint, APK build and synthetic Device Hub smoke per [docs/android.md](docs/android.md); desktop checks still apply to shared/root application changes |
| Documentation only | Relative links, command names, factual claims, `git diff --check` |

- Tests use `tsx --test` over `server/`, `desktop/`, `src/` and `scripts/` test files.
  `npm test` runs files serially so mounted UI checks do not compete for CPU;
  individual test and CI step deadlines still apply.
  Run one file with `node --import tsx --test <file>`.
- There is no `scripts/documentation.py`; do not invent doc commands.
- Report live sign-in, mailbox changes, sending, interactive UI and
  downloaded-app acceptance separately from automated results.
- Follow the live-browser-testing restriction in PRODUCT.md.

For phone-access changes, run `server/phone-access.test.ts`,
`server/phone-passkeys.test.ts`, `server/browser-keyring.test.ts`,
`src/phone-pairing.test.tsx`, `scripts/phone-auth.test.mjs`,
`server/browser-access.test.ts` and `src/phone-access.test.tsx` serially through
the bounded wrapper below, then the strict build. Use injected CLI/probes and
synthetic DNS names and temporary profiles. OS-key tests inject fake credential
entries and must not inspect saved host credentials. Do not mutate shared host routes as a unit test. Separate
live TLS route proof from phone-device and provider OAuth acceptance.

### Bounded local verification

On shared Linux hosts, the following wrapper is required for tests and builds.
Set `FLEET_BIN` to the verified Fleet executable supplied by the host owner.
Do not silently install a runner or run without containment when it is missing.

```sh
test -x "$FLEET_BIN" || exit 125
"$FLEET_BIN" verification bounded --memory-mib 2048 --timeout 120 -- \
  env NODE_OPTIONS=--max-old-space-size=1024 \
  node --import tsx --test src/snooze.test.tsx
"$FLEET_BIN" verification bounded --memory-mib 3072 --timeout 180 -- \
  env NODE_OPTIONS=--max-old-space-size=2048 npm run build
```

Replace the test path with the affected file or add `--test-name-pattern`
before it. Run files serially. For a required full-suite check, use a bounded
serial run after checking existing evidence:

```sh
"$FLEET_BIN" verification bounded --memory-mib 2048 --timeout 900 -- \
  env NODE_OPTIONS=--max-old-space-size=1024 \
  node --import tsx --test --test-concurrency=1 --test-timeout=120000 \
  server/*.test.ts desktop/*.test.ts src/*.test.tsx scripts/*.test.mjs
```

The wrapper sets the cgroup memory limit, disables swap, applies an external
deadline and cleans up descendants. Exit 125 means containment or cleanup
failed. Stop and report it. After a failed test, preserve its first log,
diagnose the first failure and run only the affected check after one bounded
fix. Never rerun a runaway mounted test unchanged. A new session or worktree
does not invalidate matching evidence.

Record command, exit status, source/input hashes and log path. Native checks
also need OS, architecture, artifact digest, deadline and process cleanup.
Fleet's Linux command is not a macOS or Windows runner; use the platform's
reviewed bounded lifecycle. Keep npm scripts portable for the CI OS matrix.
The [journey map](docs/user-journeys.md) identifies focused checks; the
[installed smoke recipe](docs/installed-smoke.md) defines acceptance beyond them.

## CI and releases

- [Build installers and release](.github/workflows/release.yml) runs on eligible
  pushes to `main` and manual dispatch on an existing stable version tag.
  A main push can publish automatically. Include `[skip release]` in the PR
  title when merging must not publish; squash merges use that title.
  Documentation-only paths and commit subjects starting with `Release ` also
  skip automatic publication. Keep merge and release authorization explicit.
- Push runs choose the next unused patch version and create its tag only after
  all four installer jobs pass. Manual dispatch requires an existing stable
  `v<major>.<minor>.<patch>` tag resolving to the run commit and matching the
  source version. Tag pushes alone do not start this workflow.
- Release checks include actionlint, tests, strict builds and installers for
  Windows x64, macOS arm64, macOS x64 and Linux x64. Windows and macOS run
  isolated startup checks. Every job uses a GitHub-hosted runner; macOS x64
  keeps its x64 Node guard. Tests run once on Linux.
- Publishing waits for every platform job, validates the complete installer
  and updater manifest set, rejects artifact digest mismatches and generates
  checksums. Existing tags must match the run commit and cannot be moved or
  deleted. The workflow creates no source version commit.
- Pull-request CI is separate and opt-in. Skipped or absent checks are not
  passing application verification. Review dependency advisories, licenses
  and updates manually.
- Repository protections and Actions enablement are separate settings. Deleting
  workflows does not remove required checks, merge-queue rules or approvals.
  A maintainer must reconcile any requirements for removed CI before merging;
  do not fabricate passing statuses or bypass protections. Direct pushes,
  force pushes and deleting `main` remain prohibited.
- Local verification in the table above and independent review remain required
  unless the task owner explicitly prohibits execution. Report such checks as
  unrun. Do not dispatch Actions as a substitute without authorization.
- Workflow changes normally use actionlint 1.7.12 and the release/workflow source
  tests locally. PR creation does not authorize hosted execution or publishing.
- Use Node 24.22.1 (`.nvmrc`; `nvm use` picks it up) for local builds and tests.
- Commits must use your GitHub noreply email. Enable GitHub's **Keep my email
  addresses private** and **Block command line pushes that expose my email**,
  then set `git config user.email <id>+<login>@users.noreply.github.com`.
  Before pushing, run `node scripts/check-commit-emails.mjs origin/main..HEAD`.
  Commit privacy is no longer checked automatically by a PR workflow.
- Local packaging: `npm run package` (Windows NSIS), `npm run package:mac`
  (DMG and ZIP), `npm run package:mac:dir` (app bundle, source-install route).
  Mac builds need Xcode Command Line Tools. Output goes to `release/`.
- `npm run release` builds and publishes the Windows installer locally. It and
  manual workflow dispatch require explicit release authorization.
- Never commit generated output or local app data.

## Changelog and release notes

- Every user-visible change adds a short entry under `Unreleased` in
  [CHANGELOG.md](CHANGELOG.md). Explain the resulting behavior and user benefit;
  link the issue or PR. Do not use commit subjects as the whole explanation.
- Group entries under Added, Changed, Fixed, Security or Documentation as needed.
  Combine duplicate entries. Preserve meaningful limits and compatibility notes.
- Before a release, compare with the previous published tag. Move only new
  changes into a dated version section, newest first, and leave `Unreleased`
  available for the next change. Do not carry already-released changes forward.
- The release owner uses that version section for the published release body
  and reads it back after publication. For an automatically published release,
  replace the generated PR-title list with the approved version notes using
  `gh release edit <tag> --notes-file <file>`. Verify the saved text and links
  before reporting the release complete.
- Keep test receipts and internal implementation notes in the PR or relevant
  repository docs. They do not replace user-facing release notes.

## Pull requests

- Use [the PR template](.github/PULL_REQUEST_TEMPLATE.md) for web, CLI and API
  submissions. Keep its headings and checklist, fill the fields, and mark
  missing proof or fields that do not apply. Check only verified items.
- Explain the problem, resulting behavior and checks; include repro steps for
  bugs and list remaining proof gaps.
- Keep the diff in the agreed scope; use synthetic data in captures.
- Whoever merges must first fetch the latest target branch and rebase the PR
  branch onto it. Resolve conflicts and push the updated branch before merging.
- All required checks must pass on the updated revision, including documented
  local checks when hosted CI is absent. Do not merge with failed, pending,
  missing or stale required results. If the target branch advances, update
  again and refresh affected verification and review.
- Before merge, a reviewer other than the author reviews the current base,
  head and full diff. Required approvals must be current and blocking feedback
  resolved. Assignment is not approval or merge authority.
