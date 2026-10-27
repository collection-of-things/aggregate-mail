# Agent procedures for Emc²

Read this file at task start alongside [AGENTS.md](AGENTS.md). Apply each
matching procedure. Reassess when the task scope changes. These procedures
use tracked project sources and require no separately installed agent skills.
They do not grant merge, release, credential or live-account authority.

## Select procedures

| Trigger | Procedure |
| --- | --- |
| Create an issue or PR | [Search existing work](#search-existing-work) |
| Feature, bug fix or refactor | [Change code](#change-code) |
| Renderer layout, interaction, styles or accessibility | Also [Change the interface](#change-the-interface) |
| Mail operations, provider access, storage, authentication or MCP | Also [Change mail or security behavior](#change-mail-or-security-behavior) |
| Instructions, guides or other prose | [Change documentation](#change-documentation) |
| Review request | [Review a candidate](#review-a-candidate) |
| Any edited candidate | [Verify and report](#verify-and-report) |

For Android, also read [docs/android.md](docs/android.md). For `website/`,
read [website/AGENTS.md](website/AGENTS.md) before acting there. For packaging,
Keychain, migrations or updates, read the ADRs named in AGENTS.md before editing.

## Search existing work

Before creating an issue or PR, follow
[CONTRIBUTING.md's coordination steps](CONTRIBUTING.md#coordinate-before-starting).
Complete the upstream search, resolve matching work and ownership, and record
search evidence before creation. Then follow the
[issue template rules](CONTRIBUTING.md#issues-and-labels) or
[PR template rules](CONTRIBUTING.md#pull-requests) before filing. If upstream
search is unavailable, stop creation and report the gap.

## Change code

1. Trace the affected entry point, callers, shared types and existing tests.
   Reuse existing helpers before adding an abstraction or dependency.
2. For a bug, reproduce the failure with synthetic input before fixing it.
   Record expected behavior, observed behavior and the failing check.
3. Make the smallest change that meets the task. Keep renderer, desktop and
   server responsibilities in their existing layers. Update callers and
   shared types together when a contract changes.
4. Select affected checks from [docs/user-journeys.md](docs/user-journeys.md).
   Cover the changed behavior and relevant failure paths. For a refactor,
   show that the existing behavior still passes.

## Change the interface

1. Read [DESIGN.md](DESIGN.md),
   [the UX feedback](docs/ux-feedback-2026-10-12.md) and
   [the design configuration](.impeccable/design.json).
2. Preserve keyboard navigation, focus, reduced motion, privacy controls and
   pending-save recovery in the affected flow. Check narrow layouts when the
   change affects sizing or placement.
3. Record synthetic component results separately from installed appearance
   and interaction. Follow the live-browser restriction in
   [PRODUCT.md](PRODUCT.md). Leave unavailable visual checks unverified.

## Change mail or security behavior

1. Trace authorization, account scope, persistence and provider effects before
   changing an operation. Read the area records in [docs/adr/](docs/adr/).
2. Use synthetic accounts, temporary encrypted stores and provider adapters.
   Follow [docs/KB.md](docs/KB.md) for isolated profiles. Preserve the mail
   and privacy rules in AGENTS.md.
3. Check denied access, stale input and uncertain outcomes where affected.
   Verify that rejected actions leave state unchanged. Preserve explicit
   consent and recovery; a Sent-copy failure must never trigger another send.
4. Treat live sign-in, mailbox changes, sending and remote calendar writes as
   separate actions requiring task authorization. Synthetic success does not
   prove them.

## Change documentation

1. Check claims against tracked sources and command names against
   [package.json](package.json) or the referenced script. Link to canonical
   rules rather than copying them.
2. Write direct instructions with a trigger, action and checkable outcome.
   Remove filler, repeated rules, unsupported claims and vague completion
   language. Keep required limits and stop conditions. Use no em dashes.
3. Check relative links and anchors, then run `git diff --check`. This repo
   has no `scripts/documentation.py`; use the documentation-only checks in
   [CONTRIBUTING.md](CONTRIBUTING.md#verify).

## Review a candidate

1. Identify the base, head and full diff. Follow the requested review scope;
   review requests are read-only unless changes are explicitly requested.
2. Trace changed behavior through callers and failure paths. Report actionable
   findings with severity, file and line, failure scenario and evidence.
3. State the verdict and proof gaps. A review does not prove execution or
   authorize delivery. Follow CONTRIBUTING.md for independent review before
   merge.

## Verify and report

1. Run the change-area checks in [CONTRIBUTING.md](CONTRIBUTING.md#verify).
   On shared Linux, use its bounded runner, one job at a time. Reuse passing
   evidence only when source and inputs match. Exit 125 stops verification;
   report the containment failure without an unbounded fallback.
2. After a failed check, preserve the first result and diagnose it. After one
   diagnosed fix, rerun only the affected check. If it still fails, stop and
   report the evidence.
3. Review the full diff for scope, debug leftovers and private data. Update
   [CHANGELOG.md](CHANGELOG.md) and the affected docs. Keep current facts in
   [docs/KB.md](docs/KB.md); add a new ADR for a new decision rather than
   rewriting accepted history.
4. Report the revision and local changes, commands and results, and unverified
   areas. Bind reused evidence to its source and inputs. Claim installed
   behavior only after [docs/installed-smoke.md](docs/installed-smoke.md) passes
   on the exact candidate. Respect the task's commit and delivery limits.
