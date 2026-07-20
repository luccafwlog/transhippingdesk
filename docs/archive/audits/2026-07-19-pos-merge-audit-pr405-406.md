# Detailed audit: merged PRs #405 and #406

Audit date: 2026-07-19 (America/Sao_Paulo)  
Repository: `luccafwlog/transhippingdesk`  
Audited current state: `origin/main` at `9da9bb7`  
Method: merge-parent diffs, archived design/implementation plans, PR review history, current executable state, focused and full local verification. All line references below are to the current `origin/main`, not to the stale local checkout.

## Executive verdict

**Not safe to treat as fully complete yet. There are 2 release-blocking P1 authorization defects, 13 P2 correctness/completeness defects, and 1 P3 documentation defect.**

The most important issue is that both PRs rely on frontend `can(...)` checks while their write paths still authorize every active internal user at the database boundary. This directly contradicts the documented “Dupla proteção RBAC” invariant. A Financeiro user can call the COD/customer APIs directly even though the buttons are hidden or disabled.

Six P2 findings were also raised by the automated Codex reviewer only after the merge events (three per PR). They remain present on `origin/main`; their review threads were not resolved. The only commit after PR #406 is unrelated documentation commit `9da9bb7`, so none of the findings below has been superseded.

## Merge topology and review context

### PR #405 — B/L Cockpit 360°

- Merge commit: `c69112322c0a25f50c53725b5872b5a52ae5c3ab`
- First parent: `44c1322e7a18be85ddae4dac26cfb238f034fcb9`
- Merged branch head / second parent: `faf88fdf74734df78d26db8b170e8d0f59b82964`
- Merge delta: 44 files, `+2036/-294`
- Branch commits: `807f714`, `ff7a850`, `ace2e82`, `e9dc78`, `1b641b2`, `87b4462`, `066f360`, `505fa9`, `faf88fd`
- Plan/spec: `docs/archive/plans/2026-07-18-bl-cockpit-360.md` and `docs/archive/specs/2026-07-18-bl-cockpit-design.md`
- Intended scope: four persisted document fields; document-replica Details tab; freight display; operational/financial rails; default Overview; per-B/L transshipment/COD action; Portal and Baplie cards; migrations 205/206; docs lifecycle.
- Earlier Claude feedback was largely addressed by `faf88fd` (insert branch, COD reverse lookup, duplicate diffs, null Baplie link, query-key invalidation, formatting, 0/0 state, docs table). The later Codex review identified findings 405-02 through 405-04 below after merge.

### PR #406 — Ficha do Cliente hub

- Merge commit: `4936e05bf797303dcb9ea32cb9fe338692f51e3d`
- First parent: `c69112322c0a25f50c53725b5872b5a52ae5c3ab`
- Merged branch head / second parent: `ec9aae64fda30ca93f2e946261b77a1ba495c6e2`
- Merge delta: 27 files, `+566/-511`
- Branch commits: `0920afb`, `3315040`, `ec9aae6`
- Plan: `docs/archive/plans/2026-07-18-ficha-do-cliente-hub.md`
- Intended scope: five-tab customer hub; customer read models/hooks; consolidated balance and pendencies; operational/financial tabs; complete timeline; Taxas deep link; removal of three dead commercial columns; docs lifecycle.
- `3315040` addressed the first review round (deep-link parameter, seed column, Portal fields, balance semantics, timeline keys/types, form rebase, receivable order). `ec9aae6` restricted “demurrage correndo” to overdue containers. The later Codex review identified findings 406-02 through 406-04 below after merge.

## Findings

### PR #405

#### 405-01 — P1 / blocking — COD and transshipment writes bypass RBAC

**Evidence**

