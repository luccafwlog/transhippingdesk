---
name: subagent-driven-development
description: "Execute a plan through authorized subagents with independent task ownership."
---

# Subagent-driven development

Use only when delegation is authorized and independent work benefits from it.
Give each agent a bounded task, relevant requirements, owned files, available
validation and a completion condition. Avoid concurrent edits to shared files;
coordinate dependencies before integrating results.

Continue useful local work while agents run. Resolve their context questions,
inspect returned changes and verify integration. Delegate a focused review when
risk warrants it; a pair of review agents after every task is not mandatory.
Keep model settings inherited unless the user or applicable instructions specify
otherwise. Unavailable subagent tooling does not block inline execution.

Templates are optional starting points for the selected role:

- [implementer-prompt.md](implementer-prompt.md): a bounded implementation.
- [spec-reviewer-prompt.md](spec-reviewer-prompt.md): requirements compliance.
- [code-quality-reviewer-prompt.md](code-quality-reviewer-prompt.md): maintainability.

Continue until the requested plan is implemented, validated and documented, or
a concrete blocker needs user input. Archive completed plans/specs and update
indexes according to `docs/CONVENCOES.md`. Follow the delivery action already
requested without an extra continuation gate.
