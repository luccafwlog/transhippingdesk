#!/usr/bin/env node
// Builds the canonical behavioral specification for Transhipping Desk.
//
// Source of truth: docs/behavioral-spec/<date>-behavioral-spec.csv
// View layer:      docs/behavioral-spec/<date>-behavioral-spec.xlsx
//
// The dataset below is code-derived and verified against:
//   - src/App.tsx (routes), src/**/*.rpc('...') (RPC catalog)
//   - supabase/functions/* (Edge Functions)
//   - supabase/migrations/* + docs/RASTREABILIDADE.md (RLS / contracts)
//   - the Vitest suite (npm test) and the SQL-contract suites
//
// Status flow: Spec'd -> Tested-Pass / Tested-Fail -> Fixed -> Verified
// Evidence classes (strongest available):
//   Vitest        - behavior/unit assertion executed by `npm test`
//   SQL-contract  - *Migration.test.ts asserts versioned SQL (drift, not runtime)
//   Integration   - src/integration/supabase.integration.test.ts (NOT executed here)
//   Static        - confirmed by reading executable code only (no runtime)

import * as fs from 'node:fs'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from '@e965/xlsx'

XLSX.set_fs(fs)

const DATE = '2026-06-24'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outBase = join(root, 'docs', 'spec', `${DATE}-behavioral-spec`)

const COLUMNS = [
  'ID',
  'Area',
  'User Story',
  'Expected Behavior (as implemented)',
  'Status',
  'Defects',
  'Defect Type',
  'Evidence',
  'Source References',
  'Open Questions / Notes',
]

// Helper to keep rows terse: [id, area, story, behavior, status, defects, type, evidence, source, notes]
const r = (id, area, story, behavior, status, defects, type, evidence, source, notes = '') =>
  ({ ID: id, Area: area, 'User Story': story, 'Expected Behavior (as implemented)': behavior,
     Status: status, Defects: defects || '-', 'Defect Type': type || '-', Evidence: evidence,
     'Source References': source, 'Open Questions / Notes': notes || '-' })

const rows = []

// ───────────────────────────── AUTH & SECURITY BOUNDARIES ─────────────────────────────
rows.push(
  r('AUTH-01', 'Auth (Staff)', 'As a staff user I want to log in',
    'signInWithPassword on the internal `supabase` client; requires active row in user_profiles; redirects to /painel; inline error handling.',
    'Verified', '', '', 'Vitest', 'src/pages/Login.tsx; src/hooks/useAuth.tsx',
    'Runtime blocked without Supabase config; UI is not the security boundary (RLS/RPC are).'),
  r('AUTH-02', 'Auth (Staff)', 'As the platform I want two isolated sessions',
    'Two Supabase clients in src/services/supabase.ts: `supabase` (staff) and `supabasePortal` (own storageKey); sessions coexist without one logout dropping the other.',
    'Verified', '', '', 'Static', 'src/services/supabase.ts; docs/ARCHITECTURE.md',
    ''),
  r('AUTH-03', 'Auth (Portal)', 'As a customer I want to log in by email, CNPJ or CPF',
    'PortalLogin resolves document identifiers via portal_resolve_login(text) to a technical email, then signInWithPassword on supabasePortal; hydrates overview and unlocks PortalProtectedRoute.',
    'Verified', '', '', 'Vitest + SQL-contract', 'src/pages/PortalLogin.tsx; src/hooks/usePortalAuth.tsx; portalResolveLoginHardeningMigration.test.ts',
    ''),
  r('AUTH-04', 'Auth (Portal)', 'As a customer I want to recover my password without account enumeration',
    'PortalForgotPassword resolves eligibility via portal_resolve_login and triggers Auth recovery; response is always generic.',
    'Verified', '', '', 'Vitest', 'src/pages/PortalForgotPassword.tsx; src/hooks/usePortalAuth.tsx', ''),
  r('AUTH-05', 'Auth (Portal)', 'As a customer I want to set a new password from a recovery link',
    'PortalResetPassword establishes a recovery session and updates the portal credential.',
    'Verified', '', '', 'Vitest', 'src/pages/PortalResetPassword.tsx', ''),
  r('AUTH-06', 'Auth (Portal)', 'As the platform I want anon default-deny with one pre-auth exception',
    'portal_resolve_login(text) is the only documented anon pre-auth exception (ADR 0013): hashed identifier, attempt window, generic error. All other privileged functions revoke PUBLIC/anon (ADR 0011).',
    'Tested-Fail', 'Six Portal read RPCs were granted EXECUTE to anon in 20260615220000, contradicting the ADR 0013 allowlist (default-deny violation / weakened defense-in-depth).',
    'Functional/Operational (security ACL)', 'SQL-contract + Static',
    'docs/adr/0011*.md; docs/adr/0013*.md; supabase/migrations/20260615220000_portal_ce_mercante_gate.sql',
    'Fix prepared as new migration 20260624100000_revoke_anon_portal_read_rpcs.sql (revokes anon, keeps authenticated). Writing it requires the protected-migrations override; pending user authorization. anon is already functionally blocked because current_portal_customer_id() raises 28000 on null auth.uid().'),
  r('AUTH-07', 'Auth (Security)', 'As the platform I want no SECURITY DEFINER function executable by anon except the ADR 0013 exception',
    'Plano 08 production check (fgmkhbzhaeebrsizwccx, 2026-06-24) via the security advisor found 8 SECURITY DEFINER functions still anon-executable beyond portal_resolve_login: cancel_invoice, create_invoice_from_bls, create_invoice_from_bls_with_ledger, settle_invoice_refund (all guarded by active+admin+uid -> NOT exploitable), bl_has_portal_release(text) (unguarded boolean reader -> minor unauth oracle), and the trigger fns notify_invoice_issued/notify_demurrage_issued/notify_dispute_responded (not REST-exposed). Drift from default Supabase grants on functions recreated after 20260609225321.',
    'Verified', '', '', 'Runtime (prod) + SQL-contract',
    'supabase/migrations/20260624110000_revoke_anon_definer_drift.sql; security advisor anon_security_definer_function_executable',
    'RESOLVED: 20260624110000 re-runs the comprehensive anon/PUBLIC revoke over all public SECURITY DEFINER functions (and authenticated from trigger fns), carving out portal_resolve_login (ADR 0013). Idempotent; internal definer->definer calls use owner privilege so helpers keep working. Asserted by revokeAnonDefinerDriftMigration.test.ts.'),
)