- `src/pages/BlDetalhe.tsx:50-51` obtains only `user`; it does not evaluate `can('voyages_edit')`.
- `src/pages/BlDetalhe.tsx:193-198` exposes both disposition mutations to every signed-in user who can open a B/L.
- `supabase/migrations/206_portal_notifications_bl_id.sql:95-112` defines `set_bl_cod` as `SECURITY DEFINER` and verifies only `auth.uid()`, `is_active_user()`, and actor identity.
- `supabase/migrations/201_voyage_omission_global_transshipment.sql:159-178` applies the same active-user-only check to `set_bl_transshipment`.
- The permission model grants `voyages_edit` only to Administrativo, Operações, and Documentação (`src/hooks/useAuth.tsx:27-40`), while `CONTEXT.md:722-755` says Financeiro is read-only outside payment reconciliation and database policies/RPCs are the real authority.

**Impact**

A Financeiro user can directly call either RPC and change a B/L's destination/disposition despite lacking `voyages_edit`. The move of the only COD write action into the broadly readable B/L screen makes this an exploitable cross-role authorization bypass, not merely a hidden-button issue.

**Fix**

Add a server-side role predicate to both RPCs (including legacy `admin`/`operator` mappings), permitting only the roles represented by `voyages_edit`. Gate the UI with the same permission and do not pass mutation callbacks when unauthorized. Prefer a shared SQL permission helper so future RPCs do not reimplement the mapping.

**Regression tests**

- Database integration test invoking both RPCs as `financeiro` and expecting SQLSTATE `42501`.
- Positive role matrix for `administrativo`, `operacoes`, `documentacao`, and legacy mappings.
- Page test asserting Financeiro sees the state but has no actionable COD/restore controls.

#### 405-02 — P2 — migration 206 recreates the wrong `omit_voyage_escala` overload

**Evidence**

- Migration 201 explicitly drops the five-argument overload to avoid PostgREST ambiguity and creates the active ten-argument signature at `supabase/migrations/201_voyage_omission_global_transshipment.sql:77-94`.
- That ten-argument function inserts Portal notifications without `bl_id` at `supabase/migrations/201_voyage_omission_global_transshipment.sql:145-152`.
- Migration 206 instead creates a new five-argument overload at `supabase/migrations/206_portal_notifications_bl_id.sql:10-16`; only this new body writes `bl_id` at lines `78-89`.
- The current client sends all ten named arguments at `src/services/transshipments.ts:45-59`, so PostgREST selects the untouched migration-201 body. Calls made with only the five required names are again ambiguous because the ten-argument function has defaults.
- `src/services/__tests__/portalNotificationsBlIdMigration.test.ts:11-15` regex-matches the first function body by name and therefore passes without checking the active signature.

**Impact**

New omission notifications created by the application still have `portal_notifications.bl_id = NULL`; the B/L Portal card cannot retrieve them. Five-argument callers may also receive overload ambiguity.

**Fix**

In a forward migration, drop the five-argument overload and `CREATE OR REPLACE` the exact ten-argument signature, preserving all onward fields and adding `bl_id` to its notification insert. Revoke/grant the exact signature explicitly.

**Regression tests**

- SQL contract test extracting the exact ten-argument signature and proving the notification insert contains `bl_id`.
- Assert the five-argument overload is dropped/absent.
- PostgREST integration test with the current client payload, followed by a read of the inserted notification.

#### 405-03 — P2 — document-matched customers remain pending in the financial rail

**Evidence**

- `src/services/blRails.ts:70-74` treats a customer as resolved only when status is `reconciled`.
- The canonical domain helper says both `matched_document` and `reconciled` are resolved at `src/services/customerReconciliation.ts:164-167`.
- Existing migration and billing tests already rely on `matched_document` being an automatic resolved match.

**Impact**

A B/L matched exactly by CNPJ/CPF is shown as “Vincular cliente”; `pickNextAction` sends the user back into a completed workflow and obscures the real next financial action.

**Fix**

Use `isCustomerReconciliationResolved` in the rail or include both canonical resolved states while also requiring `customer_id`.

**Regression test**

Extend `src/services/__tests__/blRails.test.ts` with a `matched_document + customer_id` case and assert the review stage is `done` and next action advances.

#### 405-04 — P2 — reimport preview invents changes for all four new document fields

**Evidence**

- `src/services/blFreightImport.ts:498-513` compares `place_of_receipt`, `movement_from`, `movement_to`, and `issue_place`.
- The database fetch used to construct `ExistingBl` omits all four columns at `src/services/blFreightImport.ts:545-559`.

