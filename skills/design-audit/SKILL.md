---
name: design-audit
description: >
  Full-site UI/UX audit playbook for Transhipping Desk: boot the real app
  against a local Supabase-compatible stack, screenshot every page (desktop +
  mobile), audit like a senior design lead, prioritize P0-P3, apply safe small
  fixes, and write the report to docs/design-audit/. Use after every release,
  or when the user asks for a design review, UI audit, screenshot pass, or
  "rerun the design audit".
---

# Design Audit Playbook

Audit the product as a senior design lead on their first day: judge whether a
normal user can **understand** the product, **trust** it, and **finish the
core action** (manifesto → revisão → taxas → fatura) without docs — not
whether the UI looks nice.

## Phase 1 — Boot the real site

The remote sandbox cannot reach `*.supabase.co`, so the app runs against a
local stack. All pieces live in `scripts/design-audit/`.

1. **Postgres 16 local** (install if missing: `apt-get install -y postgresql-16
   postgresql-contrib postgresql-16-cron`, add `shared_preload_libraries='pg_cron'`
   and `cron.database_name='app'` to postgresql.conf, `pg_ctlcluster 16 main start`).
2. **Create DB + Supabase scaffolding**: `su postgres -c "createdb app"` then
   apply `scripts/design-audit/bootstrap.sql` (roles anon/authenticated/service_role,
   schema `auth` com `auth.uid()/role()/jwt()`, extensions pgcrypto/pg_trgm/pg_cron).
3. **Migrations**: apply every file in `supabase/migrations/*.sql` in order with
   `ON_ERROR_STOP=1`. They must pass cleanly — a failure here is a real finding.
4. **Grants** (Supabase faz isso automaticamente; local não):
   `grant usage on schema public to anon, authenticated, service_role;`
   `grant all on all tables/sequences in schema public to authenticated, service_role;`
   `grant execute on all functions in schema public to authenticated, anon, service_role;`
5. **Seed**: apply `supabase/seeds/validation_seed.sql` then
   `scripts/design-audit/seed_audit.sql` (synthetic data only — **never copy
   production rows**; that was explicitly denied once and stays denied).
   Login user: `auditor@local.test` / `audit-local` (admin).
6. **Shim**: `node scripts/design-audit/sb-shim.cjs &` — emulates the PostgREST
   + GoTrue subset the app uses, on port 54321. If a page logs a 400 from
   `/sb-proxy/rest/...`, check the shim log: it may be an unsupported PostgREST
   feature (extend the shim) **or a real app bug** (column that doesn't exist —
   that's how the granite_bls.updated_at production bug was found).
7. **App**: write `.env` with `VITE_SUPABASE_URL=http://127.0.0.1:5173/sb-proxy`
   and any anon key; the `/sb-proxy` proxy in `vite.config.ts` forwards to the
   shim. Run `npm run dev -- --port 5173 --host 127.0.0.1`.
8. Browser TLS in this sandbox: add the proxy CAs from
   `/usr/local/share/ca-certificates/*.crt` to `~/.pki/nssdb` via `certutil`
   (package `libnss3-tools`), and symlink Chromium if the Playwright MCP expects
   `/opt/google/chrome/chrome`.

Known environment artifacts (do NOT report as product bugs): Google Fonts and
the BCB PTAX API are blocked by the egress proxy; realtime websockets fail
against the shim.

## Phase 2 — Screenshot every page

Use the Playwright MCP. Log in once, then for each route: navigate → wait 2s →
screenshot to `docs/design-audit/assets/` (viewport 1440×900; `fullPage` for
long list pages). Routes: `/login` (+ error state with wrong password),
`/painel`, `/viagens` (+ Nova Viagem modal), `/manifestos`, `/containers`,
`/carga-solta`, `/veiculos`, `/manifestos/:blId`, `/revisao`, `/clientes`,
`/clientes/:cnpj`, `/taxas-locais`, `/taxas-locais/tabelas` (+ Detalhes modal),
`/alertas`, `/relatorios`, `/demurrage`, `/demurrage/taxas`, `/reconciliacao`,
`/granito`, `/granito/taxas`, `/embarquevazios`, `/vazios-importacao`,
`/baplie`, `/line-up-tv/display`, `/admin/usuarios`, `/portal/login`.

Then a **mobile pass** at 390×844 for at least: login, painel, manifestos,
faturamento — check that wide tables scroll horizontally instead of crushing.

After each page, check the browser console and the shim log — console errors
and silent query failures are audit findings, often the most important ones.

Screenshots come out at full resolution but may render small when read back;
crop regions with PIL to inspect dense tables.

## Phase 3 — Audit dimensions

Score each page against: first impressions · navigation · visual hierarchy ·
component consistency · loading/empty/error states · trust signals ·
conversion paths. Watch for this product's recurring failure patterns:

- raw machine codes in the UI (`PENDING_REVIEW`, `Approved`, `active`)
- PT/EN language mixing
- silent data failures (query fails → list renders incomplete, no warning)
- destructive actions styled like secondary actions
- pt-BR formatting gaps (dates, thousand separators)

## Phase 4 — Prioritize and fix

- Tag every issue P0–P3 and which axis it hurts: Entendimento / Confiança /
  Conversão, with the specific fix.
- **Fix on the spot** only safe small stuff: copy, label maps, spacing, CSS
  min-widths, button hierarchy, display-only formatting. Run `npx tsc -b`,
  `npm run lint`, `npm test` after fixes and re-screenshot to verify.
- **Never touch**: payment/PIX logic (`src/lib/pix.ts`), delete flows, RLS,
  anything that mutates money or data semantics. Those become recommendations.
- End the report with: top 5 issues hurting conversion + top 5 quick wins.

## Phase 5 — Report

Write/update `docs/design-audit/README.md` (date, commit, method, fixed-now
table with before/after evidence, P0–P3 tables, dimension summary, top-5s).
Reference screenshots by relative path. Commit, push, open PR.
