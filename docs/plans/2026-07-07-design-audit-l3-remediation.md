# Design Audit L3 Remediation — Implementation Plan

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: seção "L3 — propostas" da
> [auditoria de design 2026-07-07](../design-audit/README.md), PR
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
[auditoria de design 2026-07-07](../design-audit/README.md).

---

## Prioridades da auditoria

| # | Achado (L3 da auditoria 2026-07-07) | Risco | Fatia |
|---|--------------------------------------|-------|-------|
| L1 | Dois rodapés de paginação coexistem: o componente compartilhado `TableFooterPagination` e um bloco JSX duplicado em `InvoicesTable.tsx`/`ReconciliationHistoryTable.tsx`. Foi por isso que a regressão de acento ("Pagina"/"Proxima") encontrada na v2 só corrigiu 1 dos 2 lugares na primeira tentativa | Baixo | Slice 1 |
| L2 | Ações icon-only em `ChargeTablesTab.tsx` (Taxas Locais): o botão "Inativar tabela" usa o ícone `X`, que lê como "fechar/cancelar", não "desativar uma tabela tarifária inteira" — apesar de já ter `title`/`aria-label` corretos | Baixo | Slice 2 |
| L3 | Lixeira solta por linha em `Manifestos.tsx` (~L475) e `Containers.tsx` (~L465), mesmo padrão que foi corrigido em `Clientes.tsx` (D6, auditoria 2026-07-06) movendo para menu "…" | Médio — decisão de padrão | Slice 3 |
| L4 | Tipografia da marca (Syne/DM Sans/IBM Plex Mono) carregada via `@import url(fonts.googleapis.com/...)` em tempo de execução (`src/index.css:1`) — qualquer bloqueio de rede derruba para fallback do SO (reproduzido neste próprio sandbox) | Médio — nova dependência | Slice 4 |
| L5 | KPIs sem hierarquia: 7–8 `SummaryCard`/`MetricCard` de peso visual idêntico em Manifestos, Carga Solta, Containers, Faturamento, Relatórios, Clientes, ClienteFicha — nenhum ponto focal indicando qual métrica pede ação | Alto — muda desenho da tela | Slice 5 |

---

## Slice 1 — Rodapé de paginação único

Menor risco, maior alavancagem: fecha a causa raiz da regressão de acento
vista na v2 (a copy "Página X de Y" vivia em dois lugares).

- [ ] **`InvoicesTable.tsx`** (`app-table__footer` em linha única, ~L107):
  substituir o bloco manual por `<TableFooterPagination page={page}
  pageSize={...} totalCount={totalCount} totalPages={totalPages}
  onPageChange={onPageChange} />`. Como a tela não expõe seletor de
  `pageSize` hoje, omitir `onPageSizeChange` (prop já é opcional).
- [ ] **`ReconciliationHistoryTable.tsx`** (~L300): mesma substituição;
  preservar o `Select` de "Itens por página" que já existe fora do footer
  (`onPageSizeChange` pode passar a viver dentro do componente compartilhado
  se fizer sentido, ou continuar externo — decisão de implementação, não
  muda comportamento visível).
- [ ] Remover qualquer CSS/classe que ficou órfã só por causa dos blocos
  manuais removidos.
- **verify:** `npm test` (suites de `InvoicesTable`/`ReconciliationHistoryTable`
  e `Faturamento`/`Reconciliacao` behavior continuam verdes); screenshot das
  duas telas mostrando "Página X de Y · N registros" idêntico ao anterior;
  grep por `app-table__footer` fora de `TableFooterPagination.tsx` deve
  retornar zero.

## Slice 2 — Ícone de "Inativar tabela" em Taxas Locais

Só troca de ícone/rótulo, sem mudança de comportamento.

- [ ] Em `src/components/taxasLocais/ChargeTablesTab.tsx` (~L614), trocar o
  ícone `X` do botão de inativar por um que não leia como "fechar" (ex.:
  `PowerOff` ou `Ban` de `lucide-react`) — `Save` já é usado para o estado
  "reativar", manter simetria com o par escolhido.
  **verify:** screenshot antes/depois; `title`/`aria-label` já corretos, sem
  mudança de texto necessária.

