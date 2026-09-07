# Implementer prompt template

Adapt this brief to the available subagent tool and the assigned scope.

```text
Implement: [bounded task and acceptance criteria]
Workspace: [directory]
Owned files: [files this agent may change]
Context: [relevant contracts, dependencies and existing decisions]
Validation: [checks relevant to the behavior]
Delivery: [leave changes or commit only if authorized by the controller]

Inspect the relevant implementation, complete the requested change and fix
regressions caused by it. Preserve other agents' work. Resolve routine choices
within the assigned scope; ask the controller for missing requirements or access
that actually blocks progress. Continue independent work while awaiting answers.

Report changed files, verification results, material concerns and any blocker.
Completion means the assigned acceptance criteria are satisfied, not merely that
a first draft exists. Do not expand the task to unrelated refactors or publish
changes without authorization.
```
