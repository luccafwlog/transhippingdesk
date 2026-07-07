# Code Quality Audit Remediation — Implementation Plan

> Plano/snapshot de decisão, não verdade corrente. A autoridade executável é o
> código. Base de decisão: auditoria estrutural
> [code-quality-audit-2026-07-06](../code-quality-audit-2026-07-06.md)
> (registro histórico, imutável). Este plano consolida as medidas previstas
> naquele relatório em fatias revisáveis.

**Goal:** Eliminar as três dívidas estruturais confirmadas pela auditoria —
parsing numérico fragmentado (com corrupção de decimais), inversão de camadas
em `viagensHelpers.ts` e ausência de abstração de página-de-lista — mais o
código morto e as duplicatas com dono canônico existente, **sem alterar
comportamento** (exceto corrigir o bug de decimais, que é uma correção).

**Architecture:** Cada fatia move na direção declarada em
`docs/ARCHITECTURE.md` (`pages → hooks → services`, `lib/` como utilitário
puro). Nenhuma migration nem mudança de schema. As fatias são independentes e
podem ser mergeadas separadamente; a ordem abaixo prioriza risco eliminado por
esforço.

**Tech Stack:** TypeScript, Vitest, React (TanStack Query), Supabase. Sem
migration.

**Fontes de verdade:** `CONTEXT.md` · `docs/ARCHITECTURE.md` ·
`docs/CONVENCOES.md` · `docs/RASTREABILIDADE.md` ·
[auditoria 2026-07-06](../code-quality-audit-2026-07-06.md).

---

## Prioridades da auditoria

| # | Achado | Severidade | Fatia |
|---|--------|-----------|-------|
| A1 | `toNumber` corrompe decimais US (`"1.5"` → `15`) em peso/CBM/tara | P1 correção | Slice 1 |
| A2 | Cinco parsers numéricos com quatro contratos de falha | P2 | Slice 1 |
| A3 | `buildVoyageTimelineLegacy` — ~120 linhas mortas | P1 | Slice 2 |
| A4 | `viagensHelpers.ts` importado por `lib/` e `components/` (inversão) | P1 | Slice 2 |
| A5 | Bloco filtros+paginação copiado à mão em ~11 páginas | P2 | Slice 3 |
| A6 | Duplicatas de `chunkArray`/`normalizePortCode`/`normalizeHeader`/`PreviewBox` | P2 | Slice 4 |
| A7 | `Manifestos.tsx`/`Demurrage.tsx` > 1k linhas; `Clientes.tsx` no limite | P3 | Slice 5 |
| A8 | 39 `as unknown as` na fronteira Supabase | P4 | Slice 6 (opcional) |
| A9 | `queryKeys.ts` adotado por 5 hooks vs 225 chaves inline | P4 | Slice 6 (opcional) |
| A10 | `useContainers` baixa a tabela inteira por filtro, sem `ponytail:` | P5 | Slice 6 (opcional) |

---

## Slice 1 — Parser numérico canônico (A1, A2)

Maior risco eliminado por menor esforço. Entrega revisável independente.

- [ ] **Parser canônico.** Promover a variante mais robusta (a de
  `src/services/blParser.ts:209`, que tolera sufixos de unidade e distingue
  `"1.5"` de `"1.234,56"`) para `src/lib/utils.ts`, substituindo `toNumber`.
  Definir o contrato de falha único: retorna `null` para entrada não
  numérica.
  - **verify:** teste de tabela em `src/lib/__tests__/utils.test.ts` cobrindo
    `"1.5"→1.5`, `"1.234,56"→1234.56`, `"1,5"→1.5`, `"10 KGS"→10`, `""→null`,
    `number` nativo passthrough.
- [ ] **Converter chamadores e deletar duplicatas.** Substituir por
  `toNumber` canônico:
  - `src/services/manifestParser.ts:584` (`parseNumberValue`, hoje retorna `0`
    — atenção ao contrato: onde `0` era esperado, aplicar `?? 0` no
    chamador).
  - `src/services/breakbulkManifestParser.ts:826` (`parseNumber`).
  - `src/services/financialValidation.ts:12` (`parseNumberInput`, hoje `NaN`).
  - `src/services/blParser.ts:209` passa a reexportar/usar o canônico.
  - **verify:** `npm run lint` (sem função órfã); `npm test` — suites de
    `manifestParser`, `breakbulkManifestParser`, `blFreightImport`,
    `financialValidation` verdes; conferir que os pontos que dependiam de
    `0`/`NaN` seguem corretos.

## Slice 2 — Camada de `viagensHelpers` (A3, A4)

Entrega revisável independente: deleção de morto + realocação de camada.

- [ ] **Deletar código morto.** Remover `buildVoyageTimelineLegacy`
  (`src/pages/viagensHelpers.ts:445-565`) — zero chamadores em `src/`.
  - **verify:** `grep -rn buildVoyageTimelineLegacy src` vazio; `npm run
    build` verde.
