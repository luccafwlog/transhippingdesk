# CLAUDE.md

## Sources of truth

Read the relevant source before changing domain behavior, authentication,
security boundaries, billing, imports, routes, or database schema.

- `CONTEXT.md` — domain language.
- `docs/ARCHITECTURE.md` — current architecture and routes.
- `docs/RASTREABILIDADE.md` — traces every route/action to components, hooks,
  services, RPCs, and tests.
- `docs/adr/README.md` — indexes accepted and superseded decisions.
- `WORKFLOW.md` — development, migrations, testing, and deploy.
- `docs/CONVENCOES.md` — documentation style, evidence labels, and module
  structure.

Dated audits, specs, and plans are historical snapshots, not current truth. When
a historical document differs from current behavior, the executable repository
is authoritative: correct the living document and preserve the historical
record.

## Conventions

- Mark intentional simplifications with a `ponytail:` comment. If the shortcut
  has a known ceiling (global lock, O(n²) scan, naive heuristic), the comment
  names the ceiling and the upgrade path.
- Non-trivial logic leaves ONE runnable check behind (an assert-based demo or
  one small test; no frameworks, no fixtures). Trivial one-liners need no test.
- Fix a bug at the shared function after checking its callers, not one guard
  per call site.

## Documentation contract

Update living documentation in the same change when modifying routes, commands,
environment variables, migrations, auth contracts, operational procedures, or
architectural decisions. Preserve historical records; use a new ADR or an
editorial note for later decisions. Read `docs/README.md` before broad
documentation or architecture changes.

Plan/spec lifecycle (full rule in `docs/CONVENCOES.md`, "Ciclo de vida de
planos e specs"):

- Live plans go in `docs/plans/`; live specs go in `docs/spec/`. These are the
  ONLY locations — never create plans or specs under any other path.
- When a plan finishes executing, move it to `docs/archive/plans/` in the SAME
  change that completes the work, and remove its row from
  `docs/plans/README.md`. If the spec that produced it is in `docs/spec/`, move
  it to `docs/archive/specs/` too.
- Dated audits, reviews, and execution reports are born historical: write them
  directly to `docs/archive/audits/` or `docs/archive/reports/`.

## Gotchas

- `src/types/database.ts`, `src/lib/pix.ts`, and existing migration files are
  protected by `.claude/hooks/protect-files.sh`; do not bypass the guard
  without explicit authorization.
- Never execute the suspended reset script
  (`supabase/scripts/reset_operational_data.sql`); see
  `docs/operations/reset-ambiente.md` for the safe alternative.
- Project playbooks live in `skills/`. Hooks in `.claude/hooks/` also guard
  destructive commands and lint edited TypeScript.

## Verification

Run the narrowest relevant checks while working. Before completion, run
`npm run docs:check`, `npm run lint`, `npm test`, and `npm run build` when the
change can affect them. `npm run docs:check` is required after changing
Markdown, routes, ADRs, or playbooks.

After creating a pull request, monitor it ONLY until CI finishes for the pushed
commit: stay subscribed, fix CI failures and push, and once every check
completes green, report the green status, unsubscribe, and stop. Do NOT keep
watching until merge, and do NOT schedule recurring check-ins
(send_later/hourly polling) — that burns credits silently. Full babysitting
until merge is allowed only when the user explicitly asks to monitor, watch,
babysit, or autofix the PR.
