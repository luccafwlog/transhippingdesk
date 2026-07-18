# Customers and Customer Portal Cartography Implementation Plan

> **✅ Completed (2026-06-24).** `docs/modules/clientes.md` and `docs/modules/portal-cliente.md` mapped with standard contract, action catalogs, and evidence labels.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trace customer master data, contacts, reconciliation, Portal provisioning, Portal authentication, self-service billing, operation, notifications, disputes, and profile actions.

**Architecture:** `clientes.md` owns internal customer lifecycle and Portal-account provisioning. `portal-cliente.md` owns the external session boundary and customer-scoped RPC surfaces. Cross-link review behavior without duplicating the review gate specification owned by `operacao-suporte.md`.

**Tech Stack:** React, Supabase Auth, Edge Functions, TanStack Query, RLS/RPC, XLSX, Markdown, Mermaid, Vitest.

---

## Files

- Modify: `docs/modules/clientes.md`
- Modify: `docs/modules/portal-cliente.md`

Do not edit product code, Edge Functions, or migrations.

### Task 1: Expand the Customer Master Cartography

**Files:**

- Modify: `docs/modules/clientes.md`
- Read: `src/pages/Clientes.tsx`
- Read: `src/pages/ClienteFicha.tsx`
- Read: `src/hooks/useCustomers.ts`
- Read: `src/services/customers.ts`
- Read: `src/services/customerBase.ts`
- Read: `src/services/customerReconciliation.ts`
- Read: `src/services/deleteDependencies.ts`
- Read: `src/services/deleteAudit.ts`
- Read: `supabase/functions/provision-portal-user/index.ts`
- Test: `src/services/__tests__/customers.test.ts`
- Test: `src/services/__tests__/customers.delete.test.ts`
- Test: `src/services/__tests__/customerReconciliation.test.ts`
- Test: `src/hooks/__tests__/useCustomersFilters.test.ts`
- Test: `src/lib/__tests__/customerTableViewModel.test.ts`

- [ ] **Step 1: Apply the shared headings**

Under `Anatomia das telas`, create:

```markdown
### `/clientes`
### `/clientes/:cnpj`
```

- [ ] **Step 2: Catalog `/clientes` actions**

Include:

- search, filter, paginate, sort;
- select rows;
- navigate to customer file;
- create customer;
- import customer-base spreadsheet;
- export visible customers;
- controlled bulk delete;
- dependency inspection before delete.

- [ ] **Step 3: Catalog `/clientes/:cnpj` actions**

Include:

- load customer, B/L, invoice, and Portal account details;
- edit master fields;
- add/edit/delete contact;
- upsert inactive Portal account;
- invoke `provision-portal-user`;
- verify returned `auth_user_id`;
- activate/deactivate Portal account;
- handle missing/invalid route document.

- [ ] **Step 4: Document ownership and invariants**

Include:

- normalized 11/14-digit identity;
- customer route key;
- contact-purpose values;
- customer-base deduplication and retroactive B/L linking;
- customer matching precedence and first-token fuzzy guard;
- activation invariant `active = true` requires `auth_user_id`;
- Edge Function is a server-side Auth adapter, not a frontend security boundary;
- hard-delete dependency protections.

- [ ] **Step 5: Run focused tests**

```powershell
npx vitest run src/services/__tests__/customers.test.ts src/services/__tests__/customers.delete.test.ts src/services/__tests__/customerReconciliation.test.ts src/hooks/__tests__/useCustomersFilters.test.ts src/lib/__tests__/customerTableViewModel.test.ts
```

Expected: exit `0`.

### Task 2: Map Portal Authentication and Session Boundaries

**Files:**