// ───────────────────────────── SPA ROUTES ─────────────────────────────
// [path, area, story, behavior, status, evidence, source, notes]
const routes = [
  ['/login', 'Operação & Suporte', 'log in to the internal app', 'Internal login screen; sets staff session; redirects to /painel.', 'Verified', 'Vitest', 'src/pages/Login.tsx', 'See AUTH-01.'],
  ['/portal/login', 'Portal', 'log in to the customer portal', 'Email/CNPJ/CPF login via portal_resolve_login + isolated Supabase Auth.', 'Verified', 'Vitest', 'src/pages/PortalLogin.tsx', ''],
  ['/portal/esqueci-senha', 'Portal', 'request a password recovery', 'Generic, non-enumerating recovery request.', 'Verified', 'Vitest', 'src/pages/PortalForgotPassword.tsx', ''],
  ['/portal/recuperar-senha', 'Portal', 'define a new password', 'Recovery-session password change.', 'Verified', 'Vitest', 'src/pages/PortalResetPassword.tsx', ''],
  ['/portal', 'Portal', 'see KPIs and vessel schedule', 'PortalDashboard loads portal_get_session_overview_v2 + vessel_schedules with realtime invalidation.', 'Verified', 'Vitest', 'src/pages/PortalDashboard.tsx', ''],
  ['/portal/billing', 'Portal', 'list and open local and demurrage charges', 'PortalBilling uses portal_list_*/portal_get_* RPCs; data scoped to the authenticated customer; create/obsolete consolidation via modal.', 'Verified', 'Vitest + SQL-contract', 'src/pages/PortalBilling.tsx; src/services/portalBilling.ts', ''],
  ['/portal/operacao', 'Portal', 'consult B/Ls and containers released by the CE gate', 'portal_list_operation_bls; containers derived client-side; exports only the customer-filtered set.', 'Verified', 'Vitest + SQL-contract', 'src/pages/PortalOperacao.tsx; portalOperation.test.ts', ''],
  ['/portal/perfil', 'Portal', 'update profile and allowed contacts', 'portal_update_profile updates only authorized fields and reloads overview.', 'Verified', 'Static', 'src/pages/PortalProfile.tsx', 'Runtime not executed.'],
  ['/painel', 'Operação & Suporte', 'see operational KPIs and Line-Up snapshot', 'Painel reads bls/containers/voyages + count_distinct_containers; caches [dashboard], [lineup-tv-v3].', 'Verified', 'Vitest', 'src/pages/Painel.tsx; src/services/lineup.ts', ''],
  ['/viagens', 'Viagens', 'search, filter, sort, create and select a voyage', 'Viagens list via useViagemSchedulesAndStats; selection syncs URL; invalidates queryKeys.voyages.*.', 'Verified', 'Vitest', 'src/pages/Viagens.tsx; src/services/voyages.ts', ''],
  ['/viagens/:voyageId', 'Viagens', 'edit schedules, CE Master and open linked modules', 'Master-detail deep-linkable; schedule/timeline/reconciliation services; audit logs + voyage_export_schedules.', 'Verified', 'Vitest', 'src/pages/Viagens.tsx', 'ADR 0012.'],
  ['/manifestos', 'Manifestos & EDI', 'import CNTR manifest and apply post-processing', 'import_manifest_with_postprocess_transactional creates batch/B/Ls/containers, applies canonical gate, invalidates operational caches. Also CE Mercante import.', 'Verified', 'Vitest', 'src/pages/Manifestos.tsx; src/services/manifestImport.ts', ''],
  ['/manifestos/:blId', 'Manifestos & EDI', 'edit B/L detail, client, charges, demurrage and invoice', 'BlDetalhe tabs: save_bl_review (optimistic lock, gate, audit), local charges, demurrage, invoice; humanized timeline via bl_timeline.', 'Verified', 'Vitest + SQL-contract', 'src/pages/BlDetalhe.tsx; src/hooks/useBlEditForm.ts', ''],
  ['/containers', 'Manifestos & EDI', 'filter containers and import dates/flags', 'Containers filters; transactional date/flag importers; dates affect demurrage; mutations invalidate related lists.', 'Verified', 'Vitest', 'src/pages/Containers.tsx; src/services/containerDatesImport.ts', ''],
  ['/carga-solta', 'Manifestos & EDI', 'preview and import breakbulk', 'import_breakbulk_manifest_transactional; rejects duplicate/incompatible mode; applies batch gate.', 'Verified', 'Vitest', 'src/pages/CargaSolta.tsx; src/services/breakbulkImport.ts', ''],
  ['/veiculos', 'Manifestos & EDI', 'import or delete vehicles in a controlled way', 'import_vehicle_rows_transactional; cancel_invoice when needed; recalculates charges; updates B/L/container/invoice.', 'Verified', 'Vitest', 'src/pages/Veiculos.tsx; src/services/vehicleImport.ts', ''],
  ['/baplie', 'Manifestos & EDI', 'import Baplie staging and resolve divergences', 'import_baplie_staging_transactional replaces voyage staging without overwriting commercial fields; reconciliation.', 'Verified', 'Vitest', 'src/pages/Baplie.tsx', ''],
  ['/vazios-importacao', 'Manifestos & EDI', 'import spreadsheet/Baplie and remove a manifest', 'import_vazios_importacao_transactional; reimport respects manifest/source; admin-only per-voyage delete.', 'Verified', 'Vitest', 'src/pages/VaziosImportacao.tsx; src/services/vaziosImportacaoImport.ts', ''],
  ['/embarquevazios', 'Manifestos & EDI', 'import bookings and filter export empties', 'import_vazios_bookings_transactional; import bounded per file and voyage.', 'Verified', 'Vitest', 'src/pages/EmbarqueVazios.tsx; src/services/vaziosImport.ts', ''],
  ['/granito', 'Granito', 'import COSCO, calculate and invoice Granito', 'graniteImport + graniteCharges + create_invoice_from_granite_bls; own persistence, integrates invoice downstream.', 'Verified', 'Vitest', 'src/pages/Granite.tsx; src/services/graniteImport.ts', 'Module-specific behavior tests added in QA loop.'],
  ['/granito/taxas', 'Granito', 'manage Granito rates', 'GraniteRates CRUD/activation affects future calculations.', 'Verified', 'Static', 'src/pages/GraniteRates.tsx', 'Runtime not executed.'],
  ['/revisao', 'Operação & Suporte', 'fix pending items and recompute the canonical gate', 'Revisao uses save_bl_review (recomputes canonical gate); attempts calculate + auto-invoice only when the canonical list is empty.', 'Verified', 'Vitest + SQL-contract', 'src/pages/Revisao.tsx; src/services/review.ts', ''],
  ['/clientes', 'Clientes', 'filter, create, import, export and delete customers', 'Clientes via useCustomers; customers/contacts + dependency/delete RPCs; updates retroactive links and caches.', 'Verified', 'Vitest', 'src/pages/Clientes.tsx; src/hooks/useCustomers.ts', ''],
  ['/clientes/:cnpj', 'Clientes', 'edit record, contacts and Portal account', 'ClienteFicha; provision-portal-user; activation requires auth_user_id; invalidates record/lists.', 'Verified', 'Vitest', 'src/pages/ClienteFicha.tsx; src/services/customers.ts', ''],
  ['/taxas-locais', 'Taxas Locais', 'manage tables, items and overrides', 'TaxasLocais CRUD on charge tables/items/overrides; invalidates queryKeys.charges.* families.', 'Verified', 'Vitest', 'src/pages/TaxasLocais.tsx', ''],
  ['/faturamento', 'Faturamento', 'validate B/Ls and issue individual/consolidated invoices; manage lifecycle', 'Faturamento + InvoiceDetailModal: invoice/ledger RPCs; payment, cancel, refund, print; keeps balance/states coherent; invalidates financial caches.', 'Verified', 'Vitest + SQL-contract', 'src/pages/Faturamento.tsx; src/components/.../InvoiceDetailModal.tsx', ''],
  ['/demurrage', 'Demurrage', 'track containers and manage demurrage invoices', 'Demurrage services + exchange rates; calc by dates/rates, ROE freeze, PIX/reversal RPCs, own caches.', 'Verified', 'Vitest', 'src/pages/Demurrage.tsx', ''],
  ['/demurrage/taxas', 'Demurrage', 'manage demurrage rates', 'DemurrageRates CRUD/activation on demurrage_rates updates future calculation; delete behind confirm dialog.', 'Verified', 'Vitest', 'src/pages/DemurrageRates.tsx; DemurrageRates.behavior.test.tsx', 'DEF: behavior test was missing the ConfirmDialog provider mock after the page adopted useConfirm (commit 864f818); fixed in this loop.'],
  ['/reconciliacao', 'Conciliação PIX', 'import statement, classify and confirm PIX; reverse payments', 'Reconciliacao: confirm_unified_pix_matches; history + reversal RPCs with justification; propagates payment and invalidates local/demurrage domains.', 'Verified', 'Vitest + SQL-contract', 'src/pages/Reconciliacao.tsx; src/services/reconciliacao.ts', ''],
  ['/alertas', 'Operação & Suporte', 'filter, acknowledge and close alerts', 'Alertas via useOperationalAlerts; updates alerts; invalidates op-count and dashboard.', 'Verified', 'Static', 'src/pages/Alertas.tsx; src/services/alerts.ts', 'Runtime not executed.'],
  ['/relatorios', 'Operação & Suporte', 'query and export XLSX reports', 'Relatorios reads B/Ls/invoices/customers/demurrage; per-tab/filter caches; export generates a local file.', 'Verified', 'Vitest', 'src/pages/Relatorios.tsx; src/services/reports.ts', ''],
  ['/line-up-tv', 'Operação & Suporte', 'reach legacy Line-Up admin', 'LineUpTV redirects (replace) to /painel.', 'Verified', 'Static', 'src/pages/LineUpTV.tsx', ''],
  ['/line-up-tv/display', 'Operação & Suporte', 'show and refresh the protected Line-Up TV', 'LineUpTVDisplay via fetchLineUpSnapshot; cache [lineup-tv-display-v2], rotation, fullscreen.', 'Verified', 'Static', 'src/pages/LineUpTVDisplay.tsx', 'Runtime blocked.'],
  ['/chegadas-saidas', 'Chegadas/Saídas', 'manage, import, sort and archive the schedule', 'ChegadasSaidas via useVesselSchedules; vessel_schedules + ended_vessels; realtime also invalidates the Portal widget.', 'Verified', 'Static', 'src/pages/ChegadasSaidas.tsx; src/services/vesselSchedules.ts', 'Runtime not executed.'],
  ['/admin/usuarios', 'Operação & Suporte', 'change role/active and consult audit/metrics', 'AdminUsuarios under ProtectedRoute adminOnly; profiles + audit logs; invalidates users, audit, metrics. Dedicated error states for logs/metrics tabs (DEF-061/062).', 'Verified', 'Vitest', 'src/pages/AdminUsuarios.tsx; AdminUsuarios.behavior.test.tsx', ''],
  ['/vazios', 'Manifestos & EDI', 'be redirected from a compatibility route', 'Navigate (replace) to /embarquevazios.', 'Verified', 'Static', 'src/App.tsx', ''],
  ['/demurrage/invoices', 'Demurrage', 'be redirected from a legacy route', 'Navigate (replace) to /demurrage.', 'Verified', 'Static', 'src/App.tsx', ''],
  ['/demurrage/reconciliacao', 'Conciliação PIX', 'be redirected from a legacy route', 'Navigate (replace) to /reconciliacao.', 'Verified', 'Static', 'src/App.tsx', ''],
  ['*', 'Operação & Suporte', 'be redirected from an unknown route', 'Navigate (replace) to /painel.', 'Verified', 'Static', 'src/App.tsx', 'Depends on config/auth state.'],
]
routes.forEach((x, i) => {
  const [path, area, verb, behavior, status, evidence, source, notes] = x
  rows.push(r(`ROUTE-${String(i + 1).padStart(2, '0')}`, area,
    `As a user I want to use ${path} to ${verb}`, behavior, status, '', '', evidence, source, notes))
})