**Impact**

Persisted values arrive as `undefined`; every unchanged reimport can be classified as an update with false diffs. This undermines the preview/approval boundary and can create unnecessary audited writes.

**Fix**

Select the four columns in `fetchExistingBls` and keep the `ExistingBl` type aligned with the select list.

**Regression test**

Mock the Supabase select/fetch path with all four fields populated, reimport an identical parsed B/L, and assert status `unchanged`, zero diffs, and no transactional import call.

#### 405-05 — P2 — missing/loading/failed Baplie data is displayed as reconciled green

**Evidence**

- `src/pages/BlDetalhe.tsx:81-85` collapses an undefined reconciliation query into divergence count `0`.
- `src/components/bl/BlVisaoGeralTab.tsx:59-62` renders count zero as the green “Baplie sem divergencias” badge.
- `src/services/baplieReconciliation.ts:191-194` also represents “no staging rows imported” as `{ items: [] }`, indistinguishable from a completed zero-divergence reconciliation.
- The implementation plan expected a skeleton while query data was undefined (`docs/archive/plans/2026-07-18-bl-cockpit-360.md:1301-1312`).

**Impact**

The cockpit asserts successful reconciliation while the query is loading, after it fails, or before any Baplie source was imported. An operational absence is converted into a false success signal.

**Fix**

Return and render an explicit source state (`loading`, `error`, `not_imported`, `reconciled`). A green badge should require a completed reconciliation with a known source and zero divergences.

**Regression tests**

Component/service cases for loading, query error, no staging source, zero divergences with a source, and positive divergences.

#### 405-06 — P2 — COD leaves the Portal card stale

**Evidence**

- `set_bl_cod` inserts a B/L-scoped Portal notification at `supabase/migrations/206_portal_notifications_bl_id.sql:141-151`.
- The active card query uses `queryKeys.portal.blStatus(bl.id)` (`src/pages/BlDetalhe.tsx:59-63`, key definition at `src/services/queryKeys.ts:92-95`).
- `src/hooks/useTransshipments.ts:56-68` invalidates transshipment, B/L, voyage, cockpit, and detail keys, but not the Portal status key.
- The global client has a 30-second stale time and disables focus refetch at `src/lib/queryClient.ts:22-26`.

**Impact**

After a successful COD action, the same screen continues to show the old notification list until cache expiry or reload.

**Fix**

Use the mutation variables in `onSuccess` and invalidate `queryKeys.portal.blStatus(variables.blId)` (and any customer Portal aggregate affected by the notification).

**Regression test**

Hook test asserting both disposition mutations invalidate the scoped Portal key for the mutated B/L.

#### 405-07 — P2 — the cockpit chooses an arbitrary transshipment when a B/L has history

**Evidence**

- The schema permits one row per `(bl_id, omission_id)`, not one row per B/L (`supabase/migrations/174_voyage_omissions_transshipments.sql:20-34`).
- `src/services/transshipments.ts:162-172` queries by `bl_id` without ordering or limiting and selects `(data ?? [])[0]`.
- The Portal's equivalent canonical read explicitly orders by `voyage_omissions.omitted_at DESC, id DESC` and limits one row at `supabase/migrations/202_portal_global_transshipment.sql:38-46`.

**Impact**

For a B/L affected by more than one omission, the internal cockpit can pair the B/L with an older omission and mutate the wrong disposition, while the Portal shows the newest one.

**Fix**

Fetch the omission relationship and order by `omitted_at DESC, id DESC`, with `limit(1)/maybeSingle`, or expose one canonical latest-transshipment RPC reused by both surfaces.

**Regression test**

Provide two omission rows for one B/L in reverse physical order and assert the newest omission is selected deterministically.

### PR #406

#### 406-01 — P1 / blocking — customer and contact writes are authorized only in the browser

**Evidence**

