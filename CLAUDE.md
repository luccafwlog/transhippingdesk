# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.


Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

Not lazy about: understanding the problem (read it fully and trace the real flow before coding — a small diff you don't understand is just laziness dressed up as efficiency), input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested. Non-trivial logic leaves ONE runnable check behind (an assert-based demo or one small test; no frameworks, no fixtures). Trivial one-liners need no test.

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse it, don't rewrite.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it.

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size — lazy means less code, not the flimsier algorithm.
- Mark intentional simplifications with a `ponytail:` comment. If the shortcut has a known ceiling (global lock, O(n²) scan, naive heuristic), the comment names the ceiling and the upgrade path.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

Bug fix = root cause, not symptom: a report names a symptom. Grep every caller of the function you touch and fix the shared function once — one guard there is a smaller diff than one per caller, and patching only the path the ticket names leaves a sibling caller still broken.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Project Sources of Truth

- `CONTEXT.md` defines domain language.
- `docs/ARCHITECTURE.md` defines current architecture and routes.
- `docs/RASTREABILIDADE.md` traces every route/action to components, hooks, services, RPCs, and tests.
- `docs/adr/README.md` indexes accepted and superseded decisions.
- `WORKFLOW.md` defines development, migrations, testing, and deploy.
- Dated audits, specs, and plans are historical snapshots, not current truth.

Read the relevant source before changing domain behavior, authentication,
security boundaries, billing, imports, routes, or database schema.

## 6. Documentation Contract

Update living documentation in the same change when modifying routes, commands,
environment variables, migrations, auth contracts, operational procedures, or
architectural decisions. Follow `docs/CONVENCOES.md` for documentation style,
evidence labels, and module structure. Preserve historical records; use a new
ADR or an editorial note for later decisions.

Plan/spec lifecycle (full rule in `docs/CONVENCOES.md`, "Ciclo de vida de
planos e specs"):

- Live plans go in `docs/plans/`; live specs go in `docs/spec/`. These are the
  ONLY locations — never create plans or specs under any other path (e.g.
  `docs/superpowers/` is retired).
- When a plan finishes executing, move it to `docs/archive/plans/` in the SAME
  change that completes the work, and remove its row from
  `docs/plans/README.md`. If the spec that produced it is in `docs/spec/`,
  move it to `docs/archive/specs/` too.
- Dated audits, reviews, and execution reports are born historical: write them
  directly to `docs/archive/audits/` or `docs/archive/reports/`.

## 7. Verification

Run the narrowest relevant checks while working. Before completion, run
`npm run docs:check`, `npm run lint`, `npm test`, and `npm run build` when the
change can affect them. Never execute the suspended reset script.

---

## Claude Code integration

- Project playbooks live in `.claude/skills/`.
- Hooks in `.claude/hooks/` guard destructive commands, protected files, and
  edited TypeScript linting.
- `src/types/database.ts`, `src/lib/pix.ts`, and existing migration files are
  protected; do not bypass the guard without explicit authorization.
- Read `docs/README.md` before broad documentation or architecture changes.
- Run `npm run docs:check` after changing Markdown, routes, ADRs, or playbooks.
- After creating a pull request, do not auto-subscribe to its activity or
  schedule recurring check-ins. Report that the PR was opened and stop. Only
  watch/babysit a PR (webhook subscription + hourly check-ins) when the user
  explicitly asks to monitor, watch, babysit, or autofix it.

The executable repository is authoritative when a historical document differs
from current behavior. Correct the living document and preserve the historical
record.
