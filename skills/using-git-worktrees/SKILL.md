---
name: using-git-worktrees
description: "Create or reuse a Git worktree when the task needs workspace isolation."
---

# Git worktrees

Honor the user's workspace preference. Inspect `git status`, `git worktree list`
and `git rev-parse --show-superproject-working-tree` before creating isolation.
Reuse a harness-provided worktree; a submodule or detached HEAD alone does not
justify creating another workspace.

Use an available native worktree operation when it supports the requested task;
otherwise use `git worktree add`. Follow an existing directory convention or use
`.worktrees/`, verify it is ignored before creating contents, and use `codex/`
for new branches unless the user supplied a name. Preserve unrelated changes.

Install dependencies only when needed, using `npm ci --legacy-peer-deps` for
this project. Run the baseline checks relevant to the change when they help
separate existing failures from regressions; a documentation edit does not
need an application test suite merely because a worktree was created.

Track whether this task created the worktree. Preserve harness-owned workspaces
and work still needed for review. Cleanup follows the authorized delivery action;
see [finishing-a-development-branch](../finishing-a-development-branch/SKILL.md)
when integration or removal is actually requested.
