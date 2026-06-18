# Technical Audit — Transhipping Desk

**Date:** 2026-06-09 · **Scope:** full repository + live Supabase advisors · **Method:** static analysis, local verification (`npm test`, `npm run lint`, `npm run build`, `npm audit`), and Supabase database linter. No code was modified.

Verification status of every claim is labeled: **[verified]** = checked directly against files/command output; **[judgment]** = professional assessment; **[unverified]** = needs human/live confirmation.

---

## 1. Executive Summary

**Overall health grade: B-.** The application code is in genuinely good shape — disciplined layering (zero page→service violations), 286 passing unit tests, a clean build, an actively hardened RLS posture with 92 migrations, and unusually good internal documentation (10 ADRs, roadmap, validation scripts). What drags the grade down is not the code but the **delivery pipeline and the test/typing posture around the financial core**: every opened PR is squash-merged to `main` and deployed to production *before any check runs*, TypeScript strict mode is off across the entire codebase, and the PIX payment payload generator plus the billing/ledger services have no direct test coverage.

**Top 3 risks:**
1. `auto-merge-prs.yml` merges any opened PR to `main` with no review, no tests, no lint — merge happens *before* the build step (Critical).
2. `src/lib/pix.ts` (payment QR payloads on real invoices) and `src/services/billing.ts`/`billingLedger.ts` (money movement) have zero direct tests; a regression ships silently because CI runs no tests (High).
3. Live database advisors report 24 `SECURITY DEFINER` functions executable by `anon`, including state-mutating ones (`detect_overdue_invoices`, `emit_invoice_on_bl_ready`) (High, needs per-function verification).

**Top 3 opportunities:**
1. A single PR-validation workflow + branch protection converts the biggest risk into a non-issue in under two hours.
2. Enabling `strict` TypeScript incrementally would surface null/undefined bugs in financial math that nothing currently catches.
3. The 6 copy-paste import parsers and 2 near-duplicate invoice documents are ready for consolidation — high payoff because the roadmap says new carrier layouts arrive continuously.

---

## 2. Repo Map

**Purpose:** internal port-transhipment operations system (voyages, manifests, B/Ls, containers, vehicles, local-charge billing, demurrage, PIX reconciliation) plus an external customer portal. In production for a real company; mistakes affect real invoices. Maturity: production internal tool, single team, AI-assisted workflow (extensive `.claude/` hooks and skills).

**Stack [verified]:** React 19 + TypeScript ~6.0 + Vite 8 · Tailwind v4 · React Router 7 · TanStack Query 5 · Supabase (Postgres 17, Auth, RLS, 2 Edge Functions) · Zod 4 · Vitest 4 · Firebase Hosting · GitHub Actions. Note: CLAUDE.md claims jsPDF; it is **not** a dependency — PDFs are browser `window.print()` on styled React components.

**Architecture:** strict 3-layer SPA — `pages/` (one per route, lazy-loaded in `src/App.tsx`) → `hooks/` (React Query + domain logic) → `services/` (pure Supabase access + file parsers). Security boundary is the database: RLS everywhere, sensitive mutations via `SECURITY DEFINER` RPCs (ADR 0004). Two isolated Supabase clients (internal app vs portal, separate `storageKey`, `src/services/supabase.ts:30`).

| Area | Description |
|---|---|
| `src/pages/` (28) | One page per route; several are 1,000+ line god files |
| `src/hooks/` (19) | React Query hooks; only 1 of 19 has tests |
| `src/services/` (50+) | Supabase access, 8 file-import parsers, billing/ledger/demurrage logic |
| `src/lib/` | `pix.ts` (EMV payload), `fileGuard.ts` (10 MB upload cap), telemetry (console-only) |
| `supabase/migrations/` (92) | Sequential schema + RLS + RPCs; many hardening migrations |
| `supabase/functions/` | `notify-invoice-issued` (Resend email), `provision-portal-user` |
| `.github/workflows/` | `auto-merge-prs.yml` (merge+deploy on PR open), `firebase-deploy.yml` (deploy on push to main) |
| `.claude/` | Bash guards, protected-file hooks, 11 project skills — unusually mature AI-dev setup |
| `docs/` | ARCHITECTURE, ROADMAP, VALIDACAO, RESET, 10 ADRs, plans |

