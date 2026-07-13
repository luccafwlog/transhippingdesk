# Plano — Painel e Viagens: cores, filtros, ordenação e status

> **Plano ativo (pendente de execução).** Gerado em 2026-07-10 a partir do
> mapa de investigação [wayfinder #361](https://github.com/luccafwlog/transhippingdesk/issues/361)
> (tickets [#362](https://github.com/luccafwlog/transhippingdesk/issues/362),
> [#363](https://github.com/luccafwlog/transhippingdesk/issues/363),
> [#364](https://github.com/luccafwlog/transhippingdesk/issues/364),
> [#365](https://github.com/luccafwlog/transhippingdesk/issues/365),
> [#366](https://github.com/luccafwlog/transhippingdesk/issues/366)).
> Estado do produto vive em [docs/ROADMAP.md](../ROADMAP.md); quando as quatro
> frentes forem concluídas, mover este plano para `docs/archive/plans/`.

## Contexto

Cinco investigações sobre as telas **Painel** (Line Up consolidado) e
**Viagens** (rail master-detail) foram concluídas. Cada uma mapeou a regra
atual e o impacto de mudá-la; as decisões de negócio necessárias já foram
tomadas pelo product owner. Este plano consolida as quatro frentes de
implementação resultantes.

**Arquivos-âncora:**

- Painel: `src/pages/Painel.tsx` → `LineUpTable`
  (`src/components/lineup/LineUpTable.tsx`) ← `fetchLineUpSnapshot`
  (`src/services/lineup.ts`).
- Viagens: `src/pages/Viagens.tsx` → `VoyageRail` ← `buildVoyageRailItems` +
  `filterVoyageRailItems` (`src/lib/viagensFilters.ts`).
- CE por escala: `src/services/voyageRouteSchedules.ts`.
- Resumos/ordenação: `src/services/voyageSummaries.ts`.
- Status: `src/services/voyageForm.ts` (enum), `src/services/voyages.ts`
  (`deleteVoyage`), auto-conclusão em `voyageRouteSchedules.ts`
  (`computeVoyageStatusFromPods`).

## Decisões de negócio (tomadas)

- **Cor de "Aguardando":** não diferenciar `waiting` de `missing` — o rótulo
  fica **sempre vermelho**.
- **"ATD ao fim" na ordenação:** significa **viagem toda concluída** (todos os
  PODs partiram). Como essa viagem já tem `proximaEscala = null` e cai ao fim
  hoje, a mudança se resume a alinhar o desempate por ETB com o Painel.
- **Viagens excluídas:** ficam fora do escopo. Exclusão é hard delete (sem
  linha); rastreá-las exigiria soft-delete (mudança de schema) e só entra se o
  negócio pedir explicitamente.

## Ordem de execução sugerida

`A → D → C → B`. As três primeiras são cirúrgicas; a de filtros (B) é a maior.
Podem ir em commits separados no mesmo PR, ou PRs distintos.

Status: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED.

| Frente | Título | Esforço | Status |
|--------|--------|---------|--------|
| A | "Aguardando" sempre vermelho | XS | TODO |
| D | Desempate por ETB no rail de Viagens | S | TODO |
| C | Status "Cancelada" no filtro + guard anti-reversão | S | TODO |
| B | Filtros do Painel | M | TODO |

---

## Frente A — "Aguardando" sempre vermelho

**Objetivo:** eliminar o cinza; `waiting` e `missing` pintam igual (vermelho),
alinhando o Painel com a tela TV (que já pinta ambos de vermelho).

**Causa mapeada:** `renderCeStatus` (`LineUpTable.tsx`) pinta `waiting` de
`slate` e joga `missing` no default vermelho, enquanto
`getVoyagePodCeStatusLabel` devolve "Aguardando" para os dois.

**Arquivo:** `src/components/lineup/LineUpTable.tsx`

- Em `renderCeStatus`, **remover** o ramo
  `if (status === 'waiting') return <Badge tone="slate">…` — assim `waiting`
  cai no `return <Badge tone="red">` default, junto de `missing`.
- Não tocar em `renderDisplayCeStatus` (TV já é vermelho) nem em
  `getVoyagePodCeStatusLabel` (rótulo continua correto).

**Testes:** `src/pages/__tests__/Painel.behavior.test.tsx` — ajustar qualquer
assert que espere tom `slate`/cinza para "Aguardando"; adicionar caso cobrindo
`waiting` → vermelho.

**Verify:** `npm test -- Painel` + inspeção visual do Painel com escala
`waiting`.

---

## Frente D — desempate por ETB no rail de Viagens

**Objetivo:** a ordem do rail espelha o Painel também em ETAs empatadas. A
decisão "ATD ao fim = viagem concluída" já é satisfeita (viagem toda chegada ⇒
`proximaEscala = null` ⇒ cai ao fim); falta apenas o desempate por `etb`, que o
Painel usa e o rail pula.

**Arquivos:**

1. `src/services/voyageSummaries.ts`
   - Estender `proximaEscala` no tipo `VoyageRailItem` para
     `{ pod: string; eta: string; etb: string | null }`.
   - Em `getProximaEscala`, retornar também o `etb` do POD escolhido.
   - `buildVoyageRailItems` repassa o `etb`.
2. `src/lib/viagensFilters.ts`
   - No `.sort` de `filterVoyageRailItems`, inserir o critério de `etb`
     **entre** a chave de ETA e o desempate por navio, replicando a ordem do
     Painel (`eta → etb → vessel → voyage`). Tratar `null` ao fim.

**Testes:** `src/pages/__tests__/viagensHelpers.test.ts` (ou
`src/lib/__tests__/viagensFilters.test.ts`) — duas viagens de mesma ETA e ETBs
diferentes, garantindo ordem igual à do Painel.

**Verify:** `npm test -- viagens` + comparar rail × Painel com ETA empatada.

---

## Frente C — status "Cancelada" no filtro + guard anti-reversão

**Objetivo:** canceladas deixam de sumir dos filtros; e uma viagem cancelada
não é revertida por mudança de ATD.

**Causa mapeada:** enum é `active`/`completed`/`cancelled`; `completed` é
automático (todos PODs não-omitidos com ATD). Canceladas somem porque
`fetchVoyages` busca só `active`/`completed` e os filtros não têm opção
"cancelada" — lacuna, não design. "Excluída" não é status (hard delete).

**Arquivos:**

1. `src/services/voyageRouteSchedules.ts` — em `syncVoyageStatusAfterAtdChange`,
   após buscar `voyage.status`, adicionar guard:
   `if (voyage.status === 'cancelled') return`.
2. `src/services/lineup.ts` — `fetchVoyages`: incluir `'cancelled'` no
   `.in('status', […])`. O filtro de UI (default `active`) mantém canceladas
   ocultas até serem pedidas.
3. `src/pages/Painel.tsx` — `FilterStatus` e os botões: adicionar `'cancelled'`
   ("Escalas canceladas"). O `useMemo` de `rows` já filtra por
   `voyageStatus === statusFilter`.
4. `src/lib/viagensFilters.ts` — `StatusFilter`: adicionar `'cancelled'`.
   Verificar se a consulta que alimenta o rail (`useVoyages` em
   `src/hooks/useBls`) traz canceladas; ampliar se necessário.
5. `src/components/voyages/VoyageFilters.tsx` — opção "Cancelada" no seletor de
   status.

**Testes:** guard (mudança de ATD numa cancelada não altera o status); filtro
"cancelada" retornando as linhas certas em Painel e Viagens.

**Verify:** `npm test` + criar/cancelar viagem e conferir que aparece só sob o
filtro "Cancelada".

**Docs (CLAUDE.md §6):** atualizar `docs/modules/viagens.md` (ciclo de status +
guard) e `docs/RASTREABILIDADE.md` (novo filtro). Avaliar ADR curto registrando
"exclusão é hard delete; cancelamento é o estado retido".

---

## Frente B — filtros do Painel

**Objetivo:** filtrar o Line Up por navios, viagens, período, possui veículos,
possui BB, CES, LINKED, MTY, RTW — tudo client-side sobre `LineUpRow`.

**Causa mapeada:** a `LineUpRow` já carrega todos os campos; 8 dos 9 filtros
são deriváveis sem query nova. Hoje o Painel só filtra por status de escala.

**Arquivos:**

1. **`src/lib/lineupFilters.ts` (novo)** — espelhar `viagensFilters.ts`:
   - Tipo `LineUpFilters` (navios[], viagens[], periodo, veículos?, bb?, ces,
     linked?, mty?, rtw?), `filterLineUpRows(rows, filters)` puro,
     `emptyLineUpFilters()`, `countActiveLineUpFilters()`.
   - Predicados respeitando as **bordas**:
     - **MTY** creditado só à 1ª rota da viagem → "possui MTY" agrupa por
       `voyageId`, não linha a linha.
     - **RTW**: `null` e `0` contam como "não".
     - **Export rows** (`rowType === 'export'`): zeram vin/bb/mty e usam
       `exportCeStatus`/`exportLinked` — decidir se ficam sempre visíveis
       (sugestão: manter).
     - **CES**: agrupar `waiting`+`missing` sob "Aguardando" (coerente com a
       Frente A).
2. **`src/components/lineup/LineUpFilters.tsx` (novo)** — UI de chips/selects;
   popular opções de navios/viagens a partir dos valores distintos de `rows`.
3. **`src/pages/Painel.tsx`** — trocar o `statusFilter` isolado por um estado
   `LineUpFilters`; aplicar `filterLineUpRows` sobre `lineup.rows`; a exportação
   Excel passa a exportar as linhas já filtradas (comportamento atual).

**Limite conhecido:** o filtro opera sobre o recorte de **60 viagens** mais
recentes de `fetchVoyages`. Marcar com comentário `ponytail:` o teto (recorte
de 60) e o upgrade path (paginar/ampliar a query se necessário).

**Testes:** `src/lib/__tests__/lineupFilters.test.ts` — um caso por dimensão +
as bordas (MTY por viagem, RTW null, export rows). `Painel.behavior.test.tsx` —
integração de pelo menos dois filtros combinados.

**Verify:** `npm test -- lineup` + exercitar cada filtro no app.

**Docs:** módulo do Painel/Line Up (`docs/modules/operacao-suporte.md`) e
`docs/RASTREABILIDADE.md` (novos filtros e o helper puro).

---

## Fechamento (todas as frentes)

Conforme CLAUDE.md §7, antes de concluir:

```
npm run docs:check   # após mexer em docs/ADR
npm run lint
npm test
npm run build
```

Rodar o gate do projeto (**`/no-mistakes`**) antes do push. Nunca executar o
script de reset suspenso.