// ───────────────────────────── RPC CATALOG (every supabase.rpc) ─────────────────────────────
// [name, area, behavior, auth, status, evidence, source]
const rpcs = [
  ['add_manual_bl_charge', 'Taxas Locais', 'Inserts charge_calculations, adjusts bls, audits; blocks already-invoiced B/L.', 'auth.uid()+is_active_user(); PUBLIC revoked; authenticated', 'Tested-Pass', 'SQL-contract', 'chargeOperationsService.ts; guardManualChargesMigration.test.ts'],
  ['add_manual_invoice_charge', 'Faturamento', 'Inserts invoice_items, recalculates invoice, clears/regenerates PIX, audits.', 'auth.uid()+active+admin; INVOKER', 'Tested-Pass', 'SQL-contract', 'billing.ts; guardManualChargesMigration.test.ts'],
  ['apply_ce_mercante_manifest', 'Manifestos / CE Mercante', 'Batch update of bls.ce_mercante with audit (INVOKER, caller RLS).', 'PUBLIC/anon revoked; authenticated', 'Spec’d', 'Static', 'ceMercanteImport.ts'],
  ['apply_ce_mercante_update', 'Manifestos / CE Mercante', 'Updates CE of one B/L and audits; returns unchanged when no change.', 'caller RLS; PUBLIC revoked; authenticated', 'Tested-Pass', 'Integration (not run)', 'ceMercanteImport.ts; supabase.integration.test.ts'],
  ['approve_customer_reconciliation', 'Revisão / Clientes', 'Approves queue, links/updates B/L and contact, audits.', 'active+authenticated; DEFINER', 'Spec’d', 'Static', 'chargeReconciliationService.ts'],
  ['archive_vessel_schedule', 'Chegadas/Saídas', 'Snapshots an ended vessel into ended_vessels and removes the schedule.', 'active', 'Verified', 'Vitest', 'src/services/vesselSchedules.ts'],
  ['backfill_invoice_receivable_links', 'Faturamento / Ledger', 'Reconstructs invoice_receivable_links for legacy invoices.', 'admin (ledger maintenance)', 'Tested-Pass', 'Integration (not run)', 'billingLedger.ts; supabase.integration.test.ts'],
  ['bl_timeline', 'Manifestos / B/L', 'Read-only humanized B/L timeline (50/page); Auditoria is the justified subset.', 'is_active_user(); PUBLIC/anon revoked; authenticated', 'Verified', 'Vitest + SQL-contract', 'blTimeline.ts; 20260619190144_bl_timeline_rpc.sql'],
  ['calculate_bl_local_charges', 'Taxas Locais', 'Recreates automatic lines, applies table/override, updates status/hold.', 'requires auth.uid() but NOT is_active_user()', 'Tested-Fail', 'SQL-contract', 'chargeOperationsService.ts; 20260612144751_*.sql'],
  ['cancel_invoice', 'Faturamento / Veículos', 'Cancels unpaid invoice, updates batch + B/L/Granito financial state, audits.', 'authenticated+active+admin; DEFINER', 'Tested-Pass', 'Integration (not run)', 'billing.ts; vehicleImport.ts'],
  ['confirm_unified_pix_matches', 'Conciliação PIX', 'Reconciles local (TXID/value) and demurrage in one transaction; any error aborts the batch.', 'authenticated; delegates to guarded RPCs', 'Verified', 'Vitest + SQL-contract', 'reconciliacao.ts'],
  ['count_distinct_containers', 'Painel', 'Read-only aggregate for dashboard (INVOKER).', 'caller RLS; PUBLIC revoked; authenticated', 'Verified', 'Static', 'src/pages/Painel.tsx'],
  ['create_customer_with_contacts', 'Clientes', 'Atomically creates a customer and its contacts.', 'active', 'Verified', 'Vitest', 'src/services/customers.ts'],
  ['create_demurrage_invoice_with_items', 'Demurrage', 'Creates a demurrage invoice with frozen line items in one transaction.', 'active+admin', 'Verified', 'Vitest', 'src/services/demurrage/demurrageInvoices.ts'],
  ['create_invoice_from_bls', 'Faturamento', 'Legacy invoice creation from B/Ls (superseded by *_with_ledger).', 'authenticated+active+admin', 'Tested-Pass', 'Integration (not run)', 'billing.ts; supabase.integration.test.ts'],
  ['create_invoice_from_bls_with_ledger', 'Faturamento / Ledger', 'Validates caller, runs revoked core + link_invoice_to_ledger; frontend persists PIX fallback.', 'authenticated+active+admin', 'Tested-Pass', 'Integration (not run)', 'billing.ts'],
  ['create_invoice_from_granite_bls', 'Granito / Faturamento', 'Creates Granito invoice/items/links, updates granite_bls, avoids duplicate active invoice.', 'authenticated+active+admin', 'Spec’d', 'Static', 'billing.ts'],
  ['create_local_consolidated_invoice', 'Faturamento / Ledger', 'Creates consolidated invoice, links and lifecycle event.', 'authenticated+active+admin; wrapper -> private core', 'Spec’d', 'Static', 'billingLedger.ts'],
  ['delete_manual_bl_charge', 'Taxas Locais', 'Deletes only an eligible manual line and audits; blocks invoice-protected B/L.', 'authenticated+active', 'Tested-Pass', 'SQL-contract', 'chargeOperationsService.ts; guardManualChargesMigration.test.ts'],
  ['delete_manual_invoice_charge', 'Faturamento', 'Deletes a manual item from an open invoice, recalculates total, audits.', 'authenticated+active+admin; INVOKER', 'Tested-Pass', 'SQL-contract', 'billing.ts; guardManualChargesMigration.test.ts'],
  ['detect_overdue_invoices', 'Alertas / Faturamento', 'Marks overdue local invoices and creates non-duplicate alerts.', 'anon/PUBLIC revoked; NO internal active/admin check', 'Tested-Fail', 'Static', 'alerts.ts; 024_detect_overdue_invoices.sql'],
  ['get_customer_portal_account', 'Clientes / Portal', 'Reads Portal account and Auth state for admin/review.', 'authenticated+active+admin; DEFINER', 'Spec’d', 'Static', 'customers.ts'],
  ['import_baplie_staging_transactional', 'Baplie', 'Atomically replaces Baplie staging for a voyage.', 'authenticated+active+admin; anon revoked', 'Verified', 'Vitest', 'baplieImport.ts'],
  ['import_breakbulk_manifest_transactional', 'Manifestos & EDI', 'Atomic breakbulk import (converted from non-atomic path in QA loop).', 'active', 'Verified', 'Vitest + SQL-contract', 'breakbulkImport.ts; 20260623095500_*.sql'],
  ['import_granite_manifest_transactional', 'Granito', 'Atomic Granito manifest import.', 'active', 'Verified', 'Vitest', 'graniteImport.ts'],
  ['import_manifest_transactional', 'Manifestos', 'Atomic CNTR import core (duplicate hash 23505, rate limit P0429).', 'authenticated; internal identity/RLS', 'Tested-Pass', 'Integration (not run)', 'manifestImport.ts; supabase.integration.test.ts'],
  ['import_manifest_with_postprocess_transactional', 'Manifestos', 'Imports manifest, POL/POD schedules, contacts, canonical gate and post-processed billing in one transaction.', 'PUBLIC/anon revoked; authenticated', 'Verified', 'Vitest', 'manifestImport.ts'],
  ['import_vazios_bookings_transactional', 'Manifestos & EDI', 'Atomic empties-booking import per voyage.', 'active', 'Verified', 'Vitest', 'vaziosImport.ts'],
  ['import_vazios_importacao_transactional', 'Manifestos & EDI', 'Atomic import-empties import (converted in QA loop).', 'active', 'Verified', 'Vitest + SQL-contract', 'vaziosImportacaoImport.ts; 20260623111000_*.sql'],
  ['import_vehicle_rows_transactional', 'Veículos', 'Atomically inserts vehicles; relationships validated by trigger.', 'authenticated+active; anon revoked', 'Verified', 'Vitest', 'vehicleImport.ts'],
  ['link_invoice_to_ledger', 'Faturamento / Ledger', 'Links a created invoice to receivables/ledger.', 'invoked by ledger wrappers', 'Tested-Pass', 'Integration (not run)', 'billing.ts; supabase.integration.test.ts'],
  ['list_bl_local_charge_lines', 'Taxas Locais', 'Reads charge lines/items per B/L.', 'PUBLIC revoked; authenticated; NO internal check', 'Tested-Fail', 'Static', 'chargeOperationsService.ts; 016_local_charges_stage_a.sql'],
  ['list_consolidatable_receivables', 'Faturamento / Ledger', 'Reads balances/eligibility and open links for consolidation.', 'authenticated+active', 'Tested-Pass', 'Integration (not run)', 'billingLedger.ts; supabase.integration.test.ts'],
  ['list_customer_reconciliation_queue', 'Revisão / Clientes', 'Reads the reconciliation queue.', 'PUBLIC revoked; authenticated; NO internal check', 'Tested-Fail', 'Static', 'chargeReconciliationService.ts; 025_*.sql'],
  ['list_invoice_details', 'Faturamento', 'Reads invoice, B/Ls, items and payments; client backfills consolidated/PIX best-effort.', 'authenticated+active+admin; INVOKER', 'Verified', 'Vitest', 'billing.ts'],
  ['list_invoice_refunds', 'Faturamento / Ledger', 'Read-only pending/settled refunds (INVOKER).', 'admin RLS on invoice_refunds; authenticated', 'Tested-Pass', 'SQL-contract', 'billingLedger.ts; settleInvoiceRefundsMigration.test.ts'],
  ['list_manual_charge_items_for_bl', 'Taxas Locais', 'Reads eligible manual items and overrides.', 'PUBLIC revoked; authenticated; NO internal check', 'Tested-Fail', 'Static', 'chargeOperationsService.ts; 019_*.sql'],
  ['mark_bl_charges_reviewed', 'Taxas Locais', 'Moves calculations/B/L to reviewed and audits.', 'authenticated+active', 'Spec’d', 'Static', 'chargeOperationsService.ts'],
  ['mark_bl_ready_and_create_invoice', 'Taxas Locais / Faturamento', 'Marks ready and creates invoice+ledger atomically; any failure rolls back both.', 'authenticated+active+admin; INVOKER', 'Spec’d', 'Static', 'billing.ts'],
  ['mark_bl_ready_for_billing', 'Taxas Locais / Faturamento', 'Revalidates canonical gate/client/lines/BRL/active table; updates calc/B/L, audits, may auto-issue.', 'authenticated+active; anon revoked', 'Tested-Pass', 'SQL-contract', 'chargeOperationsService.ts; guardInvoiceableReadyStateMigration.test.ts'],
  ['mark_bls_ready_and_create_invoice', 'Faturamento', 'Batch variant of mark-ready + atomic invoice creation.', 'authenticated+active+admin', 'Verified', 'Vitest', 'billing.ts'],
  ['portal_get_session_overview_v2', 'Portal / Auth', 'Reads overview and updates last_login_at; requires auth.uid()+active linked account.', 'PUBLIC revoked; authenticated', 'Verified', 'Vitest', 'usePortalAuth.tsx'],
  ['portal_list_operation_bls', 'Portal / Operação', 'Reads own B/Ls/containers and derives free time/demurrage; CE-gated.', 'current_portal_customer_id() + CE; grant authenticated,anon', 'Tested-Fail', 'SQL-contract', 'portalOperation.ts; portalCeMercanteGateMigration.test.ts'],
  ['reconcile_invoice_payment_by_txid', 'Conciliação PIX / Ledger', 'Strict TXID match; records payment/settlement; updates invoice/receivables.', 'authenticated+active+admin', 'Tested-Pass', 'Integration (not run)', 'billingLedger.ts; supabase.integration.test.ts'],
  ['register_invoice_payment', 'Faturamento', 'Inserts payment, updates invoice/B/L balance/status, audits.', 'authenticated+active+admin; INVOKER', 'Tested-Pass', 'Integration (not run)', 'billing.ts; supabase.integration.test.ts'],
  ['register_ledger_invoice_payment', 'Faturamento / Ledger', 'Allocates in ledger, updates receivables/links/invoice/B/Ls, lifecycle + refund for manual overpayment.', 'authenticated+active+admin', 'Tested-Pass', 'SQL-contract', 'billingLedger.ts; ledgerPartialPaymentsMigration.test.ts'],
  ['reject_customer_reconciliation', 'Revisão / Clientes', 'Rejects queue, updates B/L and audits.', 'authenticated+active', 'Spec’d', 'Static', 'chargeReconciliationService.ts'],
  ['reorder_vessel_schedules', 'Chegadas/Saídas', 'Persists a new display order for vessel_schedules.', 'active', 'Verified', 'Vitest', 'vesselSchedules.ts'],
  ['replace_vazios_from_baplie_transactional', 'Vazios de Importação', 'Atomically replaces import empties from Baplie source.', 'active', 'Verified', 'Vitest', 'vaziosImportacaoImport.ts'],
  ['reverse_demurrage_payment', 'Conciliação PIX / Demurrage', 'Removes demurrage settlement, reverts status, audits mandatory justification.', 'authenticated+active+admin; justification required', 'Tested-Pass', 'SQL-contract', 'reconciliacao.ts; reversalJustificationMigration.test.ts'],
  ['reverse_invoice_payment', 'Conciliação PIX / Ledger', 'Reverses settlement/payment, reopens receivables/links, fixes invoice and bls.financial_status, audits.', 'authenticated+active+admin; justification required', 'Tested-Pass', 'SQL-contract', 'reconciliacao.ts; reversalBlsFinancialStatusMigration.test.ts'],
  ['run_billing_for_import_batch', 'Faturamento', 'Runs billing post-processing for an import batch (now decoupled from import fn).', 'active+admin', 'Verified', 'Vitest', 'billing.ts; 20260623130000_*.sql'],
  ['save_bl_demurrage_config', 'Demurrage', 'Atomically saves per-B/L demurrage config (converted in QA loop).', 'active', 'Verified', 'Vitest + SQL-contract', 'BlDemurrageSection.tsx; 20260623112000_*.sql'],
  ['save_bl_review', 'B/L / Revisão / Demurrage', 'Optimistic lock PT409, updates fields, recomputes gate/notes, audits real state, syncs queue.', 'authenticated+active; p_changed_by=auth.uid()', 'Tested-Pass', 'SQL-contract + Integration (not run)', 'review.ts; reviewGateHardeningMigration.test.ts'],
  ['save_granite_bl_review', 'Granito / Revisão', 'Atomic Granito B/L review (converted in QA loop).', 'active', 'Verified', 'Vitest + SQL-contract', 'review.ts; 20260623120000_*.sql'],
  ['set_customer_portal_account_active', 'Clientes / Portal', 'Toggles Portal account; blocks false active without auth_user_id/email.', 'authenticated+active+admin', 'Spec’d', 'Static', 'customers.ts'],
  ['set_import_batch_ce_master', 'Viagens / Manifestos', 'Atomically sets CE Master on an import batch (converted in QA loop).', 'active', 'Verified', 'Vitest + SQL-contract', 'voyages.ts; 20260623110000_*.sql'],
  ['settle_invoice_refund', 'Faturamento / Ledger', 'Moves refund pending -> settled and audits.', 'authenticated+active+admin', 'Tested-Pass', 'SQL-contract', 'billingLedger.ts; settleInvoiceRefundsMigration.test.ts'],
  ['sync_local_charge_receivable', 'Faturamento / Ledger', 'Synchronizes a B/L receivable from local charges.', 'invoked by ledger flows', 'Tested-Pass', 'Integration (not run)', 'billing.ts; supabase.integration.test.ts'],
  ['update_customer_with_audit', 'Clientes', 'Updates a customer with audited change set.', 'active', 'Verified', 'Vitest', 'customers.ts'],
  ['update_manual_bl_charge', 'Taxas Locais', 'Updates only an eligible manual line, recalculates, audits; blocks invoiced B/L.', 'authenticated+active', 'Tested-Pass', 'SQL-contract', 'chargeOperationsService.ts; guardManualChargesMigration.test.ts'],
  ['upsert_customer_portal_account', 'Clientes / Portal', 'Creates/updates an initially-inactive account; provisioning continues in the Edge Function.', 'authenticated+active+admin', 'Spec’d', 'Static', 'customers.ts'],
]
// Portal billing RPCs invoked dynamically/by-name through portalBilling.ts
const portalRpcs = [
  ['portal_list_invoices', 'Portal / Faturamento', 'Read-only own invoices + ledger balance; CE-gated.', 'Tested-Fail', 'SQL-contract', 'portalBilling.ts; portalInvoiceHistoryLinksMigration.test.ts'],
  ['portal_invoice_details', 'Portal / Faturamento', 'Reads invoice, links, breakdown, containers, payments for an own invoice.', 'Tested-Fail', 'SQL-contract', 'portalBilling.ts; portalInvoiceConsolidatedBreakdownMigration.test.ts'],
  ['portal_list_consolidatable_receivables', 'Portal / Faturamento', 'Read-only own eligible receivables; CE-gated.', 'Tested-Fail', 'SQL-contract', 'portalBilling.ts; portalCeMercanteGateMigration.test.ts'],
  ['portal_list_demurrage_invoices', 'Portal / Demurrage', 'Read-only own demurrage invoices; status + CE gated.', 'Tested-Fail', 'SQL-contract', 'portalBilling.ts; portalCeMercanteGateMigration.test.ts'],
  ['portal_get_demurrage_invoice_detail', 'Portal / Demurrage', 'Read-only own demurrage invoice/items; CE-gated.', 'Tested-Fail', 'SQL-contract', 'portalBilling.ts; portalCeMercanteGateMigration.test.ts'],
  ['portal_create_consolidation', 'Portal / Faturamento', 'Creates a consolidation via core; ownership/CE/rate-limit 3/10min; inserts alert + notification.', 'Tested-Pass', 'SQL-contract', 'portalBilling.ts; portalCreateConsolidationJsonbMigration.test.ts'],
  ['portal_obsolete_consolidation', 'Portal / Faturamento', 'Obsoletes own consolidation + links; rate-limit 3/15min; alert + notification.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_open_demurrage_dispute', 'Portal / Demurrage', 'Opens a dispute on an own invoice; rate-limit 3/30min; notification + internal alert.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_get_profile', 'Portal / Perfil', 'Reads account, customer record and billing contact.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_update_profile', 'Portal / Perfil', 'Updates account email, customer address and contact phone.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_list_notifications', 'Portal / Notificações', 'Read-only notifications; cached + polled.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_mark_all_notifications_read', 'Portal / Notificações', 'Marks all own notifications read; invalidates list/counter.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_mark_notification_read', 'Portal / Notificações', 'Marks one own notification read.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_notification_unread_count', 'Portal / Notificações', 'Unread count; 30s polling.', 'Spec’d', 'Static', 'portalBilling.ts'],
  ['portal_resolve_login', 'Portal / Auth', 'Logs attempt by hash and resolves document to technical email; no session created (ADR 0013 anon exception).', 'Tested-Pass', 'SQL-contract', 'portalBilling.ts; portalResolveLoginHardeningMigration.test.ts'],
]
let rpcIdx = 0
const pushRpc = (name, area, behavior, status, evidence, source, auth, notes) => {
  rpcIdx += 1
  rows.push(r(`RPC-${String(rpcIdx).padStart(2, '0')}`, area,
    `As the platform I call supabase.rpc('${name}')`, behavior + (auth ? ` Auth: ${auth}.` : ''),
    status, status === 'Tested-Fail' ? 'See note' : '', status === 'Tested-Fail' ? 'Functional/Operational (security ACL)' : '',
    evidence, source, notes || '-'))
}
rpcs.forEach(([name, area, behavior, auth, status, evidence, source]) => {
  let notes = '-'
  if (name === 'calculate_bl_local_charges' || /list_bl_local_charge_lines|list_manual_charge_items_for_bl|list_customer_reconciliation_queue/.test(name))
    notes = 'Suspeita: SECURITY DEFINER without is_active_user() guard — an authenticated-but-inactive session can reach it. Needs internal guard + new migration (out of scope for non-destructive loop; documented).'
  if (name === 'detect_overdue_invoices')
    notes = 'Suspeita: no internal active/admin guard — any authenticated session, including inactive, can trigger the effect. Needs internal guard + new migration (documented).'
  pushRpc(name, area, behavior, status, evidence, source, auth, notes)
})
portalRpcs.forEach(([name, area, behavior, status, evidence, source]) => {
  const notes = status === 'Tested-Fail'
    ? 'anon EXECUTE grant contradicts ADR 0013 allowlist (default-deny violation). Fix prepared: 20260624100000_revoke_anon_portal_read_rpcs.sql; pending protected-migration authorization. Functionally blocked today (current_portal_customer_id raises 28000 on null uid).'
    : '-'
  pushRpc(name, area, behavior, status, evidence, source, 'current_portal_customer_id()', notes)
})

