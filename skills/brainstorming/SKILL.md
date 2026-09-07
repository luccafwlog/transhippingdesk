---
name: brainstorming
description: "Explore unresolved product or design choices before a substantial implementation."
---

# Brainstorming

Resolve the decisions that determine what to build. Inspect the affected code
and relevant domain context, identify the desired outcome and constraints, and
compare alternatives only where the tradeoff matters.

Ask for missing business decisions that would change the result. Use existing
requirements and authorization; a clear implementation request does not need a
separate design approval ceremony. A request limited to exploration ends with
a recommendation, not an unsolicited implementation.

For substantial designs, record behavior, boundaries, failure cases and
acceptance criteria in `docs/spec/YYYY-MM-DD-<topic>-design.md`. Follow
`docs/CONVENCOES.md` for indexing and archival. Small changes need no spec file.

When implementation is requested and decisions are sufficient, continue through
implementation and validation. Write a plan only if coordination or handoff
needs one. Use [visual-companion.md](visual-companion.md) when the browser
companion would help resolve an actual visual decision.
