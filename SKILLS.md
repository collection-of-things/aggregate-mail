# Project task guide

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before
working on this project. Use the references that match the task.

| Task | Follow |
| --- | --- |
| Create an issue or PR | [Search existing work](CONTRIBUTING.md#coordinate-before-starting), then use the [issue](CONTRIBUTING.md#issues-and-labels) or [PR](CONTRIBUTING.md#pull-requests) template. |
| Work tracked on git.cafe | Keep [task State](CONTRIBUTING.md#keep-gitcafe-task-state-current) current. |
| Change code | Reuse existing helpers and keep the change within scope. Follow [change rules](AGENTS.md#change-rules). |
| Change a user workflow | Select checks from [docs/user-journeys.md](docs/user-journeys.md). |
| Change the interface | Follow [DESIGN.md](DESIGN.md), [UX feedback](docs/ux-feedback-2026-10-12.md) and [.impeccable/design.json](.impeccable/design.json). |
| Change mail, storage, authentication or MCP | Follow [mail and privacy rules](AGENTS.md#mail-and-privacy) and the affected [ADRs](docs/adr/). Use synthetic data and isolated profiles from [docs/KB.md](docs/KB.md). |
| Change the version display or update status | Reuse the About and storage facts-row layout and existing update checks. Follow [version and update status](docs/KB.md#about-version-and-update-status) for the package version, browser host comparison and unknown states; verify with `src/about-version.test.tsx`. |
| Change desktop packaging, Keychain, migration or updates | Read the area-specific ADRs named in [AGENTS.md](AGENTS.md#change-rules) and its [reading list](AGENTS.md#read-for-the-affected-area). |
| Change Android | Follow [docs/android.md](docs/android.md). |
| Change the website | Follow [website/AGENTS.md](website/AGENTS.md). |
| Change documentation | Check links, commands and facts. Use direct wording and remove repeated rules and filler. |
| Reconcile GitHub and git.cafe | Resolve equivalent tasks by full URL and acceptance scope, then follow [closure and reciprocal-link requirements](CONTRIBUTING.md#closing-issues-and-pull-requests). Numbers and state are independent. |
| Close an issue or PR | Follow the [closure requirements](CONTRIBUTING.md#closing-issues-and-pull-requests): comment with the reason, link the fix or ongoing work, and cross-reference linked issues or PRs. |
| Merge a PR | Follow the [merge requirements](CONTRIBUTING.md#pull-requests) for explicit stack dependencies, latest-target fetch/rebase, matching input receipts and current independent review. |
| Verify or deliver changes | Follow [verification](CONTRIBUTING.md#verify) and [PR requirements](CONTRIBUTING.md#pull-requests). Report observed results and anything unverified. |

These instructions grant no additional authority. Follow the task's limits on
commits, pushes, merges and live-account actions.
