# Specs (vivas)

Este é o **único** diretório de specs vivas do projeto. Ele contém:

1. A **spec comportamental canônica** derivada do código (planilha CSV/XLSX,
   detalhada abaixo) — permanente, nunca arquivada.
2. **Specs funcionais / design docs** aprovadas que ainda não tiveram seu plano
   derivado executado. Skills e agentes (incluindo o plugin Superpowers) gravam
   specs novas aqui, com o nome `YYYY-MM-DD-<tema>-design.md`.

Quando o plano derivado de uma spec é concluído, a spec é movida para
[`../archive/specs/`](../archive/README.md). Regra completa em
[`../CONVENCOES.md`](../CONVENCOES.md#ciclo-de-vida-de-planos-e-specs).

## Specs funcionais vivas

Nenhuma no momento. (A última — refinamento operacional de Viagens/Line-Up/
Portal — teve seus planos WS1–WS4 executados e foi arquivada em 2026-07-18.)

## Behavioral Specification

This directory holds the **single canonical, code-derived behavioral
specification** for Transhipping Desk. It tracks every feature from
specification through verification in one spreadsheet.

This directory is the living source of truth. Dated CSV/XLSX pairs are editions:
the newest is canonical and older ones are historical snapshots.

## Canonical files

| File | Role |
|---|---|
| `<date>-behavioral-spec.csv` | **Source of truth** (edited directly, diffable, reviewable) |
| `<date>-behavioral-spec.xlsx` | View layer (filters + summary sheet), generated from the CSV |

Current edition: **`2026-07-02-behavioral-spec.{csv,xlsx}`**.

The CSV is edited by hand; the `.xlsx` is generated from it by
[`../../scripts/build-behavioral-spec.mjs`](../../scripts/build-behavioral-spec.mjs).
Regenerate the workbook after editing the CSV:

```bash
node scripts/build-behavioral-spec.mjs
```

Without an argument the script rebuilds the newest `*-behavioral-spec.csv` in
this directory; pass a path to target a specific edition.

## Scope

One row per feature across: all SPA routes, every `supabase.rpc(...)`, the three
Edge Functions (`provision-portal-user`, `notify-invoice-issued`,
`recalc-demurrage-ptax`), staff/portal auth, and every RLS table boundary, plus
security/financial triggers and jobs. Generic UI components and behaviourless
helpers are out of scope.

## Columns

`ID, Area, User Story, Expected Behavior (as implemented), Status, Defects,
Defect Type, Evidence, Source References, Open Questions / Notes`.

- **Status flow:** `Spec'd → Tested-Pass / Tested-Fail → Fixed → Verified`.
- **Evidence (strongest available):** `Vitest` (executed assertion) ›
  `SQL-contract` (`*Migration.test.ts`, detects SQL drift, not runtime) ›
  `Integration` (`src/integration/*`, not executed here) › `Static` (code read).

## Provenance

This edition was rebuilt from scratch against the executable repository at
`2026-07-02`: `src/App.tsx` (routes), the `supabase.rpc(...)` call sites,
`supabase/functions/`, the numbered migrations (`001`–`162`) and
[`../RASTREABILIDADE.md`](../RASTREABILIDADE.md), then driven through one QA loop
against the green Vitest suite (`npm test`).

All 139 rows are verified and carry no open defect. 108 are `Verified` — backed
by an executed `Vitest` or `SQL-contract` assertion; the remaining 31 are
`Verified (static)`, confirmed by static code read where the feature has no
executable surface in this environment (SQL triggers, `pg_cron` jobs, Edge
Functions, live-DB RLS). The `Evidence` column preserves the strength of each
verification. The two remaining
`Open Questions / Notes` (`OPS-ROUTE-01`, `VOY-ACC-02`) are design-intent
confirmations about pre-existing code, not defects.
