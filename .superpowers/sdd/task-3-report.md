# Task 3 — Frente C: status cancelada

## Escopo entregue

- `syncVoyageStatusAfterAtdChange` preserva `voyages.status='cancelled'` quando
  uma alteração de ATD recalcula o estado automático.
- O snapshot do Line-Up passa a buscar viagens `cancelled`; Painel mantém o
  filtro inicial em ativas e inclui a aba `Escalas canceladas`.
- O rail de Viagens aceita e expõe o filtro `Canceladas`. A investigação dos
  consumidores confirmou que `useVoyages` já consulta viagens sem restringir
  `status`, portanto não exigiu alteração de escopo.

## Evidência RED → GREEN

1. Guard de ATD:
   - RED: `npm test -- src/services/__tests__/voyageRouteSchedules.test.ts`
     falhou como esperado: `updateMock` foi chamado uma vez com
     `{ status: 'completed' }` para uma viagem cancelada.
   - GREEN: o mesmo comando passou com 3 testes.
2. Filtro Painel:
   - RED: `npm test -- src/pages/__tests__/Painel.behavior.test.tsx` falhou
     porque o botão `Escalas canceladas` não existia.
   - GREEN: o teste confirma que a seleção mostra somente a linha cancelada.
3. Filtro Viagens:
   - RED: `npm test -- src/pages/__tests__/Viagens.behavior.test.tsx` falhou
     porque o seletor não oferecia `cancelled` e o rail ficou vazio.
   - GREEN: o teste confirma a viagem cancelada no rail depois da seleção.

## Verificação executada

- `npm test -- src/services/__tests__/voyageRouteSchedules.test.ts src/pages/__tests__/Painel.behavior.test.tsx src/pages/__tests__/Viagens.behavior.test.tsx src/lib/__tests__/viagensFilters.test.ts`
  — 4 arquivos, 27 testes aprovados.
- `npm run docs:check` — 130 Markdown files, 37 routes e cobertura do índice
  ADR aprovados.
- `npm run typecheck` — aprovado.
- `npm run lint` — aprovado.
- `git diff --check` — aprovado.

O `npm test` completo não foi executado: o coordenador solicitou concluir sem
esperar comandos caros após a validação focada.

## Documentação e ADR

Foram atualizados `docs/modules/viagens.md` e `docs/RASTREABILIDADE.md` com o
ciclo de status, guard e os dois filtros. A avaliação encontrou documentação
anterior para hard delete, mas nenhuma decisão que fixasse cancelamento como
estado retido e proibisse sua reversão automática; por isso foi criada a ADR
0023 e indexada em `docs/adr/README.md`.

## Arquivos alterados

- `src/services/voyageRouteSchedules.ts`
- `src/services/lineup.ts`
- `src/pages/Painel.tsx`
- `src/lib/viagensFilters.ts`
- `src/components/voyages/VoyageFilters.tsx`
- `src/services/__tests__/voyageRouteSchedules.test.ts`
- `src/pages/__tests__/Painel.behavior.test.tsx`
- `src/pages/__tests__/Viagens.behavior.test.tsx`
- `docs/modules/viagens.md`
- `docs/RASTREABILIDADE.md`
- `docs/adr/README.md`
- `docs/adr/0023-cancelamento-viagem-estado-retido-exclusao-hard-delete.md`

## Auto-revisão e preocupações

- Alterações limitadas ao escopo da Frente C; não há mudança no hard delete.
- O filtro padrão continua `active`, então canceladas só aparecem sob o filtro
  explícito ou em “Todas”.
- Sem preocupações funcionais conhecidas. A validação manual em navegador com
  dados reais não foi executada neste ambiente.