- The new tab correctly computes `can('customers_edit')` and disables actions at `src/components/clientes/CadastroContatosTab.tsx:25`, `:36-50`, and `:52-54`.
- The recreated `update_customer_with_audit` RPC checks only active session and actor identity at `supabase/migrations/207_drop_customer_commercial_fields.sql:21-24` and is granted to all authenticated users at lines `79-80`.
- `customers` and `customer_contacts` are in the active-user operational policy set (`supabase/migrations/010_rls_by_role.sql:90-98`); their INSERT/UPDATE policies allow every active user at lines `126-140`.
- Contacts are written directly through the table at `src/services/customers.ts:91-107` and `:124-126`.
- The frontend permission grants customer editing only to Administrativo/Documentação (`src/hooks/useAuth.tsx:27-40`), and `CONTEXT.md:727-755` explicitly denies customer changes to Operações/Financeiro and requires server enforcement.

**Impact**

Any active Financeiro or Operações account can directly invoke the customer RPC or REST endpoints and modify customer/contact data, bypassing the disabled UI. Audit logs do not compensate for unauthorized mutation.

**Fix**

Enforce the `customers_edit` role mapping in the RPC and replace the broad customer/contact INSERT/UPDATE RLS policies with role-aware predicates. Keep read access global. Apply the same boundary to create/import/delete paths as appropriate; do not rely on `is_admin()` alone because Documentação legitimately edits customers.

**Regression tests**

- Direct API/RPC role matrix: deny `financeiro` and `operacoes`; allow `administrativo`, `documentacao`, and intended legacy roles.
- Cover customer update plus contact insert/update/delete, not just disabled buttons.
- Verify unauthorized attempts create neither mutations nor audit rows.

#### 406-02 — P2 — RLS-filtered receivables are presented as a real empty ledger

**Evidence**

- `fetchCustomerReceivables` marks access denied only when Supabase returns an error (`src/services/customerFicha.ts:80-83`).
- The current SELECT policy is `USING (public.is_admin())` at `supabase/migrations/066_local_billing_ledger_phase1.sql:121-128`. PostgreSQL RLS normally returns zero visible rows, not `42501`, for a successful SELECT.
- `src/components/clientes/FinanceiroTab.tsx:10-11` therefore renders “Nenhum recebível” for Documentação/Financeiro rather than “Restrito”.
- This conflicts with the global Financeiro read model and Documentação business scope in `CONTEXT.md:722-740`.

**Impact**

Users are told a customer has no ledger balance when records exist but are hidden by RLS. This can produce incorrect financial decisions.

**Fix**

Align SELECT RLS with the intended read roles, or expose a minimal role-aware read RPC that returns explicit authorization metadata. Never infer denial from an empty RLS result.

**Regression tests**

Seed a receivable and read it as Administrativo, Documentação, Financeiro, and Operações in an isolated Supabase instance; assert either rows or an explicit restricted state according to the agreed matrix.

#### 406-03 — P2 — an approved Portal exception is shown as an open pendency

**Evidence**

- `src/components/clientes/VisaoGeralTab.tsx:34-35` flags every non-active Portal account.
- The canonical general-pendency contract excludes `provisioning_decision = 'provisionamento_nao_necessario'` at `supabase/migrations/190_portal_general_pendency.sql:15-16` and closes existing alerts for that decision at lines `29-32`.

**Impact**

Customers deliberately approved as not requiring Portal access remain yellow in the new overview, contradicting the operational queue and generating false work.

**Fix**

Reuse a shared Portal-pendency predicate/view-model that considers both `account_situation` and `provisioning_decision` (and, if required by the canonical rule, whether the customer has an active process).

**Regression test**

Render a non-active account with `provisionamento_nao_necessario` and assert no Portal pendency; retain pendencies for genuinely awaiting/failed states.

#### 406-04 — P2 — exact document matches are listed as pending reconciliation

**Evidence**

- `src/services/customerFicha.ts:106-109` fetches both `matched_document` and `matched_name` as pending.
- `src/services/customerReconciliation.ts:164-167` defines `matched_document` as resolved.
- The result drives both the overview pendency (`src/components/clientes/VisaoGeralTab.tsx:30-33`) and the operational warning (`src/components/clientes/OperacionalTab.tsx:8-14`).

