---
name: executing-plans
description: "Implement an existing plan through validation and completion."
---

# Executing plans

Read the plan and relevant current sources. Check assumptions against the code,
then execute its outstanding work in dependency order. Preserve requirements;
adapt mechanical steps when the repository differs from the plan.

Continue through implementation, relevant checks, and fixes caused by the
change. A failing test starts diagnosis, not an automatic request for permission.
Ask only for unresolved requirements, missing access, or a material scope change;
continue independent tasks while waiting.

Use the existing workspace unless isolation is needed. Delegation is optional
and subject to the session's authorization; a plan does not require subagents.

At completion, archive the plan and its completed spec and update their indexes
as required by `docs/CONVENCOES.md`. Report the result, validation and remaining
limitations. Follow the requested delivery action; if none was requested, leave
the reviewable patch in the workspace.
