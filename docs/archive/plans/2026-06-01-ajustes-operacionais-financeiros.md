# Ajustes Operacionais e Financeiros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir inconsistencias de importacao, reconciliacao Baplie x Manifesto, clientes e faturamento apontadas na sessao de triagem.

**Architecture:** Fazer mudancas cirurgicas nas paginas e services existentes, preservando o desenho atual React/Vite + Supabase + React Query. Separar correcoes com regra fechada de investigacoes funcionais, para evitar unificar fluxos financeiros sem entender o efeito atual no ledger e nas invoices.

**Tech Stack:** React, TypeScript, Vite, Supabase, React Query, Vitest, Testing Library, xlsx.

---

## Assumptions Fechadas

- POD criado por manifesto ou Baplie conta como escala planejada, mesmo sem datas. O campo `linked`/`ESCALA` indica vinculo interno aos manifestos, nao existencia da escala.
- Modal de Baplie deve mostrar a viagem como contexto travado/informativo quando aberto a partir de uma viagem selecionada.
- Confirmar vazios a partir do Baplie tambem cria manifesto de vazios. O aviso de manifesto existente nao deve aparecer como conflito imediatamente apos a primeira criacao.
- Resumos de manifestos devem somar containers distintos.
- Exportacao de Vazios - Importacao deve respeitar filtros ativos.
- OOG nunca gera divergencia Baplie x Manifesto; Baplie sempre prevalece.
- IMO deve permitir prevalecer Baplie ou Manifesto, por linha, selecao multipla e aplicacao em massa.
- Saldo pendente de cliente deve considerar apenas invoices `issued`.
- Regras Comerciais devem ser removidas da ficha do cliente.
- Na ficha do cliente, invoice clicada abre detalhe da invoice; botao separado abre Faturamento filtrado pelo cliente.
- Faturamento deve ser primeiro no menu Financeiro.
- Badge de Faturamento deve ser apenas alerta visual, aparecer somente quando houver B/L na aba Pendencias e desaparecer quando nao houver.
- Validação e Pendências têm propósito distinto, mas deve ser proposta uma tentativa de unificação operacional.
- Conciliação PIX deve respeitar o comportamento já escrito no código.

---

## Execucao Recomendada

### Onda 1: Correcoes Diretas de Baixo Risco

**Files:**
- Modify: `src/pages/Viagens.tsx`
- Modify: `src/pages/Baplie.tsx`
- Modify: `src/pages/VaziosImportacao.tsx`
- Modify: `src/services/exports.ts`
- Modify: `src/pages/Revisao.tsx`
- Modify: `src/index.css` if the search icon fix is CSS-only
- Test: relevant existing Vitest suites under `src/pages/__tests__` and `src/services/__tests__`

- [ ] Corrigir contador de escalas em `Viagens.tsx`.
  - Current risk: `plannedPodCount` counts only rows with ETA/ETB/ATA/ATD.
  - New rule: count every POD row present in planning/import context, including rows created from manifest/Baplie, regardless of `linked`.
  - Verify with a test/helper if available, or add one around the pure calculation if extraction is needed.

- [ ] Change Baplie upload modal voyage field.
  - When `initialVoyageId` exists, render selected voyage as read-only text or disabled select.
  - Keep selectable behavior only if no voyage is selected.
  - Sync local modal state when `initialVoyageId` changes before opening.

- [ ] Prevent self-conflict after confirming Baplie empties.
  - Keep `importVaziosFromBaplie` as the creator of the empty manifest.
  - After successful first creation, show success state or hide action instead of showing "substituir/manter" as an immediate conflict.
  - Keep substitute/keep flow for a pre-existing manifest before the user confirms.

- [ ] Add export button to `VaziosImportacao`.
  - Add `Download` icon button beside "Importar Planilha".
  - Fetch all rows matching current filters, not just current page.
  - Add `exportVaziosImportacaoWorkbook` in `src/services/exports.ts`.
  - Export columns: Container, Tipo, Tara (kg), POD, Navio, Viagem, Manifesto, Importado em.

- [ ] Fix search icon spacing in `Revisao`.
  - Adjust input padding/icon positioning so the magnifier does not overlap the placeholder.
  - Verify visually in desktop width shown by the user.

### Onda 2: Baplie x Manifesto

**Files:**
- Modify: `src/services/baplieReconciliation.ts`
- Modify: `src/pages/Baplie.tsx`
- Test: `src/services/__tests__/baplieReconciliation.test.ts` if created, or existing reconciliation tests if present

- [ ] Exclude OOG from divergences.
  - Remove `is_oog` comparison from `reconcileBaplieWithManifest`.
  - Keep OOG from Baplie visible in staging stats and container list.

- [ ] Add "prevalecer manifesto" support for IMO fields.
  - Current function only applies Baplie values into `bl_containers`.
  - Add an explicit action that marks the divergence as resolved by keeping manifest value, without overwriting `bl_containers`.
  - If no persisted resolution table exists, implement the smallest durable option: either audit-log-only resolution if sufficient for current query, or a migration-backed resolution table if the divergence would reappear forever.

