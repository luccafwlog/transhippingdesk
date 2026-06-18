# Auto-faturamento Após Revisão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir automaticamente a fatura após corrigir o cliente no modal de revisão e impedir estados prontos sem valor faturável.

**Architecture:** O modal reutiliza `tryAutoIssueInvoice`, já usado pelos vínculos inline e em lote. Uma migração recria `mark_bl_ready_for_billing` com um guard adicional sobre as linhas calculadas.

**Tech Stack:** React, TypeScript, Vitest, PostgreSQL PL/pgSQL, Supabase.

---

### Task 1: Automação no modal

**Files:**
- Modify: `src/pages/Revisao.tsx`
- Test: `src/pages/__tests__/Revisao.test.tsx`

- [x] Criar teste que salva o modal com cliente selecionado e exige `tryAutoIssueInvoice`.
- [x] Executar o teste e confirmar falha.
- [x] Chamar a automação após `saveBlReview`.
- [x] Exibir o resultado da emissão ou bloqueio.
- [x] Executar o teste e confirmar sucesso.

### Task 2: Guard de faturabilidade

**Files:**
- Create: `supabase/migrations/20260618163840_guard_invoiceable_ready_state.sql`
- Create: `src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts`

- [x] Criar teste que exige validação de linha BRL positiva.
- [x] Executar o teste e confirmar falha com migração vazia.
- [x] Recriar `mark_bl_ready_for_billing` com o guard.
- [x] Executar o teste e confirmar sucesso.

### Task 3: Publicação e reparo

**Files:**
- Modify: `docs/superpowers/plans/2026-06-18-auto-faturamento-apos-revisao.md`

- [x] Executar testes completos, lint e build.
- [x] Aplicar a migração no Supabase remoto.
- [x] Recalcular e faturar `CSC07831507R00`.
- [x] Confirmar fatura e saldo no banco.
- [x] Commitar e enviar para `main`.
