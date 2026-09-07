---
name: test-driven-development
description: "Implement behavior test-first when TDD is requested or a regression needs reproduction."
---

# Test-driven development

Write a focused test of the public behavior and observe it fail for the intended
reason. Implement the change, run that test, then refactor as needed while
preserving behavior. Run related checks according to the affected contracts.

Test outputs and user-visible outcomes, not private calls or a copy of the
implementation. Choose boundaries from the existing public interfaces and
requirements; ask about business ambiguity, not routine test placement.

Preserve existing work. If implementation already exists, verify the regression
test can detect the original defect without deleting the patch. Documentation,
generated output and trivial edits use the appropriate repository validation;
they do not need artificial failing tests or approval to skip them.

For concrete mocking pitfalls, consult
[testing-anti-patterns.md](testing-anti-patterns.md) when the test relies on mocks.
The [tdd skill](../tdd/SKILL.md) is an alternative reference, not a prerequisite.
