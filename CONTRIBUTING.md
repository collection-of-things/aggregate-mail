# Contributing to Emc²

For people and AI contributors. Project map, change rules and mail privacy
rules are in [AGENTS.md](AGENTS.md). Before starting, AI contributors must
read it and [SKILLS.md](SKILLS.md), then follow the procedures that match the
task. Report vulnerabilities privately via
[SECURITY.md](SECURITY.md), never in public issues.

## Coordinate before starting

1. Find the canonical upstream from metadata and remotes; a fork's `origin`
   may not be it. If you cannot inspect upstream, stop and report the gap.
2. Before creating any issue or PR, search upstream open and closed issues
   and PRs by problem, area and related terms. Read matching discussions,
   assignees, linked PRs and changed files. Record the search terms and
   relevant matches, or that none were found, in the task record. If the
   search is unavailable or incomplete, stop creation and report the gap.
3. Reuse a matching active issue or PR with its owner's agreement instead of
   creating a duplicate. For closed matches, check the resolution before
   proposing new work. Do not reopen rejected work or repeat a completed fix.
4. Create a new issue only when no existing issue covers the task. A small
   isolated docs fix may use its PR as the record. Before opening a PR,
   confirm no existing PR covers the change and link the existing issue when
   one covers the task.
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

Contributors using git.cafe, including people and agents, must update the
issue's State when work starts, pauses, resumes, finishes or is canceled.
Check the current state and owner before each transition. Use these states:

| State | Use when |
| --- | --- |
| Triage | The report needs assessment or a scope decision. |
| Backlog | The task is accepted but deferred. |
| Todo | The task is ready to start and no one is actively working on it. |
| In progress | Work has started, including verification and pending review or merge. |
| Done | Required verification and acceptance passed, and the change is merged when merge is part of the task. |
| Canceled | The owner or maintainer canceled the task or confirmed it is a duplicate. Link the retained task for duplicates. |

On a pause, use Todo if the task remains ready, Backlog if deferred, or Triage
if it needs reassessment. For a blocker or pending review, record the reason
and next action in the task record; do not mark incomplete work Done.
After a state update, read it back to confirm it was saved. If access or the
update fails, report the gap and required transition without claiming success.

## Issues and labels

Before filing an issue, read the matching template in
[.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/) and fill every required
field. This applies to web, CLI and API creation. Preserve the template's
sections in a CLI or API body. State when a field does not apply; do not
invent evidence. Apply one type label:

| Label | Use for |
| --- | --- |
| `bug` | Broken behavior |
| `feature` | A new capability |
| `enhancement` | Improvement to existing behavior |
| `documentation` | Documentation-only changes |
| `chore` | CI, dependencies, releases, maintenance |

## Set up

Node 24.22.1 or a newer 24.x (see `.nvmrc`) and npm. From the repository root:

```sh
npm ci
npm run dev      # Electron with React/CSS hot reload; restart after desktop or server changes
```

`npm run dev:web` (optional browser target) reads `.env` copied from
[.env.example](.env.example); never commit it. Open the session link the mail
server prints at startup (it changes on every launch); `/api` refuses requests
without it. Other environment variables
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

- [Build installers and release](.github/workflows/release.yml) is the only
  workflow. It runs only on an explicit manual dispatch selecting an existing
  stable `v<major>.<minor>.<patch>` tag. The tag must resolve to the run commit
  and match the source version. Creating or pushing the tag does not run it.
- Pull requests, merge groups, branch pushes and schedules start no workflows.
  Automatic patch releases, scheduled CodeQL, dependency review, dependency
  auto-merge and Dependabot update configuration are removed. Review dependency
  advisories, licenses and updates manually.
- An authorized manual release runs actionlint, tests, strict builds and installer
  creation for Windows x64, macOS arm64, macOS x64 and Linux x64. Windows and
  macOS also run isolated startup checks. Every job uses a GitHub-hosted
  runner; macOS x64 runs on the native Intel image and keeps its x64 Node
  guard. See
  [ADR 0063](docs/adr/0063-manual-release-only-actions.md).
- Publishing waits for every platform job. It validates the complete installer
  and updater manifest set, rejects artifact digest mismatches, generates
  checksums and publishes only against the selected existing tag. Tags cannot
  be moved or deleted. This workflow never creates a tag or version commit.
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

## Pull requests

- Before filing a PR, read [the PR template](.github/PULL_REQUEST_TEMPLATE.md)
  and fill its task record, ownership, verification and review sections.
  Preserve its headings and checklist in web, CLI and API bodies. State when
  a field does not apply or proof is unavailable. Check a box only when its
  condition is verified.
- Explain the problem, resulting behavior and checks; include repro steps for
  bugs and list remaining proof gaps.
- Keep the diff in the agreed scope; use synthetic data in captures.
- Before merge, a reviewer other than the author reviews the current base,
  head and full diff. Required checks and approvals pass; blocking feedback is
  resolved. Assignment is not approval or merge authority.