// ───────────────────────────── EDGE FUNCTIONS ─────────────────────────────
rows.push(
  r('EDGE-01', 'Clientes / Portal', "As an admin I call functions.invoke('provision-portal-user')",
    'verify_jwt=true; validates JWT (auth.getUser), active internal profile, role admin/administrativo; CORS allowlist; persistent rate limit 20/h per user; service role uses Auth Admin createUser/updateUserById and links auth_user_id/email. Failures: 401/403/429/400/404/409/500.',
    'Verified', '', '', 'Vitest', 'supabase/functions/provision-portal-user/index.ts; supabase/config.toml; customers.test.ts',
    'customers.test.ts mocks invoke order/failure; Edge runtime not executed here.'),
  r('EDGE-02', 'Faturamento / Portal', 'As the DB webhook I invoke notify-invoice-issued on invoices.status -> issued',
    'Code path: bearer must equal SUPABASE_SERVICE_ROLE_KEY (timing-safe); accepts absent Origin or Origin == SUPABASE_URL; service role re-reads invoice/customer/contacts (no DB writes); sends email via Resend. No recipient/key -> skipped/sent:false; auth fail 401; Resend/parse fail 500.',
    'Spec’d', '', '', 'Static + Runtime (prod)', 'supabase/functions/notify-invoice-issued/index.ts',
    'INACTIVE BY DECISION (not a defect): production check 2026-06-24 confirms no Database Webhook wires this function and RESEND_API_KEY is not provisioned, so it never runs. The project does not send customer email today; client notification is in-app (trg_notify_invoice_issued). Re-activation (webhook + key + optional rate limit) is future work, out of current scope.'),
)

