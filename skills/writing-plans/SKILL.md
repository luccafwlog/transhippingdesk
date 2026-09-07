---
name: writing-plans
description: "Write an implementation plan for substantial work needing coordination or handoff."
---

# Writing plans

Produce a plan another engineer can execute: intended outcome, relevant current
constraints, affected files and interfaces, dependencies, acceptance criteria,
and checks that demonstrate completion. Describe decisions and observable
behavior; include code only when it resolves an ambiguity or fragile step.

Scale detail to risk. Avoid duplicating full implementations, a commit per
mechanical step, or reprinting the repository documentation. Mark decisions
that still require input and distinguish them from routine implementation choices.

Save live plans in `docs/plans/YYYY-MM-DD-<topic>.md` and index them in
`docs/plans/README.md`. Specs belong in `docs/spec/`; follow `docs/CONVENCOES.md`
for their lifecycle. Check coverage and contradictions against the requirements.

If the user asked only for a plan, deliver it. If they asked for implementation,
continue executing the plan once material decisions are settled; do not ask
again whether to start or force a choice of agent orchestration.
