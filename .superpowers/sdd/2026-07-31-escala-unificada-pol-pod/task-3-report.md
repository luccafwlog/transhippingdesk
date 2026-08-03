# Task 3 — relatório

## Escopo executado

- `voyageSummaries`: `collectVoyagePorts`, `getProximaEscala` e `buildVoyageRailItems` passaram a aceitar a projeção unificada de escalas.
- `VoyageCard` passou a derivar `podRows`, Próxima Escala, escalas ativas e lista do ADR a partir de `scheduledEscalaRows`.
- `useViagemSchedulesAndStats` carrega `listVoyageEscalaSchedulesByVoyageIds` com chave `queryKeys.voyages.escalaSchedules`.
- `lineup` passou a montar linhas a partir de `listVoyageEscalaSchedulesByVoyageIds`, preservando linhas de importação por B/L e linhas EXP sem datas.

## Regressões cobertas

- Viagens só de importação continuam com Próxima Escala, estado e Line-Up derivados como antes.
- Viagem só de exportação com escala brasileira passa a aparecer no rail, em Próxima Escala e no Line-Up.
- Escala mista com B/L de importação e agenda de exportação preserva as duas linhas no Line-Up, com IDs `24::BRVIX` e `exp::24::BRVIX`.
- O fallback `voyage.pod?.name` foi removido dos consumidores ajustados para evitar porto estrangeiro em viagem sem B/L.

## Verificação

- `npm exec vitest run src/pages/__tests__/viagensHelpers.test.ts src/services/__tests__/voyageSummaries.omitted.test.ts src/services/__tests__/voyageRouteSchedules.test.ts src/services/__tests__/lineupSnapshot.test.ts src/services/__tests__/lineupScheduleDates.test.ts src/services/__tests__/lineupSort.test.ts --maxWorkers=1 --testTimeout=15000` — 6 files, 80 tests passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.

## Preocupações

- O Line-Up ainda preserva a coluna/label `pod` por compatibilidade visual, mesmo quando a linha representa escala EXP/POL.
