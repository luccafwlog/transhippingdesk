# Task 4 — Uma linha por escala na Visão geral

## Status

Implementado em `feat/escala-unificada-pol-pod`.

## Escopo entregue

- `VoyageVisaoTab` passa a renderizar `escalaRows` da projeção unificada, sem remontar união POD/POL/EXP no componente.
- A linha EXP amarela separada foi removida: cada escala aparece uma vez, com marcadores de Importação, Exportação, Granito, CNTRS e MOVES.
- Ações coexistem na linha quando os respectivos registros existem:
  - editar escala grava pelo portador unificado;
  - editar/excluir exportação age sobre `voyage_export_schedules`;
  - omitir/excluir planejamento do POD continua restrito à escala com portador POD/importação.
- Divergências da projeção aparecem como aviso inline com valor POD e valor POL/EXP.
- `PodScheduleModal` normaliza o porto via `normalizePortCode` antes de emitir o payload de salvamento.

## Testes executados

- `npx vitest run src/components/voyages/__tests__/VoyageVisaoTab.delete-confirmation.test.tsx src/components/voyages/__tests__/VoyageVisaoTab.timeline-collapse.test.tsx src/components/shared/__tests__/VoyageScheduleModals.test.tsx --maxWorkers=1 --testTimeout=15000` — 3 files, 17 tests passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.

## Preocupações

- Não foi feita validação manual de UI em navegador real nesta task.
- Viagem somente exportação exibe editar escala e editar/excluir exportação; omissão/exclusão do portador POD só aparece quando a projeção indica portador/importação existente.
