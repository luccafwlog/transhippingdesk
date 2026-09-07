---
name: requesting-code-review
description: "Arrange a focused independent review when requested or warranted by change risk."
---

# Requesting code review

Choose the actual diff: working-tree changes, a commit, or a branch against its
verified base. Supply the reviewer with requirements, relevant constraints and
validation evidence. Use [code-reviewer.md](code-reviewer.md) as a template when
it fits; only dispatch a subagent when permitted in the session.

Review scope and depth should reflect risk. An ordinary task does not require
multiple reviewers or a review after every mechanical step. Verify findings
against the real code path, fix actionable defects within scope, and rerun the
affected checks. Repeat review only if changes or unresolved concerns justify it.

Report concrete findings and limitations; do not imply a review occurred when
no reviewer was run. Review itself does not authorize push, merge or deployment.
