# ADR 0059: Merge queue, reviews and protected release tags

Date: 2026-10-24
Status: Accepted
Extends: [ADR 0058](0058-sharded-ci-on-blacksmith.md).

## Context

The project is open source. Its `main` rule required passing CI but allowed
direct pushes and unreviewed merges, and Intel macOS was not a required check.
A pull request tested against an older `main` could also land a combination
nobody had tested. Release tags could be moved or deleted after publication.
Returning outside contributors' pull requests ran CI, on paid runners, without
approval.

## Decision

- `main` changes only through a pull request with one approving review from
  someone other than the last pusher. A new push dismisses earlier approvals,
  and all review conversations must be resolved.
- All four `Test and package (<platform>)` checks are required, including Intel
  macOS.
- Pull requests merge through GitHub's merge queue. It squashes each pull
  request onto the latest `main`, runs CI on that commit (`merge_group`), and
  moves `main` to exactly that commit only if CI passes. The PR title becomes
  the commit subject, so `[skip release]` and `Release ` in the title control
  publication.
- Because the queue lands the commit it tested, pushes to `main` and the
  release lane keep reusing test results, as ADR 0058 describes.
- Direct pushes, force pushes and deletion of `main` are blocked, with no
  bypass actors. `v*` tags cannot be moved or deleted; Actions can still create
  them when publishing.
- Workflow runs for all outside contributors need maintainer approval.
- No CODEOWNERS file: any collaborator with write access can approve.

## Consequences

- An author cannot merge their own change alone. Agent pull requests opened
  under a maintainer's account need another maintainer's approval.
- Each pull request runs CI twice: on the branch, then in the merge queue.
- Squash commits carry the GitHub account email of the pull request author;
  contributors should enable GitHub's private email setting.
- Changing these rules needs a repository admin and should update this record.
