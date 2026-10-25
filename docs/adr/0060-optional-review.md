# ADR 0060: Optional review for maintainer pull requests

Date: 2026-10-24
Status: Accepted
Amends: [ADR 0059](0059-merge-queue-and-reviews.md), its required approval only.

## Context

ADR 0059 required one approval from someone other than the last pusher. Most
pull requests come from maintainers and their agents under a maintainer's
account, so every merge waited for another maintainer to be available.

The protection that matters for an open-source repository does not depend on
that approval. Outside contributors have no write access, so their pull
requests land only when a maintainer merges them, and their workflow runs need
maintainer approval first.

## Decision

- Set the required approval count to zero. Reviews remain available and
  encouraged.
- Keep everything else from ADR 0059: pull requests only, resolved review
  conversations, all four platform checks, the merge queue, squash merges, no
  direct or force pushes to `main`, protected `v*` tags and approval for
  outside contributors' workflow runs.
- Keep GitHub's approval requirement for commits pushed to someone else's pull
  request, so nobody can add unreviewed changes to another author's work.

## Consequences

- A maintainer can merge their own pull request once CI passes in the merge
  queue; correctness rests on CI rather than a second reader.
- Changes to workflows, the updater, Keychain or storage still deserve a
  second reader. Ask for one in the pull request.