**Surprises found during discovery:**
- The deploy pipeline *is* the merge pipeline: opening a PR deploys it (README documents this as intended — "Fluxo dinâmico").
- No `strict` in any tsconfig despite heavy financial logic.
- 8 "migration tests" assert SQL files by regex (e.g. `src/services/__tests__/ledgerPixPayloadMigration.test.ts`) — they catch file drift, not behavior.
- Verified health: `npm test` 286 passed / 9 skipped · `npm run lint` 1 warning, 0 errors · `npm run build` clean · `npm audit --omit=dev` 1 high (xlsx).

---

## 3. Audit Report

### 3.1 CI/CD & Operations

| # | Finding | Evidence | Why it matters | Severity |
|---|---|---|---|---|
| F1 | **Any opened/reopened PR is squash-merged to `main` immediately, then built and deployed.** Merge is step 1 (`.github/workflows/auto-merge-prs.yml:14-26`); build only happens after (`:40-45`). No tests, no lint, no review, no status checks. **[verified]** | `auto-merge-prs.yml:3-26` | Anyone (or any automation) who can open a PR ships to production. A broken build still lands on `main` (deploy fails after merge). The privilege-escalation bug fixed in migration `20260530102906` is the type of thing review would have caught earlier. | **Critical** |
| F2 | **No CI runs `npm test` or `npm run lint`, ever.** Both workflows go `npm ci` → `npm run build` → deploy. **[verified]** | `auto-merge-prs.yml:37-45`, `firebase-deploy.yml:20-27` | 286 existing tests are decorative from a release-safety standpoint; parser/billing regressions deploy silently. | **Critical** |
| F3 | **Zero production observability.** Errors go to `console.warn`/`console.error` only (`src/lib/telemetry.ts:18`, `src/components/ErrorBoundary.tsx`); no Sentry/alerting/metrics. **[verified]** | `src/lib/telemetry.ts` | A systemic failure (all demurrage calcs erroring, portal login broken) is discovered when a customer calls, not before. | **High** |
| F4 | No staging/preview environment; deploys go straight to the live Firebase channel (`channelId: live`). **[verified]** | `auto-merge-prs.yml:51` | Combined with F1/F2 there is no pre-production gate of any kind. | Medium |

### 3.2 Security

