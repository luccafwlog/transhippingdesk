# Operation, Support, and Vessel Schedule Cartography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the living documentation for dashboard, review, alerts, reports, Line-Up, user administration, and vessel schedules into route/action-level technical cartography.

**Architecture:** Keep `operacao-suporte.md` as the owner of the six smaller internal surfaces and `chegadas-saidas.md` as the owner of the independent customer-facing vessel schedule board. Trace each remote action from page/component through query or service to Supabase and focused tests.

**Tech Stack:** React 19, React Router, TanStack Query, Supabase, XLSX, Markdown, Mermaid, Vitest.

---

## Files

- Modify: `docs/modules/operacao-suporte.md`
- Modify: `docs/modules/chegadas-saidas.md`

Do not modify product code or migrations.

### Task 1: Rebuild the Operation and Support Document Structure

**Files:**

- Modify: `docs/modules/operacao-suporte.md`
- Read: `src/App.tsx`
- Read: `src/components/layout/AppLayout.tsx`
- Read: `src/components/layout/HeaderInfoBar.tsx`
- Read: `src/components/layout/appLayoutNav.ts`
- Read: `src/components/layout/ProtectedRoute.tsx`

- [ ] **Step 1: Replace the compact structure with the shared contract**

Use these exact top-level headings:

```markdown
## Propósito e escopo
## Anatomia das telas
## Catálogo de ações
## Estado e dados
## Fluxos e invariantes
## Testes e validação
## Notas e divergências
```

Under `Anatomia das telas`, use one subsection for:

```markdown
### `/painel`
### `/revisao`
### `/alertas`
### `/relatorios`
### `/line-up-tv` e `/line-up-tv/display`
### `/admin/usuarios`
```

- [ ] **Step 2: Document shared guards and navigation**

Record:

- all six surfaces are under `ProtectedRoute`;
- `/admin/usuarios` uses `adminOnly`;
- `/line-up-tv/display` is protected but outside `AppLayout`;
- `/line-up-tv` renders the redirect stub to `/painel`;
- `AppLayout` and `HeaderInfoBar` own logout and cross-module navigation;
- UI role filtering is UX only; RLS/RPC remains authoritative.

Evidence label: `Código`.

### Task 2: Map Dashboard, Alerts, Reports, Line-Up, and Admin Actions

**Files:**

- Modify: `docs/modules/operacao-suporte.md`
- Read: `src/pages/Painel.tsx`
- Read: `src/pages/Alertas.tsx`
- Read: `src/pages/Relatorios.tsx`
- Read: `src/pages/LineUpTV.tsx`
- Read: `src/pages/LineUpTVDisplay.tsx`
- Read: `src/pages/AdminUsuarios.tsx`
- Read: `src/components/lineup/LineUpTable.tsx`
- Read: `src/services/lineup.ts`
- Read: `src/services/alerts.ts`
- Read: `src/services/reports.ts`
- Read: `src/services/adminUsers.ts`
- Read: `src/hooks/useOperationalAlerts.ts`
- Read: `src/hooks/useOperationalCounts.ts`
- Test: `src/services/__tests__/reports.test.ts`
- Test: `src/components/layout/__tests__/AppLayout.test.ts`

- [ ] **Step 1: Add one action table per surface**

Use this exact column contract:

```markdown
| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
```

Catalog at least these actions:

```text
/painel
- carregar KPIs
- carregar snapshot de Line-Up
- navegar por cards/atalhos

/alertas
- filtrar por status
- reconhecer alerta
- fechar alerta

/relatorios
- consultar aba operacional
- consultar aba financeira
- consultar aba clientes
- consultar aba demurrage
- exportar cada conjunto XLSX

/line-up-tv
- redirecionar para /painel

/line-up-tv/display
- atualizar snapshot automaticamente
- alternar carrossel/linhas
- solicitar fullscreen

/admin/usuarios
- listar perfis
- alterar role
- ativar/desativar usuário
- filtrar audit log
- carregar métricas
```

- [ ] **Step 2: Record exact data ownership**

Include:

- `['dashboard']`, `['lineup-tv-v3']`, `['lineup-tv-display-v2']`;
- `['alerts', statusFilter]` and invalidations for `alerts`, `op-count`, `dashboard`;
- report query keys and 2,000-row query limits;
- `['admin-users']`, `['admin-audit-logs', filters]`, `['admin-metrics']`;
- direct table reads in `Painel.tsx` and `AdminUsuarios.tsx`;
- `fetchLineUpSnapshot` joins and deduplication rules.

- [ ] **Step 3: Add test evidence**

Run:

```powershell
npx vitest run src/services/__tests__/reports.test.ts src/components/layout/__tests__/AppLayout.test.ts
```

Expected: exit `0`.

Label only assertions actually covered by these files as `Teste`. Leave uncaptured UI actions as `Código`.

### Task 3: Map the Review Gate and Automatic Billing Attempt

**Files:**