- Modify: `docs/modules/portal-cliente.md`
- Read: `src/pages/PortalLogin.tsx`
- Read: `src/pages/PortalForgotPassword.tsx`
- Read: `src/pages/PortalResetPassword.tsx`
- Read: `src/components/layout/PortalProtectedRoute.tsx`
- Read: `src/components/layout/PortalLayout.tsx`
- Read: `src/hooks/usePortalAuth.tsx`
- Read: `src/services/supabase.ts`
- Read: `src/services/supabaseAuth.ts`
- Read: `supabase/migrations/20260615000002_portal_fase1_login_cnpj.sql`
- Read: `supabase/migrations/20260615210000_harden_portal_resolve_login.sql`
- Read: `supabase/migrations/20260619130000_review_gate_hardening.sql`
- Test: `src/hooks/__tests__/usePortalAuth.test.tsx`
- Test: `src/services/__tests__/portalResolveLoginHardeningMigration.test.ts`
- Test: `src/services/__tests__/supabaseAuth.test.ts`
- Test: `src/components/layout/__tests__/PortalLayout.test.tsx`

- [ ] **Step 1: Apply shared headings and route subsections**

Under `Anatomia das telas`, create:

```markdown
### `/portal/login`
### `/portal/esqueci-senha`
### `/portal/recuperar-senha`
### `/portal`
### `/portal/billing`
### `/portal/operacao`
### `/portal/perfil`
```

- [ ] **Step 2: Catalog authentication actions**

Include:

- resolve CNPJ/CPF login;
- use email login directly;
- sign in with password;
- hydrate session;
- fetch session overview;
- sign out;
- request password recovery;
- parse recovery tokens;
- establish recovery session;
- update password;
- Portal route redirection when unauthenticated.

- [ ] **Step 3: Add authentication sequence**

Use a Mermaid sequence covering:

```text
identifier
→ portal_resolve_login when document
→ signInWithPassword
→ Supabase Auth session in isolated storage
→ portal_get_session_overview_v2
→ PortalProtectedRoute
```

Document generic credential errors, resolver rate limiting, and the distinction between login identifier and authentication mechanism.

- [ ] **Step 4: Run focused auth tests**

```powershell
npx vitest run src/hooks/__tests__/usePortalAuth.test.tsx src/services/__tests__/portalResolveLoginHardeningMigration.test.ts src/services/__tests__/supabaseAuth.test.ts src/components/layout/__tests__/PortalLayout.test.tsx
```

Expected: exit `0`.

Mark the migration test as `Teste de contrato SQL`.

### Task 3: Map Portal Dashboard, Billing, and Operation

**Files:**

- Modify: `docs/modules/portal-cliente.md`
- Read: `src/pages/PortalDashboard.tsx`
- Read: `src/pages/PortalBilling.tsx`
- Read: `src/pages/PortalOperacao.tsx`
- Read: `src/components/portal/PortalConsolidatedModal.tsx`
- Read: `src/components/portal/ShipScheduleWidget.tsx`
- Read: `src/hooks/usePortalBilling.ts`
- Read: `src/hooks/usePortalOperation.ts`
- Read: `src/services/portalBilling.ts`
- Read: `src/services/portalOperation.ts`
- Read: `src/lib/portalOperationViews.ts`
- Read: `supabase/migrations/20260615220000_portal_ce_mercante_gate.sql`
- Read: `supabase/migrations/20260615190000_portal_invoice_consolidated_breakdown.sql`
- Read: `supabase/migrations/20260615200000_fix_portal_create_consolidation_jsonb.sql`
- Test: `src/pages/__tests__/PortalDashboard.test.tsx`
- Test: `src/pages/__tests__/PortalBilling.test.tsx`
- Test: `src/pages/__tests__/PortalOperacao.test.tsx`
- Test: `src/services/__tests__/portalOperation.test.ts`
- Test: `src/lib/__tests__/portalOperationViews.test.ts`
- Test: `src/services/__tests__/portalCeMercanteGateMigration.test.ts`
- Test: `src/services/__tests__/portalCreateConsolidationJsonbMigration.test.ts`
- Test: `src/services/__tests__/portalInvoiceConsolidatedBreakdownMigration.test.ts`
- Test: `src/services/__tests__/portalInvoiceHistoryLinksMigration.test.ts`