| # | Finding | Evidence | Why it matters | Severity |
|---|---|---|---|---|
| F5 | **Live advisor: 24 `SECURITY DEFINER` functions executable by `anon`**, incl. state-mutating `detect_overdue_invoices()`, `emit_invoice_on_bl_ready()`, `mark_obsolete_consolidated_links()`, and data-returning `get_consolidated_invoice_item_breakdown(bigint)`. Some anon grants are by design (portal_login etc., token-gated internally), but trigger functions and internal billing functions should not be RPC-callable by anon. **[verified via live Supabase security advisor; each function's internal guards unverified]** | Supabase linter `anon_security_definer_function_executable` ×24; cf. partial revokes in `supabase/migrations/20260530102907` and `20260608192000` | The revoke pattern exists but wasn't applied comprehensively; the attack surface of unauthenticated RPC endpoints is larger than the team believes. | **High** |
| F6 | **`xlsx@0.18.5` has known high-severity advisories** (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9), no fix on npm; parses user-supplied files in 7+ parsers. Mitigations exist: 10 MB cap (`src/lib/fileGuard.ts:4`) and authenticated-internal-users-only access; risk is documented in `docs/ROADMAP.md:41`. **[verified via npm audit]** | `package.json:26`, `src/services/manifestParser.ts:128` | Malicious spreadsheet → client-side DoS or prototype pollution in the importing user's session. Known and accepted by the team, but the fixed SheetJS distribution (CDN-hosted `0.20.x`) has been available for a long time. | **High** |
| F7 | Supabase Auth **leaked-password protection is disabled**. **[verified via live advisor]** | advisor `auth_leaked_password_protection` | Internal + portal users can set pwned passwords; one toggle to fix. | Medium |
| F8 | Admin gating in the SPA is client-side (`src/components/layout/ProtectedRoute.tsx:29`, `adminOnly` in `src/App.tsx`), **but** RLS + `is_admin()` enforce server-side, so this is defense-in-depth working as designed. **[verified]** | — | Acceptable; no action needed beyond keeping RLS authoritative. | Low |
| F9 | No hardcoded secrets found anywhere (src/, supabase/, workflows, .claude/). Edge functions have allowlisted CORS, HTML-escaping for email fields, persistent rate limiting. CSP without `unsafe-inline` scripts in `firebase.json`. **[verified]** | `supabase/functions/provision-portal-user/index.ts:23-38` | Strength — see §3.7. | — |

### 3.3 Testing

| # | Finding | Evidence | Why it matters | Severity |
|---|---|---|---|---|
| F10 | **`src/lib/pix.ts` has zero tests.** It hand-implements EMV TLV + CRC16 for payment QR codes printed on real invoices; CLAUDE.md itself marks it "do not touch without careful validation" — yet there is no validation harness. Only consumer: `demurrageInvoices.ts:3` and DB-side duplicate function. **[verified — no test file exists, grep confirms]** | `src/lib/pix.ts:3-45` | A one-character regression makes every QR code unscannable; nothing would catch it (see F2). | **High** |
| F11 | **`billing.ts` (820 lines) and `billingLedger.ts` have no direct service tests** — only mocked contract tests (`billingHelpers.test.ts` mocks both supabase and the PIX builder). Same for `voyages.ts` and all 4 `services/charges/*` files. **[verified]** | `src/services/__tests__/billingHelpers.test.ts:1-20` | The money-handling core relies entirely on the opt-in integration suite + manual validation scripts. | **High** |
| F12 | 18 of 19 hooks untested (only `useRowSelection`). **[verified]** | `src/hooks/__tests__/` | Cache invalidation and mutation error paths unverified. | Medium |
| F13 | The 8 "ledger*Migration" tests **regex-match SQL file text**, not behavior (e.g. asserts the file contains `CREATE OR REPLACE FUNCTION public.build_transshipping_pix_payload`). **[verified]** | `src/services/__tests__/ledgerPixPayloadMigration.test.ts` | Useful drift guards, but they give a false sense of coverage for ledger logic. **[judgment]** | Medium |
| F14 | Where tests exist they are good: parser tests use real workbook fixtures (`manifestFixtures.real.test.ts`), demurrage calc tests assert boundary days/rate bands, component tests use Testing Library with real interactions. **[verified]** | `src/services/demurrage/__tests__/calculateDemurrage.test.ts` | Strength — the testing culture is solid; the gap is *placement*, not skill. | — |
| F15 | No E2E/smoke automation; `docs/VALIDACAO.md` is a manual script. **[verified]** | `docs/VALIDACAO.md` | Releases depend on humans re-running checklists. | Medium |

### 3.4 Type safety & code quality

| # | Finding | Evidence | Why it matters | Severity |
|---|---|---|---|---|
| F16 | **TypeScript `strict` mode is off project-wide** — no `strict`, `strictNullChecks`, or `noImplicitAny` in any tsconfig. **[verified]** | `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.json` | In a system multiplying currency amounts and computing date diffs, null/undefined holes are exactly the bug class strict mode exists to catch. This silently weakens the entire generated-types investment (`database.ts` nullability is not enforced at call sites). | **High** |
| F17 | 31 `as any` / `as unknown as` casts outside tests, concentrated where Supabase nested-select results are reshaped: `src/services/billing.ts:288,396,452,505`. **[verified]** | `billing.ts:288` `rows: (data ?? []) as unknown as InvoiceListRow[]` | Casts on invoice rows bypass the one machine check the financial path has. | Medium |
| F18 | **God pages:** `BlDetalhe.tsx` 1,379 lines/14 useState; `Viagens.tsx` 1,205/12; `Faturamento.tsx` 1,101/19; `TaxasLocais.tsx` 1,074/11. Each mixes list+detail+modals+forms+mutations. **[verified counts; "too big" is judgment]** Already acknowledged in `docs/ROADMAP.md:23`. | `src/pages/*.tsx` | Every change to billing UX touches a 1,100-line file with 19 pieces of state; regression risk and merge conflicts concentrate here. | Medium |
| F19 | **8 import services (~3,500 lines) each reimplement** header normalization, row validation, error collection, and xlsx buffer handling with no shared core. **[verified by agent comparison]** | `manifestImport.ts`, `breakbulkImport.ts`, `vehicleImport.ts`, `vaziosImport.ts`, `vaziosImportacaoImport.ts`, `graniteImport.ts`, … | ROADMAP says new carrier layouts arrive iteratively — each one currently costs a full reimplementation and its own bug surface. | Medium |
| F20 | ~70% structural duplication between `components/billing/InvoiceDocumentLocal.tsx` (198 lines) and `components/demurrage/InvoiceDocument.tsx` (235) — same formatting helpers, table skeleton, fiscal block. **[verified by agent comparison]** | both files | Invoice layout fixes must be applied twice; they will drift. | Medium |
| F21 | Two `react-hooks` lint rules disabled globally (`eslint.config.js:23-24`); `src/services/supabase.ts:18` silently falls back to a localhost client when env vars are missing (console.error only — no user-facing failure). **[verified]** | cited lines | Misconfigured production build renders a broken-but-alive app instead of failing fast. | Medium |
| F22 | Imprecise cache invalidation: `invalidateQueries({ queryKey: ['bl-detail'] })` without ID in 3 files refetches every open BL. **[verified by agent]** | `ContainerDatesImportModal.tsx`, `CeMercanteImportModal.tsx`, `Veiculos.tsx` | Wasteful but correct; cosmetic. | Low |

### 3.5 Performance (live database)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F23 | Live advisors: **12 `auth_rls_initplan` warnings** (RLS policies re-evaluate `auth.uid()`/`current_setting()` per row) and **15 `multiple_permissive_policies`** warnings (multiple permissive policies evaluated per query, some for `anon`). **[verified via live performance advisor]** | e.g. `audit_logs_insert_self` policy; `demurrage_rates` has overlapping anon SELECT policies | Medium |
| F24 | Duplicate index on `invoices` (`idx_invoices_customer_issued` ≡ `idx_invoices_customer_issued_at`); 60 unindexed FKs; 11 unused indexes. **[verified via advisor]** | advisor output | Low |
| F25 | One write loop: `confirmUnifiedPixReconciliation()` updates demurrage invoices one query per match. **[verified by agent]** | `src/services/billing.ts` (reconciliation section) | Low |

Frontend performance is healthy: lazy routes, vendor chunking, xlsx dynamically imported (`vite.config.ts:31-46`), build output well-sized. **[verified]**

### 3.6 Documentation

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F26 | CLAUDE.md stack table claims **jsPDF**; it isn't in `package.json` and nothing imports it — PDFs are `window.print()`. **[verified]** | `CLAUDE.md` stack table; `Faturamento.tsx:775,796` | Low |
| F27 | `WORKFLOW.md:49,113` says **79 migrations**; there are **92**. **[verified]** | `ls supabase/migrations | wc -l` | Low |
| F28 | Everything else checked (README, CONTEXT, ARCHITECTURE mermaid flow, ROADMAP, ADR index) is accurate and current — rare for an internal tool. **[verified]** | — | — |

### 3.7 Strengths (preserve these)

1. **Layering discipline:** zero pages import services directly — the ADR-0003 rule is actually enforced in practice. **[verified by exhaustive grep]**
2. **Database-first security** with visible iteration: privilege-escalation trigger fix (`20260530102906`), anon revokes, search_path pinning, portal session isolation via separate `storageKey`, persistent rate limiting, no `dangerouslySetInnerHTML` anywhere, escaped email HTML, allowlisted CORS in edge functions.
3. **Test quality where tests exist** — real fixtures, boundary assertions, Testing Library idioms.
4. **Documentation culture:** 10 ADRs, accurate architecture diagram, roadmap with an honest risk register (xlsx CVE and god pages are *already known and tracked*).
5. **AI-dev guardrails:** `.claude/hooks/guard-bash.sh` (tokenizing, not regex), `protect-files.sh` shields `database.ts`/`pix.ts`/migrations, auto-lint on edit.
6. Centralized React Query keys (`src/services/queryKeys.ts`), generated DB types used broadly, controlled hard-delete with audit trail (ADR 0009).

---

## 4. Improvement Strategy

### Theme A — "The pipeline trusts everything; the code trusts nothing"
All the database hardening is undermined by a delivery pipeline with zero gates. **Target state:** no code reaches `main` without lint + typecheck + tests passing and (for non-owner PRs) review; deploy only from `main`. **Principle:** the cheapest test is the one that runs automatically. **Trade-off:** you lose the "open PR = instant deploy" speed the README celebrates. Keep the speed by letting CI auto-merge *after* checks pass instead of before — same workflow, gates first.

### Theme B — The financial core has no machine-checked safety net
PIX payloads, billing, and ledger logic are protected only by manual validation scripts and an opt-in integration suite. **Target state:** golden-vector tests for `pix.ts`; characterization tests for `billing.ts`/`billingLedger.ts` invoice math and status transitions; `strict: true` enforced. **Principle:** test intensity proportional to blast radius — and nothing here has a bigger blast radius than payments. **Trade-off:** mocked Supabase tests won't catch RPC/RLS behavior; accept that and lean on the existing integration suite for those, rather than building a heavyweight test-DB harness now.

### Theme C — Security posture is excellent at the policy level, leaky at the grant level
The team writes targeted revoke migrations but the live linter still shows 24 anon-executable definer functions. **Target state:** default-deny — every new function gets `REVOKE ... FROM PUBLIC, anon` at creation; advisor output is clean except documented portal exceptions. **Principle:** make the safe pattern the default, not a follow-up migration.

### Theme D — Growth by copy-paste in parsers and pages
New carrier layouts and invoice types are added by duplicating 500–1,000-line units. **Target state:** a small shared import-parser core (header normalization, row validation, error report) and one invoice-document skeleton; god pages decomposed opportunistically *after* tests exist (the roadmap already commits to this ordering — keep it). **Trade-off:** do **not** build a generic "import framework" — extract only the three helpers all 8 parsers visibly share. CLAUDE.md's "simplicity first" rule is right.

### Explicitly NOT recommended (effort vs payoff)
- **Don't** replace `window.print()` with jsPDF — current approach works; fix the doc instead (F26).
- **Don't** chase hook unit-test coverage (F12) as a goal; cover hooks incidentally when pages get decomposed.
- **Don't** add Playwright E2E before CI gates exist — gates first, smoke tests later.
- **Don't** swap xlsx for ExcelJS this quarter — the team's documented mitigation is reasonable; vendor the fixed SheetJS CDN build (`0.20.x`) when the dedicated parser-validation PR happens (ROADMAP backlog already says this).
- **Don't** index all 60 unindexed FKs — most are write-rarely audit columns; act only on advisor warnings tied to slow queries.

### Definition of done (measurable)
- CI fails PRs on lint errors, `tsc -b` errors, or test failures; auto-merge only fires after a green check suite. Branch protection requires the check.
- `src/lib/pix.ts` has tests with ≥3 externally validated payload vectors; billing/ledger status transitions covered by unit tests.
- `npm run build` passes with `"strict": true` in `tsconfig.app.json`.
- Supabase security advisor: 0 WARN for `anon_security_definer_function_executable` outside a documented portal allowlist; leaked-password protection ON.
- Errors from production reach a monitored destination (Sentry or equivalent) with release tagging.

---

## 5. Task Plan

### Milestone 0 — Safety net (do this week)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends |
|---|---|---|---|---|---|---|
| T1 | **PR validation workflow**: new `ci.yml` running `npm ci`, `npm run lint`, `npm run build` (includes `tsc -b`), `npm test` on `pull_request` | `.github/workflows/ci.yml` | A PR with a failing test shows a red check | **S** | None (additive) | — |
| T2 | **Re-sequence auto-merge behind checks**: change `auto-merge-prs.yml` to enable GitHub auto-merge (or merge only after T1's check concludes successfully) instead of merging on open; enable branch protection on `main` requiring the T1 check | `.github/workflows/auto-merge-prs.yml`, repo settings | Opening a PR with broken tests does NOT merge or deploy; green PRs still auto-merge with no human action | **S** | Low — preserves the team's zero-touch flow | T1 |
| T3 | **PIX golden tests**: unit tests for `pixCRC16`, `pixTLV`, `buildTransshippingPixPayload` against externally validated EMV vectors (decode current production payload with a bank app/validator to capture the baseline) | new `src/lib/__tests__/pix.test.ts` | ≥3 full-payload vectors + CRC vectors pass; test fails if any byte of the payload changes | **S** | None (test-only) | — |
| T4 | **Fail fast on missing Supabase env**: render a configuration-error screen when `isSupabaseConfigured` is false instead of a broken app | `src/services/supabase.ts`, `src/main.tsx` | Build without env vars shows explicit error page | **S** | Low | — |

### Milestone 1 — Critical/security fixes

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends |
|---|---|---|---|---|---|---|
| T5 | **Comprehensive anon revoke migration**: enumerate the 24 flagged functions; `REVOKE EXECUTE FROM anon` on all non-portal ones (incl. trigger functions); document the portal allowlist in an ADR; adopt revoke-at-creation in the supabase-migration skill | new migration; `docs/adr/` | Security advisor: 0 anon WARNs outside allowlist; portal login/billing/operation flows still work (run `docs/VALIDACAO.md` portal section) | **M** | Medium — could break portal if a needed grant is revoked; test each portal flow | — |
| T6 | Enable **leaked-password protection** in Supabase Auth; review `pg_trgm` schema placement | Supabase dashboard/config | Advisor WARN cleared | **S** | Low | — |
| T7 | **Billing/ledger characterization tests**: unit tests for invoice status transitions (`faturamentoInvoiceStatus` exists but service-level gaps remain), `createInvoiceFromBls` argument assembly, consolidation selection, settlement guards — mock at the Supabase boundary | `src/services/__tests__/billing.test.ts`, `billingLedger.test.ts` | Status-machine and money-math paths covered; mutation payloads asserted | **L** | None | T1 |
| T8 | **Remove the 4 unsafe casts in billing.ts** with typed row schemas (Zod parse or generated-type selects) | `src/services/billing.ts:288,396,452,505` | No `as unknown as` in billing.ts; tests still green | **M** | Medium — touching live billing reads; do after T7 | T7 |

### Milestone 2 — High-leverage improvements

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends |
|---|---|---|---|---|---|---|
| T9 | **Enable `strict: true` incrementally**: turn on in `tsconfig.app.json`, fix fallout module-by-module (start `lib/` + `services/`, then hooks, then pages; use targeted `// TODO strict` suppressions where needed and burn them down) | all of `src/` | `npm run build` green with strict on; suppression count tracked and shrinking | **XL** → break into per-layer PRs | Medium — type fixes can change runtime behavior in subtle ways; lean on T1 gates + T3/T7 tests | T1, T3, T7 |
| T10 | **Error reporting**: wire Sentry (or equivalent) into `ErrorBoundary`, `reportBestEffortFailure`, and a global `onunhandledrejection`; tag releases with `VITE_APP_COMMIT_SHA` (already injected in build) | `src/lib/telemetry.ts`, `src/components/ErrorBoundary.tsx`, `index.html` CSP `connect-src` | A thrown error in production appears in the dashboard with commit SHA | **M** | Low | — |
| T11 | **Shared import-parser core**: extract header-normalization map helper, row-error collector, and xlsx buffer-read wrapper used by all 8 parsers; migrate 2 parsers (e.g. `vaziosImport`, `graniteImport`) as proof, then others opportunistically | `src/services/` (new `importCore.ts`), parsers | New carrier layout requires only column map + row schema; existing parser fixture tests unchanged and green | **L** | Medium — parsers are production-critical; migrate one at a time behind fixtures | T1 |
| T12 | **RLS performance pass**: wrap `auth.uid()`/`current_setting()` in `(select ...)` for the 12 flagged policies; consolidate the 15 multiple-permissive-policy overlaps; drop duplicate `invoices` index | new migration | Performance advisor WARNs cleared | **M** | Medium — policy rewrites must be behavior-identical; verify with integration suite | T5 |

### Milestone 3 — Quality & polish

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Depends |
|---|---|---|---|---|---|---|
| T13 | Decompose `Faturamento.tsx` (worst: 19 useState) into tab/modal subcomponents + extracted hooks; then `BlDetalhe.tsx`; one page per PR, tests first (roadmap already mandates this ordering) | `src/pages/Faturamento.tsx`, `src/pages/BlDetalhe.tsx` | No file >600 lines in the decomposed page; behavior unchanged (existing helper tests + manual VALIDACAO section) | **XL** → one page = L | Medium-high | T7, T9 |
| T14 | Merge invoice documents into one skeleton with slots (local vs demurrage) | `src/components/billing/InvoiceDocumentLocal.tsx`, `src/components/demurrage/InvoiceDocument.tsx` | Single source for fiscal block/table/PIX block; print output visually identical | **M** | Medium (visual regression — compare printed PDFs) | — |
| T15 | Docs sync: remove jsPDF from CLAUDE.md, fix 79→92 (or make count generic) in WORKFLOW.md, document `window.print()` approach in invoice-pdf skill | `CLAUDE.md`, `WORKFLOW.md` | Docs match reality | **S** | None | — |
| T16 | Re-enable the 2 disabled `react-hooks` ESLint rules; fix violations or scope per-file disables | `eslint.config.js` | Rules on globally; zero global disables | **M** | Low | T1 |
| T17 | Playwright smoke suite (login → import fixture manifest → invoice issue → portal view) run on PRs, replacing the most-repeated parts of `docs/VALIDACAO.md` | new `e2e/` | Smoke runs green in CI against a seeded branch DB | **L** | Low | T1, T2 |
| T18 | Batch the demurrage update loop in PIX reconciliation; tighten the 3 broad `bl-detail` invalidations | `src/services/billing.ts`, 3 modal files | One round-trip per reconciliation batch | **S** | Low | T7 |

### Quick wins (high impact, S effort — can all be done immediately)
- **T1 + T2** — the single highest-leverage change in the entire audit (~2h total).
- **T3** — PIX golden tests (~1h).
- **T6** — leaked-password protection toggle (minutes).
- **T15** — docs sync (~30min).
- Duplicate `invoices` index drop (part of T12, can ship alone, minutes).

### Implementation sketches — top 3

**T1+T2 (CI gates + gated auto-merge).** Add `ci.yml` triggered on `pull_request` with steps: checkout → setup-node 20 (npm cache) → `npm ci --legacy-peer-deps` → `npm run lint` → `npm run build` → `npm test`. Then rewrite `auto-merge-prs.yml`: instead of calling `pulls.merge` on open, call `gh pr merge --auto --squash` (GraphQL `enablePullRequestAutoMerge`) so GitHub merges only after required checks pass; move the deploy steps into `firebase-deploy.yml` (already triggers on push to `main`, so post-merge deploys keep working unchanged — note it currently duplicates the deploy job; the auto-merge workflow's own build/deploy steps become redundant and should be deleted). Gotchas: branch protection with required status check `ci` must be enabled in repo settings or auto-merge fires immediately; `GITHUB_TOKEN` needs `contents: write` for auto-merge enablement; keep `--legacy-peer-deps` (lockfile currently requires it).

**T3 (PIX golden tests).** `pixCRC16` has public test vectors (CRC-16/CCITT-FALSE: `"123456789"` → `0x29B1`). For full payloads: take one real production payload (from an issued invoice's QR or by running `buildTransshippingPixPayload(123.45, 'TESTTXID')` on current `main`) and validate it externally with a PIX decoder/bank app *before* freezing it as the golden value — the point is to certify today's behavior, then lock it. Add edge cases: zero/negative value omits field 54, txid sanitization (`***` fallback), 25-char name truncation. Gotcha: `protect-files.sh` shields `src/lib/pix.ts` itself — tests live in a new file, so no override needed.

**T5 (anon revoke migration).** Query `information_schema.routine_privileges` (or the advisor list verbatim) for `grantee = 'anon'` on `public` SECURITY DEFINER functions. Allowlist (by design, token/auth-gated internally): `portal_login`, `portal_logout`, `portal_check_auth_method`, `resolve_customer_portal_session`, `current_portal_customer_id`, and the `portal_*` listing functions **only if** the portal session model still requires anon-phase calls — verify against `usePortalAuth.tsx` and migration `20260603130350` (auth.uid rework may have made authenticated-only sufficient, which would be even better). Everything else: `REVOKE EXECUTE ... FROM anon;` — trigger functions additionally `REVOKE ... FROM authenticated` (PostgREST shouldn't expose them, but defense-in-depth). Validate by re-running the security advisor and the portal section of `docs/VALIDACAO.md`. Gotcha: function signatures must match exactly in REVOKE (overloads like the two `create_invoice_from_granite_bls` variants).

---

## 6. Open Questions (need a human decision)

1. **Is "open PR = instant production deploy" a deliberate product decision** for a solo/AI-driven workflow, or an accident of convenience? T2 preserves zero-touch merging behind green checks — but if even check-gating is unwanted, say so and we'll at least gate the *deploy* rather than the merge.
2. **Which portal RPCs truly require `anon` execution** after the `auth.uid()` rework (`20260603130350`)? If portal sessions are now full Supabase Auth sessions, the anon allowlist in T5 may shrink to just `portal_check_auth_method` + login-path functions.
3. **PIX payload baseline:** is there a known-good production payload (a paid invoice) we can freeze as the golden vector, and can someone validate one payload in a banking app before we lock the tests? Also: the DB has its own `build_transshipping_pix_payload` SQL function — which one is authoritative, and should the TS one delegate or be cross-tested against it?
4. **Observability budget:** Sentry free tier suffices technically — any policy constraint on sending error payloads (which may contain B/L numbers/customer names) to a third-party service? If yes, a self-hosted GlitchTip or log-only alternative changes T10.
5. **xlsx replacement timing:** ROADMAP defers until "a dedicated PR with parser validation." Does T11 (shared parser core, with fixtures green) count as that opportunity? It's the natural moment to swap in the patched SheetJS CDN build.
6. **Integration suite cadence:** it never runs in CI by design. Is there an isolated Supabase project (branch database) where it could run nightly? That would materially de-risk T5, T9 and T12.