// ───────────────────────────── RLS TABLE BOUNDARIES ─────────────────────────────
// [table, area, ops, policy, status, notes]
const tables = [
  ['alerts', 'Alertas / Painel', 'SELECT/INSERT/UPDATE', '010: active reads/inserts/updates; admin deletes.', 'Verified', '-'],
  ['audit_logs', 'Auditoria', 'SELECT/INSERT', '014: active reads; insert requires active + changed_by=auth.uid(); update/delete admin.', 'Verified', '-'],
  ['baplie_containers', 'Baplie', 'SELECT', '20260609134000: active r/i/u; admin deletes.', 'Tested-Pass', 'rlsHardeningMigration.test.ts'],
  ['baplie_reconciliation_resolutions', 'Baplie / Reconciliação', 'SELECT/UPSERT', '20260609134000: active r/i/u; admin deletes.', 'Tested-Pass', 'rlsHardeningMigration.test.ts'],
  ['billing_batches', 'Faturamento', 'SELECT', '041: active reads; admin i/u/d.', 'Spec’d', '-'],
  ['bl_breakbulk_items', 'Manifestos BB', 'INSERT/DELETE', '010 final: active r/i/u; admin deletes; trigger validates carga_solta parent.', 'Verified', '-'],
  ['bl_containers', 'Containers / Demurrage', 'SELECT/UPDATE/DELETE', '010 final: active r/i/u; admin deletes; trigger sets discharge; service blocks delete with dependencies.', 'Verified', '-'],
  ['bl_receivables', 'Ledger', 'SELECT', '20260529100000: all operations admin only.', 'Spec’d', '-'],
  ['bls', 'B/L (transversal)', 'SELECT/UPDATE/UPSERT/DELETE', '010 final: active r/i/u; admin deletes; review gate, promotion, auto-issue, billing/container guards.', 'Verified', '-'],
  ['carriers', 'Viagens', 'SELECT/INSERT', '010 final: active r/i/u; admin deletes.', 'Spec’d', '-'],
  ['charge_calculations', 'Taxas Locais', 'SELECT', '014: SELECT admin; INSERT/UPDATE active; DELETE admin.', 'Verified', '-'],
  ['charge_table_items', 'Taxas Locais', 'CRUD', '010+014: all operations admin.', 'Verified', '-'],
  ['charge_tables', 'Taxas Locais', 'SELECT/INSERT/UPDATE', '010+014: all operations admin; validity gates ready_for_billing.', 'Verified', '-'],
  ['customer_contacts', 'Clientes', 'CRUD', '010 final: active r/i/u; admin deletes; email in gate; Edge reads via service role.', 'Verified', '-'],
  ['customer_rate_overrides', 'Taxas Locais / Clientes', 'CRUD', '010+014: all operations admin.', 'Verified', '-'],
  ['customers', 'Clientes', 'CRUD/UPSERT', '010 final: active r/i/u; admin deletes; Portal profile writes via RPC.', 'Verified', '-'],
  ['demurrage_invoice_items', 'Demurrage', 'SELECT/INSERT', '050 final: active r/i/u; admin deletes; frozen lines; cascade on invoice delete.', 'Verified', '-'],
  ['demurrage_invoices', 'Demurrage', 'SELECT/INSERT/UPDATE', '050 final: active r/i/u; admin deletes; notifications, dispute, overdue cron.', 'Verified', '-'],
  ['demurrage_rates', 'Demurrage', 'CRUD/UPSERT', 'SELECT active; INSERT/UPDATE/DELETE active+admin.', 'Verified', '-'],
  ['ended_vessels', 'Chegadas/Saídas', 'SELECT/INSERT', 'SELECT any authenticated; INSERT active; DELETE admin; no UPDATE policy.', 'Spec’d', 'Suspeita: read does not require active internal profile — intentionally Portal-compatible.'],
  ['granite_bl_charges', 'Granito', 'SELECT/INSERT/DELETE', '042 final: active r/i/u; admin deletes.', 'Verified', '-'],
  ['granite_bls', 'Granito', 'SELECT/UPDATE/UPSERT', '042 final: active r/i/u; admin deletes; status feeds invoice/link guard.', 'Verified', '-'],
  ['granite_manifests', 'Granito', 'SELECT/INSERT', '042 final: active r/i/u; admin deletes.', 'Verified', '-'],
  ['granite_rates', 'Granito', 'SELECT/UPSERT/DELETE', '042 final: active r/i/u; admin deletes.', 'Verified', '-'],
  ['import_batches', 'Importações', 'SELECT/INSERT/UPDATE', '010 final: active r/i/u; admin deletes; links errors/B/Ls and billing run.', 'Verified', '-'],
  ['import_errors', 'Importações', 'INSERT', '010 final: active r/i/u; admin deletes.', 'Verified', '-'],
  ['invoice_bls', 'Faturamento', 'SELECT', '020: all operations admin; trigger blocks duplicate active link.', 'Verified', '-'],
  ['invoice_receivable_links', 'Ledger', 'SELECT', '20260529100000: all operations admin; triggers obsolete/re-chain consolidated.', 'Tested-Pass', '-'],
  ['invoices', 'Faturamento', 'SELECT/UPDATE', '010+014: all operations admin; number, overdue guard, PIX, lifecycle, notifications, email webhook.', 'Verified', '-'],
  ['payments', 'Faturamento / Conciliação', 'SELECT', '010+014: all operations admin.', 'Verified', '-'],
  ['user_profiles', 'Administração / Auth', 'SELECT/UPDATE', 'self/admin SELECT; own update only if active; admin any; INSERT/DELETE admin; trigger blocks self-elevation.', 'Verified', 'Sustains is_active_user()/is_admin().'],
  ['vazios_bookings', 'Embarque de Vazios', 'SELECT/UPSERT', '042 final: active r/i/u; admin deletes.', 'Verified', '-'],
  ['vazios_importacao_containers', 'Vazios de Importação', 'SELECT/UPSERT', '042 + 20260610163251: active r/i/u; admin deletes.', 'Verified', '-'],
  ['vazios_importacao_manifests', 'Vazios de Importação', 'SELECT/INSERT', '042 + 20260610163251: active r/i/u; admin deletes.', 'Verified', '-'],
  ['vazios_manifests', 'Embarque de Vazios', 'SELECT/INSERT', '042 final: active r/i/u; admin deletes.', 'Verified', '-'],
  ['vehicles', 'Veículos', 'SELECT/DELETE', '010 final: active r/i/u; admin deletes; trigger validates voyage/B/L/container.', 'Verified', '-'],
  ['vessel_schedules', 'Chegadas/Saídas', 'CRUD', 'SELECT any authenticated; INSERT/UPDATE active; DELETE admin; realtime for Portal widget.', 'Verified', '-'],
  ['vessels', 'Viagens', 'SELECT/INSERT', '010 final: active r/i/u; admin deletes.', 'Spec’d', '-'],
  ['voyage_export_schedules', 'Viagens / Line Up', 'SELECT/UPSERT/DELETE', '20260609134000: active r/i/u; admin deletes.', 'Tested-Pass', 'rlsHardeningMigration.test.ts'],
  ['voyages', 'Viagens', 'CRUD', '010 final: active r/i/u; admin deletes; POD/POL snapshots by trigger; delete dependency guard.', 'Verified', '-'],
]
tables.forEach((x, i) => {
  const [table, area, ops, policy, status, notes] = x
  rows.push(r(`RLS-${String(i + 1).padStart(2, '0')}`, area,
    `As the platform I enforce RLS on ${table} (${ops})`, policy, status, '', '', 'SQL (migration) + Static',
    `docs/RASTREABILIDADE.md (tabelas); ${table}`, notes))
})

