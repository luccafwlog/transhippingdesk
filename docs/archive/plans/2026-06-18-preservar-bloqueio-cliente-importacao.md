# Preservar Bloqueio de Cliente na Importação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que B/Ls sem cliente sejam classificados incorretamente como sem tabela de preços.

**Architecture:** Recriar a função transacional de importação sem o pós-processamento que infere a causa pela ausência de cálculos. Os componentes especializados existentes permanecem responsáveis pelos respectivos bloqueios.

**Tech Stack:** PostgreSQL PL/pgSQL, Supabase migrations, Vitest.

---

### Task 1: Regressão do contrato SQL

**Files:**
- Create: `src/services/__tests__/manifestImportBillingReasonMigration.test.ts`
- Create: `supabase/migrations/20260618145508_preserve_customer_billing_block_reason.sql`

- [x] Escrever teste que exige a recriação da função e rejeita a inferência genérica.
- [x] Executar o teste e confirmar falha com a migração vazia.
- [x] Recriar a função removendo somente o bloco `bls_without_charges`.
- [x] Executar o teste específico e confirmar sucesso.
- [x] Executar testes completos e build.
- [x] Commitar e enviar para `main`.