- [ ] **Mover para a camada certa.** `git mv` de `viagensHelpers.ts` para
  fora de `pages/`. Lógica de domínio + tipos (`VoyageBl`,
  `VoyageTimelineEvent`, timeline, conciliação, cobertura CE) para
  `src/services/` (ex.: `voyageSummaries.ts`); utilitários puros de formatação
  (`formatMetric`, `normalizePortName`, `stripFileExtension`) para `src/lib/`.
  Ajustar os imports dos 10 chamadores (`src/lib/statusLabels.ts`,
  `src/lib/viagensFilters.ts`, `src/components/voyages/*`,
  `src/components/shared/VoyageSectionCards.tsx`, `src/pages/Viagens.tsx`).
  - **verify:** `npm run build` + `npm test` verdes; nenhum import de
    `pages/` em `lib/` ou `components/`
    (`grep -rn "pages/viagensHelpers" src/lib src/components` vazio).

## Slice 3 — Abstração de página-de-lista (A5)

O maior movimento de simplificação. Entrega revisável independente.

- [ ] **`usePageFilters<T>`.** Novo hook em `src/hooks/` encapsulando estado
  de filtros + `page` + `pageSize` + `updateFilter` (com reset de página ao
  mudar filtro que não seja a página). Constante `PAGE_SIZES` única.
  - **verify:** teste unitário do hook (reset de página; troca de pageSize).
- [ ] **`<TableFooterPagination>`.** Componente em `src/components/ui/`
  renderizando o rodapé `app-table__footer` (Select de tamanho, contagem
  parametrizável, Anterior/Próxima). Slot para o texto de contagem
  (Containers mostra "containers distintos"; Manifestos não).
  - **verify:** teste de render (botões desabilitam nos limites).
- [ ] **Rollout.** Migrar as ~11 páginas
  (`CargaSolta`, `Containers`, `EmbarqueVazios`, `Granite`, `Manifestos`,
  `VaziosImportacao`, `Veiculos`, `PortalOperacao`, `Baplie`, mais o par que
  usa filtros de tabela), removendo `pageSizes`/`updateFilter`/markup locais.
  - **verify:** behavior tests por tela verdes; estado de URL/filtro persiste.

## Slice 4 — Consolidar duplicatas em dono canônico (A6)

Oportunista; pode acompanhar qualquer PR que toque os arquivos.

- [ ] `chunkNumberArray`/`chunkStringArray` (`src/hooks/useVehicles.ts:303`,
  `src/services/lineup.ts:477,486`) → `chunkArray` de `src/lib/utils.ts`.
- [ ] `normalizePortCode` de `src/services/breakbulkManifestParser.ts:442` e
  `normalizePort` de `src/services/lineup.ts:495` → `src/services/portCode.ts`.
- [ ] `normalizeHeader` (`src/services/ceMercanteImport.ts:293` +
  `breakbulkManifestParser.ts:564`) → um dono compartilhado.
- [ ] `PreviewBox` (`src/pages/Clientes.tsx:963` + `Manifestos.tsx:1053`) →
  `src/components/ui/` ou `shared/`.
  - **verify:** `npm run lint` (sem órfãos); `npm test` verdes.

## Slice 5 — Decomposição de arquivos > 1k linhas (A7)

Fazer junto da próxima feature que tocar cada página; não é refactor isolado.

- [ ] `src/pages/Manifestos.tsx` (1.089): extrair `UploadManifestModal`
  (linhas 603-1049) para `src/components/` ao lado de `BlImportModal.tsx`.
- [ ] `src/pages/Demurrage.tsx` (1.072): extrair as abas restantes para
  `src/components/billing/` (padrão já existente com
  `DemurrageInvoicesSection.tsx`) e serviços para `src/services/demurrage/`.
- [ ] `src/pages/Clientes.tsx` (991): extrair o formulário de contatos e a
  ficha de preview antes que a próxima feature cruze 1k.
  - **verify (cada):** behavior tests da página verdes; arquivo abaixo de 1k.

## Slice 6 — Fronteiras de tipo e orquestração (A8, A9, A10) — opcional

Menor prioridade; incremental. Não bloqueia as fatias acima.

- [ ] **A8:** para as queries mais quentes (`src/hooks/useBls.ts`), centralizar
  cada string `select` por entidade e derivar o tipo da query (`QueryData` do
  supabase-js) ou validar a borda com `zod` (já é dependência), reduzindo os
  `as unknown as`.
- [ ] **A9:** decidir o destino de `src/services/queryKeys.ts` — migrar as
  chaves inline de verdade (módulo a módulo) ou deletar o arquivo e documentar
  a convenção inline. Não deixar o estado híbrido.
- [ ] **A10:** em `src/hooks/useBls.ts` (`useContainers`/`fetchAllBls`),
  marcar o download-tabela-inteira com `ponytail:` nomeando o teto O(tabela) e
  o caminho de upgrade (agregação server-side), ou mover a paginação para o
  servidor.
  - **verify:** `npm test` + `npm run build` verdes.

---

## Gates de verificação (antes de fechar cada slice)

- [ ] `npm run docs:check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

## Fora de escopo / notas

- **Sem migration:** nenhuma fatia toca schema.
- **Comportamento preservado:** única mudança de comportamento intencional é
  a correção do bug de decimais (Slice 1); toda a demais reestruturação é
  behavior-preserving e deve manter os testes existentes verdes antes e
  depois.
- **Documentação viva:** Slices 2, 3 e 5 movem código entre camadas/arquivos —
  atualizar `docs/RASTREABILIDADE.md` e o doc de módulo afetado na mesma
  mudança (contrato de documentação, `CLAUDE.md` §6).