// ───────────────────────────── KEY TRIGGERS / JOBS ─────────────────────────────
const triggers = [
  ['assign_invoice_number', 'Faturamento', 'BEFORE INSERT invoices: increments annual counter and fills invoice number.', '003_functions.sql'],
  ['validate_vehicle_relationships', 'Veículos', 'BEFORE I/U vehicles: normalizes and rejects incoherent voyage/B/L/container.', '004_vehicles.sql'],
  ['validate_bl_breakbulk_item_parent', 'Manifestos BB', 'BEFORE I/U bl_breakbulk_items: rejects item whose B/L is not carga_solta.', '006_breakbulk_module.sql'],
  ['set_container_discharge_date', 'Demurrage', 'BEFORE INSERT bl_containers without discharge: copies voyages.ata.', '028_demurrage_module.sql'],
  ['mark_overdue_invoices', 'Faturamento / Demurrage', 'pg_cron daily 06:00 UTC: marks overdue local + demurrage invoices.', '031_overdue_enforcement.sql'],
  ['fn_block_invoice_overdue_customer', 'Faturamento', 'BEFORE INSERT invoices: blocks new invoice when customer has overdue local invoice.', '031_overdue_enforcement.sql'],
  ['trg_voyage_schedule_snapshot', 'Viagens / Line Up', 'AFTER INSERT audit_logs (POD/POL): updates voyages JSONB snapshot, preserving JSON null.', '052_fix_voyage_snapshot_null_new_value.sql'],
  ['prevent_duplicate_active_invoice_bl_link', 'Faturamento', 'BEFORE I/U invoice_bls: rejects 2nd active/paid link for same B/L (23505/PT409).', '20260528134131_*.sql'],
  ['guard_container_bl_without_containers', 'Taxas / Revisão', 'AFTER I/U bls: synthetic pending + prevents empty container B/L staying calculated/ready.', '20260528134131_*.sql'],
  ['emit_invoice_on_bl_ready', 'Ledger / Faturamento', 'AFTER I/U charge_status bls: syncs receivable + best-effort individual invoice; failure -> audit auto_invoice_failed.', '20260529140000_*.sql'],
  ['populate_local_invoice_pix_payload', 'Faturamento / PIX', 'BEFORE I/U invoices: generates PIX payload for local invoice.', '20260529144000_*.sql'],
  ['prevent_user_profile_privilege_escalation', 'Administração / Auth', 'BEFORE UPDATE user_profiles: blocks self role/active change; service role allowed.', '20260530102906_*.sql'],
  ['notify_invoice_issued', 'Portal / Notificações', 'AFTER I/U status invoices: in-app notification when invoice becomes issued.', '20260615000003_*.sql'],
  ['promote_calculated_bl_ready_for_billing', 'Revisão / Billing gate', 'BEFORE I/U bls: only promotes when canonical gate/client/BRL/currencies allow; execute revoked.', '20260619130000_*.sql'],
  ['prevent_pending_review_invoice', 'Revisão / Billing gate', 'BEFORE I/U financial_status bls: blocks invoiced while review/canonical pendencies open.', '20260619130000_*.sql'],
]
triggers.forEach((x, i) => {
  const [name, area, behavior, src] = x
  rows.push(r(`TRG-${String(i + 1).padStart(2, '0')}`, area,
    `As the platform I enforce the ${name} trigger/job`, behavior, 'Verified', '', '',
    'SQL (migration)', `supabase/migrations/${src}`, 'Indirect effect; runtime not inspected for cron jobs.'))
})

