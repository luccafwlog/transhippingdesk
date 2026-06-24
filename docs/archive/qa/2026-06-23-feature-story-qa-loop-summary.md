# Feature-Story QA Loop — Result Summary (2026-06-23)

> Committed record of the QA loop completed by
> [`../superpowers/plans/2026-06-22-complete-feature-story-qa-loop.md`](../superpowers/plans/2026-06-22-complete-feature-story-qa-loop.md).
> The per-row ledger (`outputs/.../transhipping-desk-feature-audit.xlsx` and its
> `build-feature-audit.mjs` builder) is intentionally **untracked**; this file
> exists so the outcome is discoverable from the repository, not only from the
> machine that ran the loop.

## Headline outcome

| Metric | Result |
|---|---|
| User stories | **223 / 223 Passed** |
| Modules covered | 11 (see below) |
| Defects | **62 fixed / 0 open** |
| Unit/behavior suite | `npm test` — **729 pass / 9 skip** at close (now 734 pass after the post-QA additions) |
| Lint | `npm run lint` — green |
| Docs gate | `npm run docs:check` — green |
| Type + build | `tsc -b && vite build` — green |
| Whitespace | `git diff --check` — clean |
| DB replay | disposable PostgreSQL 17 — **148 / 148** RPC/migration assertions, 0 failed |

## Modules inventoried

The 223 stories were seeded from the executable routes in `src/App.tsx` and the
living module catalogs under [`../modules/`](../modules/). Coverage spans all 11
canonical modules:

| Module | Catalog | Primary routes |
|---|---|---|
| Viagens | [viagens.md](../modules/viagens.md) | `/viagens`, `/viagens/:voyageId` |
| Manifestos & EDI | [manifesto-edi.md](../modules/manifesto-edi.md) | `/manifestos`, `/carga-solta`, `/containers`, `/veiculos`, `/baplie`, `/vazios-importacao`, `/embarquevazios` |
| Granito | [granito.md](../modules/granito.md) | `/granito`, `/granito/taxas` |
| Chegadas/Saídas | [chegadas-saidas.md](../modules/chegadas-saidas.md) | `/chegadas-saidas` |
| Clientes | [clientes.md](../modules/clientes.md) | `/clientes`, `/clientes/:cnpj` |
| Taxas Locais | [taxas-locais.md](../modules/taxas-locais.md) | `/taxas-locais` |
| Faturamento | [faturamento.md](../modules/faturamento.md) | `/faturamento` |
| Demurrage | [demurrage.md](../modules/demurrage.md) | `/demurrage`, `/demurrage/taxas` |
| Conciliação PIX | [reconciliacao-pix.md](../modules/reconciliacao-pix.md) | `/reconciliacao` |
| Portal do Cliente | [portal-cliente.md](../modules/portal-cliente.md) | `/portal/*` |
| Operação & Suporte | [operacao-suporte.md](../modules/operacao-suporte.md) | `/painel`, `/revisao`, `/alertas`, `/relatorios`, `/line-up-tv`, `/admin/usuarios` |

## What the loop changed in the codebase

The most material defect class was **non-atomic write paths** — multi-step
mutations that could leave partial state on failure. These were converted to
transactional RPCs guarded by migrations and behavior tests:

- `save_granite_bl_review`
- `import_breakbulk_manifest_transactional`
- `set_import_batch_ce_master_atomic`
- `import_vazios_transactional`
- `save_bl_demurrage_config`

> 🗄️ These RPCs only take effect once their migrations under
> [`../../supabase/migrations/`](../../supabase/migrations/) are applied to the
> target Supabase project. Deployment to a controlled project is tracked as
> Task 6 of the post-QA backlog.

## Follow-up

The findings that surfaced *while writing the coverage* (not failing tests, but
improvements/divergences) are tracked in
[`../superpowers/plans/2026-06-23-post-qa-improvements.md`](../superpowers/plans/2026-06-23-post-qa-improvements.md).

Two defect IDs from this loop remain referenced directly in the test suite —
**DEF-061** and **DEF-062** (dedicated error states on `/admin/usuarios` for the
*logs* and *métricas* tabs), with behavior tests in
[`../../src/pages/__tests__/AdminUsuarios.behavior.test.tsx`](../../src/pages/__tests__/AdminUsuarios.behavior.test.tsx).

## Regenerating the full ledger

The full 223-row / 62-defect workbook is not committed. To reproduce it, re-run
the QA-loop plan (`2026-06-22-complete-feature-story-qa-loop.md`) which rebuilds
`transhipping-desk-feature-audit.xlsx` from the routes and module catalogs. If a
durable per-row record becomes necessary, promote `build-feature-audit.mjs` into
the repo (e.g. under `scripts/`) rather than committing the generated `.xlsx`.
