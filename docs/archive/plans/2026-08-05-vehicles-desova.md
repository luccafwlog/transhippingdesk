# Veículos: local de desova e consolidação no ADR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar o fluxo de local de desova em Veículos e adicionar os cards de consolidação no ADR.

**Architecture:** Reutilizar `unpacking_location` no container, manter parsing separado da persistência e buscar/selecionar o conjunto filtrado no backend. As agregações do ADR serão funções puras sobre os dados derivados existentes.

**Tech Stack:** React, TanStack Query, Supabase RPC/migrations, Vitest, XLSX.

---

### Task 1: Contrato de filtros e seleção global

**Files:** `src/hooks/useVehicles.ts`, `src/pages/Veiculos.tsx`, `src/hooks/useRowSelection.ts`, testes correspondentes.

- [ ] Cobrir filtro por local e seleção de todas as linhas filtradas.
- [ ] Expor contagem/IDs filtrados necessários para o checkbox e a ação em massa.
- [ ] Deduplicar containers e invalidar as consultas de Veículos, estatísticas e ADR após a gravação.

### Task 2: Parser e persistência da planilha

**Files:** `src/services/vehicleImport.ts`, migration sequencial, `src/pages/Veiculos.tsx`, fixtures/testes.

- [ ] Cobrir coluna opcional `Local de desova`, aliases e planilha antiga sem a coluna.
- [ ] Propagar o valor ao contrato da RPC transacional e ao container correspondente.
- [ ] Verificar rejeições e idempotência sem aceitar sucesso parcial silencioso.

### Task 3: Cards de consolidação do ADR

**Files:** `src/services/agencyDepartureReport.ts`, `src/components/voyages/VoyageAgencyReportTab.tsx`, testes.

- [ ] Criar agregação pura de containers distintos por tipo e veículos por modelo.
- [ ] Renderizar dois cards na seção de Veículos, preservando totais de VINs e locais.
- [ ] Cobrir duplicidade de linhas e dados ausentes.

### Task 4: Gates e publicação

- [ ] Rodar testes focados, `npm run typecheck`, lint dos arquivos alterados, `npm run docs:check`, `npm test`, `npm run build` e `git diff --check`.
- [ ] Commitar em `main` e fazer push para `origin/main`.