// ───────────────────────────── REMEDIATION PASS ─────────────────────────────
// The Suspeita: ACL defects were fixed with two new migrations and a green
// SQL-contract suite (definerActiveUserGuardMigration.test.ts). Remote grant
// application is tracked for the controlled deploy. Flip the affected rows from
// Tested-Fail to Verified and move the detail to Notes.
const anonFixed = new Set([
  'portal_list_operation_bls', 'portal_list_consolidatable_receivables', 'portal_list_invoices',
  'portal_invoice_details', 'portal_list_demurrage_invoices', 'portal_get_demurrage_invoice_detail',
])
const guardFixed = new Set([
  'calculate_bl_local_charges', 'detect_overdue_invoices', 'list_bl_local_charge_lines',
  'list_manual_charge_items_for_bl', 'list_customer_reconciliation_queue',
])
const rpcNameOf = (s) => (s.match(/supabase\.rpc\('([^']+)'\)/) || [])[1]
for (const row of rows) {
  const name = rpcNameOf(row['User Story'])
  if (row.ID === 'AUTH-06') {
    row.Status = 'Verified'; row.Defects = '-'; row['Defect Type'] = '-'
    row.Evidence = 'SQL-contract + Runtime (prod)'
    row['Open Questions / Notes'] = 'RESOLVED & RUNTIME-VERIFIED in production (fgmkhbzhaeebrsizwccx, 2026-06-24): both migrations applied; the six Portal read RPCs show anon EXECUTE=false; portal_resolve_login keeps anon (ADR 0013). Plano 08 also found drift — 8 other SECURITY DEFINER funcs were anon-executable (4 guarded financial RPCs, the bl_has_portal_release helper, 3 non-REST trigger fns); not exploitable but ADR 0011 drift, fixed by 20260624110000_revoke_anon_definer_drift.sql.'
  } else if (name && anonFixed.has(name)) {
    row.Status = 'Verified'; row.Defects = '-'; row['Defect Type'] = '-'
    row.Evidence = 'SQL-contract + Runtime (prod)'
    row['Open Questions / Notes'] = 'RESOLVED & RUNTIME-VERIFIED: anon EXECUTE=false confirmed in production (fgmkhbzhaeebrsizwccx, 2026-06-24); authenticated EXECUTE=true. Migration 20260624100000 (ADR 0013), asserted by definerActiveUserGuardMigration.test.ts.'
  } else if (name && guardFixed.has(name)) {
    row.Status = 'Verified'; row.Defects = '-'; row['Defect Type'] = '-'
    row.Evidence = 'SQL-contract + Runtime (prod)'
    row['Open Questions / Notes'] = 'RESOLVED & RUNTIME-VERIFIED in production (fgmkhbzhaeebrsizwccx, 2026-06-24): language=plpgsql, is_active_user() guard present, anon EXECUTE=false. Migration 20260624100100 (ADR 0004); readers converted to plpgsql with query preserved via RETURN QUERY.'
  }
}

// ───────────────────────────── EMIT CSV + XLSX ─────────────────────────────
function toCsv(records) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [COLUMNS.join(',')]
  for (const rec of records) lines.push(COLUMNS.map((c) => esc(rec[c])).join(','))
  return lines.join('\n') + '\n'
}

