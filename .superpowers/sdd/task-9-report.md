# Task 9 — Aba ADR no detalhe da Viagem

## Entrega

- Criada a aba ADR somente leitura no detalhe da Viagem, com seleção de escala
  ativa, cabeçalho operacional e blocos do relatório em ordem de conferência.
- Adicionado `useAgencyReportDerived` e suporte aos deep-links `tab` e
  `escala` em `/viagens/:id`.
- Estendida a projeção derivada com local de desova dos veículos e operação de
  vazios (OS, serviço extra, storage e overtime), preservando o filtro por POD.
- O sub-bloco de Overtime apresenta também o percentual configurado por depot.

## Validação

- `npm run lint` — passou.
- `npx vitest run src/components src/pages` — 82 arquivos / 356 testes passaram.
- `npx vitest run src/services/__tests__/agencyDepartureReport.test.ts src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx` — 2 arquivos / 7 testes passaram.

## Schema

Não houve migration nesta tarefa.