## Slice 3 — Padrão de exclusão por linha (Manifestos, Containers)

**Decisão de produto:** este plano assume alinhar ao padrão que
`Clientes.tsx` já usa (menu flutuante "…" com item `danger` para exclusão),
por ser o mais recente e já validado. Se a operação preferir manter a
lixeira visível na linha (ela já está atrás de `isAdmin` + `ConfirmDialog`,
então não é one-click-destructive), este slice vira só "documentar a
divergência como intencional" — decidir antes de implementar.

- [ ] Confirmar com o usuário/operação qual padrão é o canônico antes de
  tocar código (a alternativa "manter e só padronizar estilo" é bem mais
  barata que "migrar para menu").
- [ ] Se migrar: mover o botão de exclusão de `Manifestos.tsx` (~L475) e
  `Containers.tsx` (~L465) para dentro de um menu de ações "…" seguindo a
  implementação de `Clientes.tsx` (`app-floating-menu__danger`,
  `role="menuitem"`). **Não alterar** o `confirm()`/`ConfirmDialog` nem o
  service de exclusão em si.
- **verify:** screenshot antes/depois; fluxo de exclusão (clique → confirm
  dialog → toast) idêntico; teste de comportamento das duas telas continua
  verde.

## Slice 4 — Self-host das fontes da marca

Nova dependência — avaliar custo de bundle antes de mergear.

- [ ] Trocar `@import url('https://fonts.googleapis.com/...')` em
  `src/index.css:1` por pacotes `@fontsource` (`@fontsource/ibm-plex-mono`,
  `@fontsource/syne`, `@fontsource/dm-sans`) importados no entrypoint, ou por
  arquivos `.woff2` estáticos em `public/fonts/` + `@font-face` manual — a
  segunda opção evita dependência nova mas exige baixar e versionar os
  arquivos de fonte.
  **verify:** `npm run build` sem nenhuma chamada de rede para
  `fonts.googleapis.com`; comparação visual pixel-a-pixel (ou por olho) da
  tipografia antes/depois; checar impacto no tamanho do bundle
  (`npm run build` já reporta gzip por chunk).
- [ ] Atualizar `docs/ARCHITECTURE.md` se a lista de dependências externas em
  tempo de execução for documentada lá.

## Slice 5 — Hierarquia visual dos KPIs

Maior risco: muda o desenho de 7+ telas. **Não implementar sem validar com a
operação qual métrica é "a que pede ação" em cada tela** — pode variar por
perfil de usuário (operacional vê "Pendentes revisão", financeiro vê "Saldo
pendente").

- [ ] Levantar com a operação, tela por tela (Manifestos, Carga Solta,
  Containers, Faturamento, Relatórios, Clientes, ClienteFicha), qual card
  é a métrica primária hoje (a que motiva a próxima ação do operador).
- [ ] Desenhar um padrão de 1 card primário (maior, com cor/peso distinto) +
  strip secundária compacta para o resto — sem introduzir componente novo
  se `SummaryCard`/`MetricCard` já suportarem uma variante `size`/`tone`
  "primary".
  **verify:** protótipo em 1 tela primeiro (ex.: Manifestos), screenshot
  desktop + mobile, validação com a operação antes de replicar nas outras
  telas.
- [ ] Replicar o padrão validado nas telas restantes, uma por vez, cada uma
  com seu próprio screenshot antes/depois.

---

## Ordem de ataque recomendada

1. **Slice 1** — menor risco, maior alavancagem (fecha causa raiz de uma
   regressão já vista duas vezes).
2. **Slice 2** — troca de ícone isolada, sem decisão pendente.
3. **Slice 4** — mecânico, mas precisa aprovação para nova dependência (ou
   aceitar o custo de versionar arquivos de fonte).
4. **Slice 3** — precisa decisão de padrão antes de tocar código.
5. **Slice 5** — maior escopo; só depois de validar com a operação qual
   métrica é primária em cada tela.
