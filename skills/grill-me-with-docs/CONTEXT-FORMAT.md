# CONTEXT.md format

`CONTEXT.md` is a glossary and nothing else. It captures the ubiquitous language
of a context: the terms the team uses, defined precisely. It is not a spec, a
scratch pad, or a place for implementation details.

## Structure

```markdown
# Context: <name>

One or two sentences describing what this context is responsible for.

## Glossary

### <Term>

Definition in one or two sentences. State what the term means in this context,
and — when it helps — what it is explicitly *not* (to resolve overloaded words).

- **Synonyms / avoid:** other words people use for this, and which to prefer.
- **Related:** other terms it connects to.
```

## Rules

- One entry per term. Keep definitions short and precise.
- Devoid of implementation details — no table names, function names, or code.
- When a word is overloaded (e.g. "account" meaning two things), split it into
  distinct canonical terms and define each.
- Update entries inline as terms are resolved during a session, not in a batch.