**Impact**

The customer hub sends users to confirm a link already resolved automatically by exact CNPJ/CPF.

**Fix**

Fetch only unresolved statuses (currently `matched_name`, plus any explicitly pending statuses), or centralize the predicate and filter against `isCustomerReconciliationResolved`.

**Regression test**

Service and page cases with one `matched_document` and one `matched_name`; only the name match should be counted/rendered.

#### 406-05 — P2 — the promised complete customer timeline omits local payment events

**Evidence**

- The approved plan requires a “timeline completa” including financial events (`docs/archive/plans/2026-07-18-ficha-do-cliente-hub.md:17-20`).
- `CustomerTimelineEvent` and `TimelineSources` contain local invoice issuance and demurrage issue/payment but no local payment/lifecycle source (`src/services/customerFicha.ts:35-50`).
- `fetchCustomerTimelineSources` reads only audit logs, Portal events, invoices, and demurrage (`src/services/customerFicha.ts:118-136`), despite `payments` being queried elsewhere at lines `86-89` and `invoice_lifecycle_events` already recording paid/partial/reconciled events.

**Impact**

The Histórico tab can show an invoice being issued but never its PIX/manual/partial payment or reconciliation, so it is not a complete financial history.

**Fix**

Include `payments` and/or `invoice_lifecycle_events` scoped through the customer's invoices, define stable event kinds/IDs, and deep-link to the invoice.

**Regression test**

Timeline fixture containing issuance, partial payment, and final payment; assert all events are present once and sorted by event timestamp.

#### 406-06 — P2 — contact mutations leave the timeline cache stale

**Evidence**

- The timeline query function closes over `contacts` and `bls`, but its key contains only customer ID (`src/hooks/useCustomerFicha.ts:16-17`; key at `src/services/queryKeys.ts:83`).
- Contact save/delete invalidates only `['customer-detail', cnpj]` at `src/components/clientes/CadastroContatosTab.tsx:50` and `:54`, not the timeline key.
- Queries remain fresh for 30 seconds and do not refetch on focus (`src/lib/queryClient.ts:22-26`).

**Impact**

Immediately after creating or deleting a contact, the Histórico tab can retain the old contact-created event set even though customer detail has refreshed.

**Fix**

Invalidate `queryKeys.customerFicha.timeline(data.id)` after successful contact mutations, or make the timeline fetch its own contact/B/L sources rather than accepting cached arrays through a closure.

**Regression test**

Page/hook test that saves and deletes a contact and asserts both customer-detail and scoped timeline invalidations.

#### 406-07 — P2 — fixed client-side caps silently make the hub incomplete

**Evidence**

- Demurrage, receivables, payments, overrides, reconciliation, and running-demurrage queries stop at 200 rows; manual charges stop at 500 (`src/services/customerFicha.ts:74-115`).
- Customer detail stops invoices at 200 (`src/hooks/useCustomers.ts:177-182`).
- Timeline sources independently stop each source at 100 (`src/services/customerFicha.ts:118-124`).
- Neither the overview nor the tabs display a truncation notice, total count, or pagination.

**Impact**

Large customers receive understated balances, pendency counts, payment history, manual-charge counts, and timelines while the hub claims to reveal everything connected to the customer.

**Fix**

Use paginated loops for aggregate inputs that must be exact; use server-side aggregates/counts where practical; paginate long tables/timeline. If a deliberate display cap remains, return `hasMore/total` and show a truncation notice/deep link.

**Regression tests**

Mock more than one page for each aggregate-critical source and assert the second page affects totals/counts. Add a UI test for explicit `hasMore` disclosure on display-only lists.

#### 406-08 — P2 — new hub queries report loading and failures as legitimate empty data

**Evidence**

- `VisaoGeralTab` discards query state and reads only `data` at `src/components/clientes/VisaoGeralTab.tsx:15-20`; undefined queries become zero balance/no pendencies/no activity at lines `22-44`, `50-52`, `67`, and `72`.
- `FinanceiroTab` likewise renders empty tables whenever query `data` is undefined and never inspects `isLoading` or `error` (`src/components/clientes/FinanceiroTab.tsx:10-11`).
- `HistoricoTab` handles loading but not query errors (`src/components/clientes/HistoricoTab.tsx:7-24`).

