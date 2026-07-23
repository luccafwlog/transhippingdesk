# Redesign da Tela de Faturamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recriar no produto React a tela de Faturamento do handoff `Faturamento.dc.html`, preservando os dados reais, integrações e fluxos existentes.

**Architecture:** A página existente continuará orquestrando estado, URL, queries e ações. O trabalho será concentrado nos componentes atuais de billing e em classes/tokens globais já usados pelo design system; o HTML do handoff será referência visual, não será copiado para produção nem substituirá a camada de dados.

**Tech Stack:** React, TypeScript, TanStack React Query, Vitest, Testing Library, CSS existente em `src/index.css`, componentes compartilhados em `src/components/ui`.

**Status:** Concluído em 2026-07-23. As superfícies de Validação e Pendências já utilizavam os componentes e tokens compartilhados; foram verificadas sem necessidade de alteração estrutural.

---

### Task 1: Ajustar tokens e composição geral da página

**Files:**
- Modify: `src/index.css` — tokens, fundo pontilhado, abas e modal.
- Modify: `src/pages/Faturamento.tsx` — cabeçalho, alertas, abas e composição das métricas.
- Test: `src/pages/__tests__/Faturamento.test.ts` — contrato de abas e ações visíveis.

- [ ] **Step 1: Registrar os contratos visuais que ainda não existem nos testes**

  Cobrir o cabeçalho com a ação `Nova Consolidada`, as quatro abas e a ausência de ações de invoice individual.

- [ ] **Step 2: Aplicar no CSS as quatro mudanças do handoff**

  Atualizar `.app-modal` para `border: none`; usar `.app-navy` sólido, texto branco e filete `.app-gold` em `.app-tab--active`; manter abas inativas legíveis em `var(--app-surface)`.

- [ ] **Step 3: Reorganizar a página sem alterar contratos de dados**

  Manter `useInvoices`, `useQuery`, `useSearchParams`, exportação, detecção de vencidos e callbacks atuais. Ajustar apenas a hierarquia para que os alertas, abas e conteúdo sigam o container e espaçamentos do handoff.

- [ ] **Step 4: Rodar o teste da página**

  Run: `npx vitest run src/pages/__tests__/Faturamento.test.ts src/pages/__tests__/Faturamento.behavior.test.tsx`
  Expected: PASS.

### Task 2: Recriar a aba Faturas com alta fidelidade

**Files:**
- Modify: `src/components/billing/InvoiceFiltersBar.tsx` — filtros compactos, eyebrow e limpeza.
- Modify: `src/components/billing/InvoicesTable.tsx` — cabeçalho, colunas, estados e rodapé.
- Modify: `src/pages/Faturamento.tsx` — grid de cinco métricas e agrupamento da aba.
- Test: `src/components/billing/__tests__/` e `src/pages/__tests__/Faturamento.test.ts` — filtros e renderização.

- [ ] **Step 1: Verificar os testes existentes dos componentes antes da edição**

  Executar os testes relacionados e preservar os contratos de filtros, paginação, status e seleção de invoice.

- [ ] **Step 2: Implementar a barra de filtros compacta**

  Usar os componentes existentes de Field/Input/Select, manter todos os filtros funcionais e exibir `Limpar (N)` somente quando `activeFilterCount > 0`.

- [ ] **Step 3: Implementar a composição visual da tabela**

  Manter as colunas e ações existentes, adicionando a hierarquia do handoff: contagem de resultados, ordenação recente, tabela compacta, estados de loading/erro/vazio e paginação desabilitada quando aplicável.

- [ ] **Step 4: Ajustar as métricas para uma única faixa responsiva**

  Exibir Saldo aberto, Faturas filtradas, Pagas, Consolidadas e Vencidas sem recalcular dados no componente visual. O valor de saldo deve continuar vindo do ledger/query atual.

- [ ] **Step 5: Rodar os testes focados de billing**

  Run: `npx vitest run src/components/billing/__tests__ src/pages/__tests__/Faturamento.test.ts src/pages/__tests__/Faturamento.behavior.test.tsx`
  Expected: PASS.

### Task 3: Alinhar as abas Validação, Pendências e Demurrage