- [ ] **Step 1: Catalog dashboard actions**

Include:

- load overview KPIs;
- open billing/operation destinations;
- load vessel schedule widget;
- realtime schedule invalidation.

- [ ] **Step 2: Catalog billing actions**

Include:

- list/filter local invoices;
- list/filter demurrage invoices;
- open local invoice detail;
- open demurrage detail;
- export filtered data;
- load consolidatable receivables;
- create consolidation;
- obsolete eligible consolidation;
- open demurrage dispute.

- [ ] **Step 3: Catalog operation actions**

Include:

- switch B/L/container views;
- search/filter;
- derive returned/demurrage states;
- export filtered rows;
- enforce CE Mercante release gate.

- [ ] **Step 4: Record customer-scoped security assumptions**

State that:

- client-side filtering is not authorization;
- Portal data RPCs resolve customer from authenticated identity;
- `anon` grants in historical migrations must be interpreted against later revokes/hardening;
- CE gate applies to Portal visibility, not internal billing eligibility.

- [ ] **Step 5: Run focused Portal data tests**

```powershell
npx vitest run src/pages/__tests__/PortalDashboard.test.tsx src/pages/__tests__/PortalBilling.test.tsx src/pages/__tests__/PortalOperacao.test.tsx src/services/__tests__/portalOperation.test.ts src/lib/__tests__/portalOperationViews.test.ts src/services/__tests__/portalCeMercanteGateMigration.test.ts src/services/__tests__/portalCreateConsolidationJsonbMigration.test.ts src/services/__tests__/portalInvoiceConsolidatedBreakdownMigration.test.ts src/services/__tests__/portalInvoiceHistoryLinksMigration.test.ts
```

Expected: exit `0`.

### Task 4: Map Notifications, Disputes, and Profile

**Files:**

- Modify: `docs/modules/portal-cliente.md`
- Read: `src/pages/PortalProfile.tsx`
- Read: `src/components/portal/NotificationBell.tsx`
- Read: `src/components/portal/DisputeModal.tsx`
- Read: `src/hooks/usePortalNotifications.ts`
- Read: `src/hooks/usePortalDisputes.ts`
- Read: `src/services/portalBilling.ts`
- Read: `supabase/migrations/20260615000003_portal_fase2_notifications_disputes_profile.sql`
- Read: `supabase/migrations/20260615145427_portal_fixes_post_pr227.sql`

- [ ] **Step 1: Catalog actions**

Include:

- list notifications;
- fetch unread count;
- mark one notification read;
- mark all notifications read;
- open dispute;
- update profile/contact/address fields.

- [ ] **Step 2: Record side effects**

Document notification triggers, internal alert creation for disputes, cache invalidations, and fields the profile RPC is allowed to update.

- [ ] **Step 3: Record coverage gaps**

If no focused component/service tests assert these actions, mark them `Código` and list the exact runtime scenarios required by Plan 07.

### Task 5: Verify and Commit

**Files:**

- Modify: `docs/modules/clientes.md`
- Modify: `docs/modules/portal-cliente.md`

- [ ] **Step 1: Check headings/routes/actions**

```powershell
rg -n "^## (Propósito e escopo|Anatomia das telas|Catálogo de ações|Estado e dados|Fluxos e invariantes|Testes e validação|Notas e divergências)$" docs/modules/clientes.md docs/modules/portal-cliente.md
rg -n '### `/(clientes|portal)' docs/modules/clientes.md docs/modules/portal-cliente.md
```

Expected: seven headings in each file and every owned route present.

- [ ] **Step 2: Run docs and whitespace checks**

```powershell
npm run docs:check
git diff --check
```

Expected: no checker failures for these two module files.

- [ ] **Step 3: Commit**

```powershell
git add -- docs/modules/clientes.md docs/modules/portal-cliente.md
git commit -m "docs: map customers and customer portal"
```