**Impact**

During initial fetches, and persistently after network/RLS/schema failures, the page can assert “Nenhuma pendência”, “Nenhum recebível”, or “Sem eventos registrados.” This converts unknown/error state into false business information.

**Fix**

Render explicit skeleton/loading, permission-restricted, error-with-retry, and empty states for each independent read model. Build overview metrics/pendencies only after required queries have settled successfully.

**Regression tests**

Component cases for pending and rejected queries for every tab, asserting empty-state copy appears only after a successful empty result.

### Cross-PR documentation

#### DOC-01 — P3 — living documentation describes deleted/old implementations

**Evidence**

- PR #405 deleted `src/services/blStatusService.ts`, but `docs/setup/testing.md:21` still names `blStatusService` as the B/L status/review test surface.
- PR #406 did not update the living module doc: `docs/modules/clientes.md:3`, `:28-38`, `:52-73`, and its action/state tables still describe the pre-hub single-page implementation and omit all five new read models/keys.
- `docs/AUDITORIA_MIGRATIONS.md:31` still says the commercial fields introduced by migration 023 should be kept, although migration 207 intentionally drops them.
- `npm run docs:check` passes because these are semantic drifts, not broken-link/index violations.

**Impact**

The repository's stated source of truth sends maintainers to removed code and conceals the hub's actual data/RLS/cache boundaries.

**Fix**

Update the three living documents to current architecture, action catalog, query keys, limits/restrictions, and replacement tests (`blRails`, `useBlCockpit`, `customerFicha`). Mark migration-023 fields as superseded/dropped by 207.

**Regression check**

Add a small docs source-reference checker that rejects backticked `src/...` symbols/files that no longer exist; keep semantic module review in the PR checklist.

## Change inventory

### PR #405 (first parent → merge result)

```text
M  CONTEXT.md
M  docs/CHANGELOG.md
M  docs/RASTREABILIDADE.md
R  docs/plans/2026-07-18-bl-cockpit-360.md -> docs/archive/plans/2026-07-18-bl-cockpit-360.md
R  docs/spec/2026-07-18-bl-cockpit-design.md -> docs/archive/specs/2026-07-18-bl-cockpit-design.md
M  docs/modules/manifesto-edi.md
M  docs/modules/viagens.md
M  docs/plans/README.md
M  docs/spec/README.md
M  src/components/bl/BlClienteSection.tsx
M  src/components/bl/BlDetalhesTab.tsx
A  src/components/bl/BlFreightSection.tsx
M  src/components/bl/BlOperacionalTab.tsx
A  src/components/bl/BlPortalCard.tsx
A  src/components/bl/BlRailsPipeline.tsx
A  src/components/bl/BlTransshipmentCard.tsx
A  src/components/bl/BlVisaoGeralTab.tsx
A  src/components/bl/__tests__/BlFreightSection.test.tsx
A  src/components/bl/__tests__/BlPortalCard.test.tsx
A  src/components/bl/__tests__/BlRailsPipeline.test.tsx
A  src/components/bl/__tests__/BlTransshipmentCard.test.tsx
D  src/components/shared/BLPipeline.tsx
M  src/components/voyages/TransshipmentPanel.tsx
A  src/hooks/__tests__/useBlEditForm.fields.test.ts
A  src/hooks/useBlCockpit.ts
M  src/hooks/useBlEditForm.ts
M  src/hooks/useTransshipments.ts
M  src/pages/BlDetalhe.tsx
M  src/pages/__tests__/blTabs.test.tsx
A  src/services/__tests__/blDocumentFieldsMigration.test.ts
M  src/services/__tests__/blFreightImport.test.ts
A  src/services/__tests__/blPortalStatus.test.ts
A  src/services/__tests__/blRails.test.ts
D  src/services/__tests__/blStatusService.test.ts
A  src/services/__tests__/portalNotificationsBlIdMigration.test.ts
M  src/services/__tests__/transshipments.test.ts
M  src/services/blFreightImport.ts
A  src/services/blPortalStatus.ts
A  src/services/blRails.ts
D  src/services/blStatusService.ts
M  src/services/queryKeys.ts
M  src/services/transshipments.ts
A  supabase/migrations/205_bl_document_fields.sql
A  supabase/migrations/206_portal_notifications_bl_id.sql
```

