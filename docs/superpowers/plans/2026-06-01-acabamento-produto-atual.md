# Acabamento do Produto Atual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar o ciclo de acabamento do produto atual nas frentes de validacao operacional, estados de tabelas e reconciliacao manual.

**Architecture:** Preservar paginas, hooks, services e RPCs existentes. Adicionar apenas helpers pequenos quando houver comportamento compartilhado e aplicar nas telas priorizadas sem redesenhar o produto.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest, Supabase.

---

### Task 1: Validacao Operacional

**Files:**
- Modify: `docs/VALIDACAO.md`

- [ ] **Step 1: Reescrever roteiro como checklist executavel**

Substituir o roteiro macro por secoes de fluxo contendo objetivo, ambiente, perfil, dados, pre-condicoes, passos, resultado esperado, evidencia, falhas comuns e testes relacionados.

- [ ] **Step 2: Verificar documentacao**

Run: `rg -n "TBD|TODO|pre-condicoes|evidencia|Supabase real" docs/VALIDACAO.md`
Expected: nenhuma ocorrencia de placeholder e ocorrencias suficientes dos campos exigidos.

### Task 2: Estados Operacionais Compartilhados

**Files:**
- Create: `src/lib/operationalState.ts`
- Test: `src/lib/__tests__/operationalState.test.ts`

- [ ] **Step 1: Escrever testes RED**

Testar contagem, descricao de filtros ativos, estado vazio com e sem filtro e resumo de reconciliacao manual.

- [ ] **Step 2: Rodar teste e confirmar falha**

Run: `npm test -- src/lib/__tests__/operationalState.test.ts`
Expected: FAIL por modulo inexistente.

- [ ] **Step 3: Implementar helpers minimos**

Criar funcoes puras para textos de estado, filtros e pendencias.

- [ ] **Step 4: Rodar teste e confirmar sucesso**

Run: `npm test -- src/lib/__tests__/operationalState.test.ts`
Expected: PASS.

### Task 3: Aplicar Estados em Telas Priorizadas

**Files:**
- Modify: `src/pages/Faturamento.tsx`
- Modify: `src/pages/Reconciliacao.tsx`
- Modify: `src/pages/TaxasLocais.tsx`
- Modify: `src/pages/Revisao.tsx`
- Modify: `src/pages/Viagens.tsx`
- Modify: `src/pages/Manifestos.tsx`
- Modify: `src/pages/VaziosImportacao.tsx`
- Modify: `src/pages/Granite.tsx`
- Modify: `src/pages/Demurrage.tsx`
- Modify: `src/pages/PortalBilling.tsx`

- [ ] **Step 1: Adicionar contagem e filtros ativos onde ja ha dados carregados**

Usar textos curtos inline e badges existentes. Nao alterar queries ou regras de permissao.

- [ ] **Step 2: Diferenciar vazio sem filtro e vazio com filtro**

Trocar mensagens genericas por mensagens derivadas dos filtros existentes.

- [ ] **Step 3: Preservar estados de erro e loading existentes**

Manter skeletons e `InlineError` atuais, ajustando apenas texto quando necessario.

### Task 4: Reconciliacao Manual

**Files:**
- Modify: `src/pages/Reconciliacao.tsx`
- Modify: `docs/VALIDACAO.md`

- [ ] **Step 1: Explicar ambiguidade PIX**

Mostrar origem, campo que causou ambiguidade, dados que conferem/divergem e risco residual antes da confirmacao.

- [ ] **Step 2: Preservar auditoria existente**

Confirmar que pagamentos automaticos continuam ignorando ambiguos e que a doc registra a limitacao de auditoria quando a persistencia depende de RPC/tabela existente.

### Task 5: Verificacao Final

- [ ] **Step 1: Rodar testes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Rodar build**

Run: `npm run build`
Expected: PASS.