- Modify: `docs/modules/operacao-suporte.md`
- Read: `src/pages/Revisao.tsx`
- Read: `src/pages/revisaoHelpers.ts`
- Read: `src/components/shared/ReviewInlineEditors.tsx`
- Read: `src/hooks/useReview.ts`
- Read: `src/services/review.ts`
- Read: `src/services/reviewBillingAutomation.ts`
- Read: `src/services/customers.ts`
- Read: `src/services/charges/chargeOperationsService.ts`
- Read: `src/services/billing.ts`
- Read: `supabase/migrations/20260619120000_review_gate_canonical_pendencies.sql`
- Read: `supabase/migrations/20260619130000_review_gate_hardening.sql`
- Test: `src/pages/__tests__/Revisao.test.tsx`
- Test: `src/pages/__tests__/revisaoHelpers.test.ts`
- Test: `src/hooks/__tests__/useReview.test.ts`
- Test: `src/services/__tests__/review.test.ts`
- Test: `src/services/__tests__/reviewBillingAutomation.test.ts`
- Test: `src/services/__tests__/reviewGateCanonicalMigration.test.ts`
- Test: `src/services/__tests__/reviewGateHardeningMigration.test.ts`

- [ ] **Step 1: Catalog review actions**

Include:

- filter and group queue by customer/CNPJ;
- open and navigate the individual drawer by item ID;
- save individual review with optimistic lock;
- link existing customer to all B/Ls in a group;
- create/link customer from the queue;
- add customer email;
- provision and activate Portal account;
- recompute the canonical gate;
- calculate charges after the gate clears;
- attempt automatic invoice issue;
- resolve Granite customer link.

- [ ] **Step 2: Document the canonical gate sequence**

Add a Mermaid sequence showing:

```text
UI correction
→ customer/portal mutation
→ save_bl_review / recomputeBlReviewGate
→ compute_bl_review_pendencies
→ review_status result
→ calculateBlLocalCharges(recalculate)
→ markBlReadyAndCreateInvoice when eligible
→ query invalidations
```

Explicitly document:

- customer, email, active Portal with `auth_user_id`, and BB weight are the four gate conditions;
- CE Mercante is not a review gate condition;
- `save_bl_review` owns status/audit;
- `PT409` represents optimistic-lock conflict;
- automatic billing is attempted only after the returned pending list is empty.

- [ ] **Step 3: Run focused review tests**

Run:

```powershell
npx vitest run src/pages/__tests__/Revisao.test.tsx src/pages/__tests__/revisaoHelpers.test.ts src/hooks/__tests__/useReview.test.ts src/services/__tests__/review.test.ts src/services/__tests__/reviewBillingAutomation.test.ts src/services/__tests__/reviewGateCanonicalMigration.test.ts src/services/__tests__/reviewGateHardeningMigration.test.ts
```

Expected: exit `0`.

Mark migration text assertions as `Teste de contrato SQL`, not runtime proof.

### Task 4: Expand Chegadas e Saídas

**Files:**

- Modify: `docs/modules/chegadas-saidas.md`
- Read: `src/pages/ChegadasSaidas.tsx`
- Read: `src/components/portal/ShipScheduleWidget.tsx`
- Read: `src/hooks/useVesselSchedules.ts`
- Read: `src/services/vesselSchedules.ts`
- Read: `supabase/migrations/20260616000000_vessel_schedules.sql`

- [ ] **Step 1: Apply the shared section contract**

Keep `/chegadas-saidas` and the Portal widget in the same module document.

- [ ] **Step 2: Catalog every remote or file action**

Include:

- load active schedule;
- add vessel;
- edit vessel;
- reorder all rows;
- archive to `ended_vessels`;
- hard delete;
- download current template;
- import spreadsheet updates;
- load/export ended vessels;
- open MarineTraffic;
- Portal query and realtime invalidation.

- [ ] **Step 3: Preserve the confirmed schema divergence**

Keep the `taicang_etd` discrepancy as `Suspeita`, with:

- code references;
- migration reference;
- impact;
- condition for confirmation: inspect controlled/live schema;
- no claim that the remote column exists.

- [ ] **Step 4: Record missing automated coverage**

State that the page has no focused test file. Do not manufacture `Teste` evidence. Point the runtime plan to CRUD, spreadsheet, archive, Portal widget, and realtime checks.

### Task 5: Verify and Commit

**Files:**

- Modify: `docs/modules/operacao-suporte.md`
- Modify: `docs/modules/chegadas-saidas.md`

- [ ] **Step 1: Check headings and action tables**

Run:

```powershell
rg -n "^## (Propósito e escopo|Anatomia das telas|Catálogo de ações|Estado e dados|Fluxos e invariantes|Testes e validação|Notas e divergências)$" docs/modules/operacao-suporte.md docs/modules/chegadas-saidas.md
rg -n "\| Tela / ação \| Pré-condições \| Origem \| Orquestração \| Persistência \| Efeitos e cache \| Falhas \| Evidência \|" docs/modules/operacao-suporte.md docs/modules/chegadas-saidas.md
```

Expected: seven headings in each file and at least one action-table header in each.

- [ ] **Step 2: Run documentation and whitespace checks**

```powershell
npm run docs:check
git diff --check
```

Expected: `docs:check` may still fail for other unfinished module documents and missing `docs/RASTREABILIDADE.md`; it must not report either file owned by this plan.

- [ ] **Step 3: Commit**

```powershell
git add -- docs/modules/operacao-suporte.md docs/modules/chegadas-saidas.md
git commit -m "docs: map operation support and vessel schedules"
```