**Files:**
- Modify: `src/components/billing/ValidacaoTab.tsx` e `src/components/billing/ValidacaoControls.tsx` — card explicativo e controle segmentado.
- Modify: `src/components/billing/PendenciasFaturamentoTab.tsx` e `src/components/billing/PendenciasTable.tsx` — cards por viagem e tabela interna.
- Modify: `src/components/billing/DemurrageInvoicesSection.tsx` — faixa de ROE, tabela e detalhe.
- Test: testes existentes em `src/components/billing/__tests__` e `src/services/demurrage/__tests__` — preservar fluxos.

- [ ] **Step 1: Rodar os testes atuais dessas três superfícies**

  Identificar contratos funcionais antes de mexer em markup ou classes.

- [ ] **Step 2: Aplicar a hierarquia visual do handoff à Validação**

  Preservar o sign-off otimista por linha e destacar Pendente, Confirmado e Divergência com os tokens existentes.

- [ ] **Step 3: Aplicar cards por viagem à Pendências**

  Preservar o botão que abre `ConsolidatedInvoiceModal`, o cliente pré-selecionado, B/L, dias desde descarga e valor estimado.

- [ ] **Step 4: Aplicar a composição de Demurrage**

  Preservar queries e modal de detalhe; apresentar ROE vigente, tabela compacta e ação `Ver detalhe` com os estados reais.

- [ ] **Step 5: Rodar os testes focados novamente**

  Run: `npx vitest run src/components/billing src/components/demurrage src/services/demurrage`
  Expected: PASS.

### Task 4: Refinar os modais e acessibilidade visual

**Files:**
- Modify: `src/components/billing/InvoiceDetailModal.tsx` — métricas, ações e tabela de itens.
- Modify: `src/components/billing/ConsolidatedInvoiceModal.tsx` — seleção, total e ação primária.
- Modify: `src/components/billing/DemurrageInvoicesSection.tsx` — conteúdo do detalhe demurrage.
- Modify: `src/index.css` — responsividade, tabela e estados hover/focus.
- Test: `src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx`, `src/components/billing/__tests__/InvoiceDetailPrint.test.tsx` e testes de demurrage existentes.

- [ ] **Step 1: Preservar os fluxos de abrir/fechar e impressão**

  Confirmar que `window.print()`, cancelamento/obsolescência, seleção de B/Ls e fechamento continuam funcionando.

- [ ] **Step 2: Aplicar as métricas e tabelas do handoff nos modais**

  Reusar `MetricCard`, `Modal`, `Button`, `Badge` e componentes equivalentes; não criar HTML paralelo nem dados mockados.

- [ ] **Step 3: Garantir foco, labels e overflow em viewport estreita**

  Manter labels associados aos campos, ações com texto/aria-label e tabelas dentro de wrappers com scroll horizontal.

- [ ] **Step 4: Rodar os testes de modais**

  Run: `npx vitest run src/components/billing/__tests__/ConsolidatedInvoiceModal.test.tsx src/components/billing/__tests__/InvoiceDetailPrint.test.tsx src/components/demurrage/__tests__`
  Expected: PASS.

### Task 5: Verificação completa e encerramento

**Files:**
- Modify: `docs/plans/2026-07-23-faturamento-redesign.md` — marcar tarefas concluídas.
- Move: `docs/plans/2026-07-23-faturamento-redesign.md` para `docs/archive/plans/` após a implementação completa.
- Modify: `docs/plans/README.md` — remover o plano depois de arquivá-lo, se houver índice ativo.

- [ ] **Step 1: Verificar o diff e a documentação**

  Run: `git diff --check`; `npm run docs:check`
  Expected: PASS e nenhum arquivo fora do escopo.

- [ ] **Step 2: Executar os gates do projeto**

  Run: `npm run lint`; `npm test`; `npm run build`
  Expected: todos PASS.

- [ ] **Step 3: Fazer revisão final do diff**

  Conferir que não há dados mockados introduzidos, regressões de URL/query, mudanças de domínio ou remoção de funcionalidades existentes.

- [ ] **Step 4: Arquivar o plano concluído**

  Mover o plano para `docs/archive/plans/` somente depois dos gates verdes e atualizar o índice vivo conforme as convenções.

- [ ] **Step 5: Commitar na branch atual**

  Run: `git add src docs`; `git commit -m "feat: redesign faturamento"`
  Expected: commit criado na branch já existente, preservando alterações não relacionadas.