### PR #406 (first parent → merge result)

```text
M  CONTEXT.md
M  docs/ARCHITECTURE.md
M  docs/CHANGELOG.md
M  docs/RASTREABILIDADE.md
R  docs/plans/2026-07-18-ficha-do-cliente-hub.md -> docs/archive/plans/2026-07-18-ficha-do-cliente-hub.md
M  docs/plans/README.md
M  scripts/design-audit/seed_audit.sql
A  src/components/clientes/CadastroContatosTab.tsx
A  src/components/clientes/FichaTabs.tsx
A  src/components/clientes/FinanceiroTab.tsx
A  src/components/clientes/HistoricoTab.tsx
A  src/components/clientes/OperacionalTab.tsx
A  src/components/clientes/VisaoGeralTab.tsx
A  src/components/clientes/fichaTabConfig.ts
M  src/components/taxasLocais/ChargeOverridesTab.tsx
M  src/hooks/__tests__/useCustomersFilters.test.ts
A  src/hooks/useCustomerFicha.ts
M  src/pages/ClienteFicha.tsx
M  src/pages/TaxasLocais.tsx
M  src/pages/__tests__/ClienteFicha.behavior.test.tsx
A  src/services/__tests__/customerFicha.test.ts
M  src/services/__tests__/customerUpdateAuditAtomic.test.ts
A  src/services/customerFicha.ts
M  src/services/customers.ts
M  src/services/queryKeys.ts
M  src/types/database.ts
A  supabase/migrations/207_drop_customer_commercial_fields.sql
```

## Correctness and convention checks that passed

- Migration 205 propagates the four intended B/L fields through schema, import RPC, save-review whitelist, client payload, form, and display; its privileged functions retain controlled `search_path` and explicit grants.
- Migration 207 removes the three commercial fields consistently from current TypeScript/services/tests and recreates the customer audit RPC before the drop. Remaining executable-name hits are historical migrations; the live drift is documentation noted above.
- PR #405's COD reverse lookup, canonical query-key usage, edit/import invalidation, null-voyage Baplie link, duplicate-diff cleanup, and “Sem containers” rendering match the final review fixes.
- PR #406's customer deep link, form rebase, Portal-card field preservation, overdue filters, and running-demurrage restriction match the final review fixes.
- Both archived plans/specs were removed from active indexes as intended.
- No post-merge code commit modified the affected implementations.

## Verification evidence

Executed against a clean `git archive origin/main` snapshot at `9da9bb7` with the existing dependency tree; the repository working tree was not changed.

```text
Focused PR suites: 15 files passed, 68 tests passed
Full unit suite:    283 files passed, 1 skipped; 1,134 tests passed, 9 skipped
Typecheck:          tsc -b passed
Production bundle: vite build passed (2,533 modules)
Docs check:         passed (159 Markdown files, 39 routes, ADR index)
Changed-path lint:  0 errors; 5 ignored non-code-file warnings
```

No real-Supabase integration suite was run. That omission matters: the two P1 defects and the RLS-empty behavior require role-authenticated database tests, and the current unit/SQL-regex tests cannot prove those boundaries.

## Recommended remediation order

1. Block release on 405-01 and 406-01; add the role-matrix integration tests first.
2. Ship a forward migration correcting the exact migration-206 overload (405-02).
3. Fix the three false-pendency/false-success domain predicates (405-03, 405-05, 406-03, 406-04) and the RLS-empty ledger behavior (406-02).
4. Fix cache/read determinism (405-06, 405-07, 406-06), reimport completeness (405-04), query state/truncation (406-07/08), and timeline completeness (406-05).
5. Update living docs and add source-reference/docs review checks.