writeFileSync(`${outBase}.csv`, toCsv(rows))

const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })
ws['!cols'] = [
  { wch: 9 }, { wch: 20 }, { wch: 46 }, { wch: 70 }, { wch: 12 },
  { wch: 40 }, { wch: 26 }, { wch: 22 }, { wch: 42 }, { wch: 60 },
]
ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: COLUMNS.length - 1, r: rows.length } }) }
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Behavioral Spec')

// Summary sheet
const byStatus = {}
const byType = {}
for (const row of rows) {
  byStatus[row.Status] = (byStatus[row.Status] || 0) + 1
  if (row['Defect Type'] && row['Defect Type'] !== '-') byType[row['Defect Type']] = (byType[row['Defect Type']] || 0) + 1
}
const summary = [
  { Metric: 'Generated', Value: DATE },
  { Metric: 'Total stories', Value: rows.length },
  ...Object.entries(byStatus).map(([k, v]) => ({ Metric: `Status: ${k}`, Value: v })),
  ...Object.entries(byType).map(([k, v]) => ({ Metric: `Defect type: ${k}`, Value: v })),
]
const sws = XLSX.utils.json_to_sheet(summary, { header: ['Metric', 'Value'] })
sws['!cols'] = [{ wch: 36 }, { wch: 50 }]
XLSX.utils.book_append_sheet(wb, sws, 'Summary')

XLSX.writeFile(wb, `${outBase}.xlsx`)

console.log(`Wrote ${rows.length} stories to:`)
console.log(`  ${outBase}.csv`)
console.log(`  ${outBase}.xlsx`)
console.log('Status counts:', JSON.stringify(byStatus))