- [ ] Add multi-select and bulk actions.
  - Add checkboxes to divergence rows.
  - Add bulk buttons: "Aplicar Baplie aos selecionados", "Manter Manifesto nos selecionados", "Aplicar Baplie a todos IMO", "Manter Manifesto em todos IMO".
  - Restrict bulk actions to IMO-related rows (`is_imo`, `imo_class`, `un_number`) after OOG is removed.

### Onda 3: Clientes e Invoices

**Files:**
- Modify: `src/hooks/useCustomers.ts`
- Modify: `src/pages/Clientes.tsx`
- Modify: `src/pages/ClienteFicha.tsx`
- Modify: `src/services/customers.ts`
- Optional migration cleanup later: `supabase/migrations/023_customer_commercial_rules.sql` remains historical and should not be edited
- Test: `src/services/__tests__/customers.test.ts`, page tests if present

- [ ] Recalculate customer pending balance from issued invoices.
  - Replace reliance on `customers.pending_balance` in list/summary/detail with query-derived total of invoices where `status = 'issued'`.
  - Ensure filters "Com saldo pendente" and "Sem saldo pendente" use the same derived value.
  - Include this value in customer detail.

- [ ] Remove "Sem complemento cadastral".
  - In `Clientes.tsx`, render city/state/address only when present.
  - Do not render fallback text.

- [ ] Remove Regras Comerciais UI and save flow.
  - Remove section from `ClienteFicha.tsx`.
  - Remove local state and handler for commercial rules.
  - Keep historical database columns untouched unless a later migration is explicitly requested.

- [ ] Improve customer invoice navigation.
  - Make invoice number in `ClienteFicha.tsx` link to `/faturamento?customer=<id>&invoice=<invoiceId>`.
  - Add distinct button "Ver no Faturamento" linking to `/faturamento?customer=<id>`.
  - Ensure `Faturamento.tsx` opens invoice detail when `invoice` query param is present.

### Onda 4: Faturamento, Menu e Conciliação

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`
- Modify: `src/hooks/useOperationalCounts.ts`
- Modify: `src/pages/Faturamento.tsx`
- Modify: `src/components/billing/ValidacaoTab.tsx`
- Modify: `src/pages/Reconciliacao.tsx`
- Modify: `src/services/reconciliacao.ts` only if the investigation finds mismatch between code and UI
- Test: `src/pages/__tests__/Faturamento.test.ts`, `src/services/__tests__/reconciliacao.test.ts`

- [ ] Reorder Financeiro menu.
  - Move `/faturamento` before `/taxas-locais`.

- [ ] Change Faturamento badge to boolean alert.
  - Replace numeric badge display for `/faturamento` with dot/alert when pending rows exist.
  - Source should be the same condition that feeds the Pendencias tab.
  - Parent Financeiro badge should not sum this as `99+`; it should show alert presence only.

- [ ] Document current distinction between Validação and Pendências.
  - Validação: operational readiness and blocking stages before billing.
  - Pendências: charge calculation/review blockers.
  - Confirm actual code matches this split.

- [ ] Prototype unification proposal before coding unification.
  - Candidate: one "Operacional" tab with priority lanes from `ValidacaoTab` plus a subsection/table for charge review pendencies.
  - Keep Faturas and Demurrage tabs separate.
  - Do not remove either tab until the unified view is reviewed with real data.

- [ ] Audit Conciliação PIX behavior.
  - Current code matches local invoices by TXID and calls `reconcileInvoicePaymentByTxid`.
  - Demurrage is marked `paid` directly in `demurrage_invoices`.
  - Add visible post-confirmation summary or history only if there is no traceable way to audit reconciled payments from Faturamento/Demurrage.

### Onda 5: Manifest Import Modal Summary

**Files:**
- Modify: `src/components/shared/VoyageImportActions.tsx`
- Modify: `src/components/shared/FileImportModal.tsx`
- Modify: `src/services/manifestParser.ts`
- Modify: `src/services/manifestImport.ts` only if preview aggregation requires service shape changes
- Test: `src/services/__tests__/manifestParser.test.ts`, `src/services/__tests__/manifestImport.test.ts`, modal tests if present

- [ ] Remove customer/CNPJ instructional note from manifest import modal.
- [ ] Add final consolidated manifest list.
  - Show one row per selected file/manifest with filename, POL, POD, B/L count and distinct container count.
  - Show grand total of distinct containers across all selected manifests.
  - Keep per-file preview navigation intact for detailed inspection.

---

## Verification Commands

- `npm run test`
- `npm run build`
- Targeted tests during work:
  - `npx vitest run src/services/__tests__/manifestParser.test.ts src/services/__tests__/manifestImport.test.ts`
  - `npx vitest run src/services/__tests__/reconciliacao.test.ts`
  - `npx vitest run src/pages/__tests__/Faturamento.test.ts`
  - `npx vitest run src/services/__tests__/customers.test.ts`

---

## Open Decisions Before Implementation

- For IMO "Manter Manifesto": confirm whether an audit log is enough to suppress the same divergence, or whether a persisted reconciliation-resolution table is required.
- For customer pending balance: decide whether `partially_paid` should be intentionally excluded even if it has balance. Current rule says only `issued`.
- For unified Faturamento tab: review a running screen with real data before removing any existing tab.
- For Conciliação PIX: inspect ledger RPC behavior before changing payment/status logic.
