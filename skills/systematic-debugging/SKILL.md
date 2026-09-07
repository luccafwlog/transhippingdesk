---
name: systematic-debugging
description: "Trace an unexplained failure to its root cause before changing code."
---

# Systematic debugging

Reproduce the reported symptom when possible, inspect the relevant error and
recent changes, and trace the failing value to its owner. Compare with a working
path. Form a falsifiable hypothesis and use the smallest useful probe to test it.
Read code when it helps establish the reproduction; neither step needs a ritual
ordering. Do not log credentials or private payloads to diagnose configuration.

Fix the cause at the shared owner after checking callers. Leave a focused
regression check for non-trivial logic and verify the original symptom plus
related behavior. If evidence points to an environment issue, distinguish it
from an application defect and report what remains unverified.

When probes stop producing information, revise the hypothesis or inspect the
boundary you have not tested. Repeated failure alone does not prove the
architecture is wrong. Ask for missing access or a material business decision;
continue investigations that are already authorized.

Read supporting techniques only for the relevant failure:

- [root-cause-tracing.md](root-cause-tracing.md): bad values deep in a call stack.
- [condition-based-waiting.md](condition-based-waiting.md): timing and flaky waits.
- [defense-in-depth.md](defense-in-depth.md): validation boundaries after diagnosis;
  follow the repository's shared-owner rule rather than duplicating guards.
