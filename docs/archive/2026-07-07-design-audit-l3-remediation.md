# Design Audit L3 Remediation — Implementation Plan

> **STATUS: ✅ CONCLUÍDO — 2026-07-07**
> Todas as 5 fatias foram executadas e commitadas em `main`
> (commit `f9b3cfd9`). Ver walkthrough em
> `docs/archive/2026-07-07-design-audit-l3-remediation.md`.

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: seção "L3 — propostas" da
> [auditoria de design 2026-07-07](design-audit/README-2026-07-07.md), PR
> [#335](https://github.com/luccafwlog/transhipping-desk2/pull/335). Aquela
> auditoria classificou estes 5 achados como L3 — mudam padrão de componente
> ou dependem de decisão de produto — e não os aplicou. Este plano consolida
> cada um em fatia revisável e independente.

**Goal:** Fechar as inconsistências estruturais que a auditoria de design
identificou mas não corrigiu por exigirem decisão de padrão (não é escolha
óbvia entre A e B) ou por mudarem a forma de uma tela, não só o conteúdo —
sem alterar semântica de dinheiro, fluxo de exclusão ou RLS.

**Architecture:** Todas as fatias são UI (`pages`/`components` → estilos/
markup). Nenhuma toca migração, RPC ou `src/lib/pix.ts`. As fatias são
independentes e mergeáveis separadamente; a ordem prioriza risco (menor
primeiro) e dependência de validação externa (maior por último).

**Tech Stack:** TypeScript, Vitest, React, Tailwind (utilitário via
`className`), `lucide-react` (ícones).

**Fontes de verdade:** `CONTEXT.md` · `docs/ARCHITECTURE.md` ·
`docs/CONVENCOES.md` ·
[auditoria de design 2026-07-07](design-audit/README-2026-07-07.md).

---

## Prioridades da auditoria

| # | Achado (L3 da auditoria 2026-07-07) | Risco | Fatia | Status |
|---|--------------------------------------|-------|-------|--------|
| L1 | Dois rodapés de paginação coexistem: o componente compartilhado `TableFooterPagination` e um bloco JSX duplicado em `InvoicesTable.tsx`/`ReconciliationHistoryTable.tsx`. Foi por isso que a regressão de acento ("Pagina"/"Proxima") encontrada na v2 só corrigiu 1 dos 2 lugares na primeira tentativa | Baixo | Slice 1 | ✅ |
| L2 | Ações icon-only em `ChargeTablesTab.tsx` (Taxas Locais): o botão "Inativar tabela" usa o ícone `X`, que lê como "fechar/cancelar", não "desativar uma tabela tarifária inteira" — apesar de já ter `title`/`aria-label` corretos | Baixo | Slice 2 | ✅ |
| L3 | Lixeira solta por linha em `Manifestos.tsx` (~L475) e `Containers.tsx` (~L465), mesmo padrão que foi corrigido em `Clientes.tsx` (D6, auditoria 2026-07-06) movendo para menu "…" | Médio — decisão de padrão | Slice 3 | ✅ |
| L4 | Tipografia da marca (Syne/DM Sans/IBM Plex Mono) carregada via `@import url(fonts.googleapis.com/...)` em tempo de execução (`src/index.css:1`) — qualquer bloqueio de rede derruba para fallback do SO (reproduzido neste próprio sandbox) | Médio — nova dependência | Slice 4 | ✅ |
| L5 | KPIs sem hierarquia: 7–8 `SummaryCard`/`MetricCard` de peso visual idêntico em Manifestos, Carga Solta, Containers, Faturamento, Relatórios, Clientes, ClienteFicha — nenhum ponto focal indicando qual métrica pede ação | Alto — muda desenho da tela | Slice 5 | ✅ |

---

## Slice 1 — Rodapé de paginação único

Menor risco, maior alavancagem: fecha a causa raiz da regressão de acento
vista na v2 (a copy "Página X de Y" vivia em dois lugares).

- [x] **`InvoicesTable.tsx`** (`app-table__footer` em linha única, ~L107):
  substituir o bloco manual por `<TableFooterPagination page={page}
  pageSize={...} totalCount={totalCount} totalPages={totalPages}
  onPageChange={onPageChange} />`. Como a tela não expõe seletor de
  `pageSize` hoje, omitir `onPageSizeChange` (prop já é opcional).
- [x] **`ReconciliationHistoryTable.tsx`** (~L300): mesma substituição;
  preservar o `Select` de "Itens por página" que já existe fora do footer
  (`onPageSizeChange` pode passar a viver dentro do componente compartilhado
  se fizer sentido, ou continuar externo — decisão de implementação, não
  muda comportamento visível).
- [x] Remover qualquer CSS/classe que ficou órfã só por causa dos blocos
  manuais removidos.

## Slice 2 — Ícone de "Inativar tabela" em Taxas Locais

Só troca de ícone/rótulo, sem mudança de comportamento.

- [x] Em `src/components/taxasLocais/ChargeTablesTab.tsx` (~L614), trocar o
  ícone `X` do botão de inativar por `Ban` de `lucide-react`.

## Slice 3 — Padrão de exclusão por linha (Manifestos, Containers)

- [x] Mover o botão de exclusão de `Manifestos.tsx` e `Containers.tsx`
  para dentro de um menu de ações "…" seguindo a implementação de
  `Clientes.tsx` (`app-floating-menu__danger`, `role="menuitem"`).

## Slice 4 — Self-host das fontes da marca

- [x] Trocar `@import url('https://fonts.googleapis.com/...')` em
  `src/index.css:1` por arquivos `.woff2` estáticos em `public/fonts/` +
  `@font-face` manual via `src/fonts.css`.

## Slice 5 — Hierarquia visual dos KPIs

- [x] Criar variante `.app-metric-tile--primary` em `src/index.css` e
  prop `tone="primary"` em `MetricCard`.
- [x] Replicar o padrão nas 7 telas: Manifestos, Carga Solta, Containers,
  Faturamento, Relatórios, Clientes, ClienteFicha.

---

## Ordem de ataque recomendada

1. **Slice 1** ✅ — menor risco, maior alavancagem.
2. **Slice 2** ✅ — troca de ícone isolada.
3. **Slice 4** ✅ — self-host de fontes.
4. **Slice 3** ✅ — menu flutuante de exclusão.
5. **Slice 5** ✅ — hierarquia de KPIs.
