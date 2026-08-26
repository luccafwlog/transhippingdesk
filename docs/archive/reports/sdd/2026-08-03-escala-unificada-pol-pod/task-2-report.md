# Task 2 — Projeção unificada de escalas

## Status

Concluída no worktree `feat/escala-unificada-pol-pod`, sobre o estado pós-Task 1.

## Escopo implementado

- `src/services/voyageRouteSchedules.ts`
  - Adicionada a função pura `projectVoyageEscalaSchedules`.
  - Adicionado o tipo público `VoyageEscalaSchedule` e divergências de projeção.
  - Adicionada a leitura `listVoyageEscalaSchedulesByVoyageIds`, unindo:
    - `voyage_pod_schedule`;
    - `voyage_pol_schedule`;
    - `voyage_export_schedules` via `VoyageExportSchedulesByPort`.
  - Adicionado o adapter `saveVoyageEscalaSchedule`, gravando sempre no portador `voyage_pod_schedule`.
  - Preservadas as APIs legadas:
    - `buildVoyagePodEntityId`;
    - `saveVoyagePodSchedule`;
    - `saveVoyagePolSchedule`.

## Regras atendidas

- A projeção normaliza portos por `normalizePortCode`.
- A projeção restringe escalas a LOCODE brasileiro de 5 caracteres (`BRxxx`).
- Escalas podem nascer de POD, POL ou EXP.
- A linha POD é canônica:
  - POL/EXP preenchem apenas campos vazios;
  - divergências contra valores de POD são expostas em `divergences`;
  - colisão de `etd` POD × POL mantém POD e reporta divergência.
- Cada escala expõe:
  - `eta`, `etb`, `ata`, `atb`, `etd`, `atd`, `rtw`, `ceStatus`, `linked`, `escalaNumber`, `omitted`, `deleted`;
  - `temImportacao`, `temExportacao`, `temGranito`, `containersQty`, `movementsQty`.
- Escala com POD soft-deleted fica fora da projeção, mesmo quando há POL/EXP no mesmo porto.
- O adapter de escrita contém comentário `ponytail:` explicando que o `entity_type` físico segue `voyage_pod_schedule` por compatibilidade histórica, com upgrade para tabela própria de escala conforme ADR 0027.
- `saveVoyagePolSchedule` continua existindo para o registro documental do POL.

## Testes adicionados

Em `src/services/__tests__/voyageRouteSchedules.test.ts`:

- somente POD;
- somente POL;
- POD + POL com colisão de `etd`, POD vence e divergência é reportada;
- POL estrangeiro fica fora;
- porto brasileiro por extenso é normalizado;
- EXP brasileira entra com marcadores de exportação/granito/quantidades;
- EXP estrangeira fica fora;
- escala soft-deleted fica fora.

## Verificação executada

- RED: `npx vitest run src/services/__tests__/voyageRouteSchedules.test.ts --maxWorkers=1`
  - falhou como esperado porque `projectVoyageEscalaSchedules` ainda não existia.
- GREEN/focados serial:
  - `npx vitest run src/services/__tests__/voyageRouteSchedules.test.ts src/services/__tests__/voyageRouteSchedules.omitted.test.ts src/services/__tests__/ladenOnBoardAtd.test.ts --maxWorkers=1`
  - resultado: 3 arquivos, 22 testes, todos passaram.
- Typecheck:
  - `npm run typecheck`
  - passou.
- Lint:
  - `npm run lint`
  - passou.
- Whitespace:
  - `git diff --check`
  - passou.

## Arquivos alterados

- `src/services/voyageRouteSchedules.ts`
- `src/services/__tests__/voyageRouteSchedules.test.ts`
- `.superpowers/sdd/2026-07-31-escala-unificada-pol-pod/task-2-report.md`

## Restrições conferidas

- Não alterado: `src/types/database.ts`.
- Não alteradas: migrations existentes.
- Não alterado: `src/services/ladenOnBoardAtd.ts`.
- Não implementados consumidores das Tasks 3/4/5/6.

## Preocupações / limites

- A leitura nova ainda não é consumida pela UI; isso fica para as tasks seguintes.
- A busca por audit logs segue o padrão existente de filtrar por prefixo em memória; não foi otimizada nesta task para evitar ampliar escopo.
- A suíte ampla `npm test` não foi rodada; a validação foi focada e serial conforme brief/status-check, com lint e typecheck.
