---
name: finishing-a-development-branch
description: "Complete a requested branch integration, PR delivery or workspace cleanup."
---

# Finishing a development branch

Inspect status, branch, base and workspace ownership. Use the existing validation
evidence for unchanged code and complete any missing relevant checks. Fix
failures caused by the patch before claiming it ready.

Carry out the delivery action already requested. If no integration action was
requested, leave a reviewable patch and report it; do not impose a merge/PR/
discard menu. Push, merge and deployment need authorization for that action.

For an authorized PR, describe the problem, final behavior and validation.
Follow `CLAUDE.md` for bounded CI monitoring. Do not force-push without an
explicit request. Test the merged result when integration changes the code.

Preserve the workspace while a PR is open. Cleanup requires known ownership:
a directory name alone does not prove the agent created it. Never remove a
harness-owned worktree. Before discarding work, identify commits and uncommitted
changes and obtain explicit authorization for their loss. Remove a worktree
from outside it, only after confirming successful integration or authorized
discard; do not delete the branch first.
