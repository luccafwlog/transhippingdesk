# ADR format

An Architectural Decision Record captures one decision that is hard to reverse,
surprising without context, and the result of a real trade-off. One decision per
file. Keep it short.

## File naming

`docs/adr/NNNN-short-kebab-title.md` (zero-padded sequential number), and add the
file to `docs/adr/README.md` so the index stays complete.

## Structure

```markdown
# NNNN. <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context

What forces are at play? What problem or constraint makes a decision necessary?
State the alternatives that were genuinely considered.

## Decision

What we decided, in the active voice ("We will…"). Be specific.

## Consequences

What becomes easier and what becomes harder as a result. Include the costs and
the follow-on work, not just the benefits.
```

## Rules

- Record the decision, not a tutorial. Link to code or docs for detail.
- Don't rewrite history: once Accepted, supersede with a new ADR rather than
  editing the old one's decision.
