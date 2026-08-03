# Task 4 - Uma linha por escala na Visao geral

## Status

Implementado em `feat/escala-unificada-pol-pod`.

## Escopo entregue

- `VoyageVisaoTab` renderiza `escalaRows` da projecao unificada, sem remontar a uniao POD/POL/EXP no componente.
- A linha EXP amarela separada foi removida: cada escala aparece uma vez, com marcadores de importacao, exportacao, granito, CNTRS e MOVES.
- As acoes coexistem na linha e continuam agindo sobre seus registros.
- A edicao de uma escala somente de exportacao preserva todas as datas no portador `voyage_pod_schedule`, mas grava `tem_importacao=false`; registros legados sem esse marcador continuam sendo importacao.
- Divergencias da projecao aparecem como aviso inline com os valores POD e POL/EXP.
- `PodScheduleModal` aceita ATA/ATB, normaliza o porto por `normalizePortCode`, propaga o marcador operacional e usa texto de Escala no novo fluxo.

## Testes executados

- `npx vitest run src/services/__tests__/voyageRouteSchedules.test.ts src/components/voyages/__tests__/VoyageVisaoTab.delete-confirmation.test.tsx src/components/voyages/__tests__/VoyageVisaoTab.timeline-collapse.test.tsx src/components/shared/__tests__/VoyageScheduleModals.test.tsx --maxWorkers=1 --testTimeout=15000` - 4 files, 33 tests passed.
- `npm run lint` - passed.
- `npm run typecheck` - passed.

## Preocupacoes

- Nao foi feita validacao manual de UI em navegador real nesta task.
- A viagem somente de exportacao exibe edicao da escala e da exportacao; omissao/exclusao do portador POD continua disponivel apenas quando a projecao indica importacao.
