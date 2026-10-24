# Contributing to Emc²

For people and AI contributors. Project map, change rules and mail privacy
rules are in [AGENTS.md](AGENTS.md). Report vulnerabilities privately via
[SECURITY.md](SECURITY.md), never in public issues.

## Coordinate before starting

1. Find the canonical upstream from metadata and remotes; a fork's `origin`
   may not be it. If you cannot inspect upstream, stop and report the gap.
2. Search open and closed issues and PRs by problem and area. Read comments,
   assignees, linked PRs and changed files.
3. Reuse an active item if its owner agrees. Do not reopen rejected work.
4. Record each new task in an issue first. A small isolated docs fix may use
   its PR as the record.
5. In that one issue or PR, record scope, owned paths, base and feature branch,
   owner, linked PR, required checks and status.
6. Before editing, resuming or pushing, confirm the current owner. Get the
   owner's or a maintainer's agreement before overlapping or taking over.
   Record splits, pauses, transfers and releases. Silence or staleness never
   transfers ownership. If claims conflict, stop for a maintainer.
7. One task per feature branch and worktree, one delivery owner, one writer
   per branch. Helpers work on non-overlapping scopes and return evidence. A
   human owner is accountable for agent output.

## Issues and labels

Use the templates in `.github/ISSUE_TEMPLATE/` and apply one type label:

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
[.env.example](.env.example); never commit it. Other environment variables
(Jev/`TYPESAFE_*`, `MAIL_*`) are described in [README.md](README.md) and
[docs/KB.md](docs/KB.md).

## Branches and commits

- Branch from current `main` as `<type>/<topic>`, using `feat`, `fix`, `docs`,
  `chore` or `test`.
- Imperative commit subjects; `feat:`, `fix:` or `test:` prefixes are common.
- Never start a subject with `Release `; it is reserved for manual version
  commits and skips the auto-release.
- Check author/committer metadata for private details before pushing.

## Verify

| Change | Run |
| --- | --- |
| Application | `npm test` and `npm run build` (build = strict `tsc`; there is no lint script) |
| MCP | Also `node scripts/check-mcp.mjs` (isolated handshake and access check; not live delivery) |
| Electron, preload, storage, packaging | Also `npm run check:desktop` with an isolated profile per [docs/KB.md](docs/KB.md); require startup result and exit |
| Native Windows or macOS | Startup on the affected OS and architecture (macOS needs desktop and Keychain access) |
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

- `.github/workflows/ci.yml` runs one **Checks** job for workflow validation and
  commit email privacy. Pull requests run the full serial Linux test suite and
  build. The merge queue, manual runs and release lanes test and package all
  four platforms: Windows x64, macOS arm64, macOS x64 and Linux x64.
  Every job uses Blacksmith. macOS x64 runs under Rosetta rather than on Intel
  hardware. See [ADR 0062](docs/adr/0062-simple-blacksmith-ci.md).
- `main` accepts changes only through a pull request with all conversations
  resolved and the four required checks green. Reviews are welcome but not
  required, so maintainers can merge their own work; a commit pushed to someone
  else's pull request needs an approval. **Merge when ready** adds it to the
  merge queue, which squashes it onto the latest `main`, reruns CI on that exact
  commit and lands it only if CI passes. Direct pushes, force pushes and
  deleting `main` are blocked.
- The squash commit takes the PR title as its subject, so the title decides the
  release: a title starting with `Release ` or containing `[skip release]`
  publishes nothing. Release lanes run fresh tests before publishing.
- CI stamps non-tag builds with a `-ci.` version (`scripts/set-build-version.mjs`,
  ADR 0004). Do not change `version` in a PR.
- Every push to `main` except `Release ` commits and commits containing
  `[skip release]` runs `auto-release.yml`: it builds the next patch from
  the triggering commit, then creates the tag and publishes only after all four
  platform jobs pass. It does not modify `main` or the source version. Merge
  only release-ready work.
- CI-only and docs-only changes suppress automatic publication with `[skip release]`
  in the PR title. The marker does not disable ordinary CI or explicit tag
  releases. Do not use `[skip ci]` for workflow upgrades.
- Release tags (`v*`) cannot be moved or deleted once created.
- Outside contributors' pull requests run CI only after a maintainer approves the
  run. Read the diff, especially workflow, script and dependency changes, first.
- Workflow changes also require `actionlint` (1.7.12), the release/workflow tests,
  and the complete four-platform hosted CI run. CI runs workflow validation
  before packaging.
- Dependabot opens monthly grouped GitHub Actions and npm minor/patch updates.
  Maintainers review and queue these pull requests; there is no dependency
  auto-merge workflow. Review advisories and license changes before merging.
  CodeQL runs weekly and on manual dispatch on Blacksmith.
- Use Node 24.22.1 (`.nvmrc`; `nvm use` picks it up) for local builds and tests.
- Commits must use your GitHub noreply email. Turn on GitHub's **Keep my email
  addresses private** and **Block command line pushes that expose my email**,
  then set `git config user.email <id>+<login>@users.noreply.github.com`. The
  squash commit uses the email set on your GitHub account, so the setting
  matters even if your local commits are clean. Check before pushing with
  `node scripts/check-commit-emails.mjs origin/main..HEAD`. CI's
  **Checks** job checks every pull request commit and the merge
  queue's squash commit, and blocks the merge on any other address.
- Minor and major releases are manual: bump the source version, then push the
  matching `v*` tag (`release.yml`).
- Retry an automatic release through its original workflow run. Its tag points
  at source with the older committed version, so the strict manual tag workflow
  cannot rebuild it. A publish retry reuses a tag only when its commit matches.
- Local packaging: `npm run package` (Windows NSIS), `npm run package:mac`
  (DMG and ZIP), `npm run package:mac:dir` (app bundle, source-install route).
  Mac builds need Xcode Command Line Tools. Output goes to `release/`.
- `npm run release` builds and publishes only the Windows installer locally.
  Tags, this script and workflow dispatch all publish; use only with explicit
  release authorization.
- Never commit generated output or local app data.

## Pull requests

- Fill in [the PR template](.github/PULL_REQUEST_TEMPLATE.md): task record,
  ownership, verification and review.
- Explain the problem, resulting behavior and checks; include repro steps for
  bugs and list remaining proof gaps.
- Keep the diff in the agreed scope; use synthetic data in captures.
- Before merge, a reviewer other than the author reviews the current base,
  head and full diff. Required checks and approvals pass; blocking feedback is
  resolved. Assignment is not approval or merge authority.
