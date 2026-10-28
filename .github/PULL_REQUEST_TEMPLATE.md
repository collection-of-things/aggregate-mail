## Summary

**Problem:** <!-- What is wrong or missing? Link the task record, for example Closes #123. -->

**Result:** <!-- What changes for the user? Add a tree, diagram, pseudocode or diff sketch when helpful. -->

**Changelog:** <!-- Link the CHANGELOG.md entry and explain its user-visible effect, or state why none is needed. Release preparation must include versioned notes since the last published tag. -->

## Stack

<!-- Delete this section for a single PR. List every layer from bottom to top and mark this one in bold. Name the immediate parent and dependency issues; merge bottom first. Follow the stack merge procedure in CONTRIBUTING.md. -->

Parent branch/PR and dependency issues:
Merge order (bottom first):

1. #000 Foundation change (base `main`)
2. **#000 This change (base foundation branch)**

## Evidence

- **Before:** <!-- Observed behavior, screenshot, output or failing check. -->
  **After:** <!-- Observed result, screenshot, output or passing check. -->

<details>
<summary>Verification</summary>

<!-- List each applicable command or target, platform, exit status or observed result, and tested revision. Mark missing proof unknown and explain checks that do not apply. -->

- [ ] For application changes, `npm test` and `npm run build` pass; list the checks that apply to this change.
- [ ] No mail content, addresses, account names, credentials or local paths in the diff, fixtures, logs or screenshots.
- [ ] Documentation that this change makes wrong is updated in the same pull request.

</details>

<details>
<summary>Ownership and scope</summary>

- Task owner:
- Delivery owner (one writer):
- Owned paths:
- Base branch and feature branch:
- Immediate parent and dependencies (none for a standalone PR):
- Related issue or pull request (full URLs on each forge; numbers may differ):
- Coordination search completed; current owner confirmed:

</details>

<details>
<summary>Review</summary>

- Independent reviewer:
- Reviewed target/base SHA, head SHA, tree and complete diff identity:
- Verification input identities and matching receipts:
- Latest-target fetch/rebase and remaining stack reconciliation:
- Required checks and approvals:
- Blocking feedback resolved:
- Native, live-account or release proof still needed, if applicable:

</details>

<!-- After a fix merges, verify acceptance, comment with the completion reason and fixing PR link on each issue, add reciprocal issue links/reasons on the PR, and read back closure and git.cafe State on both hosts. Leave unfinished scope open. See CONTRIBUTING.md. -->

## Merge risk

**Rollback:** <!-- How can this change be reversed? State any lasting effects that a revert cannot undo. -->

**Affected scope:** <!-- Who or what could be affected, and what could break? -->
