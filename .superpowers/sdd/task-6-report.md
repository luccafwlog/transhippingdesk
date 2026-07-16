# WS1 Task 6 Report — Laden on Board alimenta ATD do POL

## Escopo implementado

- Criado `src/services/ladenOnBoardAtd.ts` com:
  - `resolveCanonicalPolAtd(currentAtd, ladenDates)`, que escolhe a menor data ISO entre o ATD atual e as novas datas.
  - `applyLadenOnBoardAtd({ rows, changedBy })`, pos-commit do Importar B/L que agrupa rows por Viagem+POL, le agenda atual por `listVoyagePolSchedules` e chama `saveVoyagePolSchedule` apenas quando o menor ATD mudou.
- `src/services/blFreightImport.ts` agora expoe `ladenOnBoard` normalizado no row do preview, sem adicionar campo ao payload RPC/documental.
- `src/components/shared/BlImportModal.tsx` agora:
  - mostra `Laden on Board` no preview.
  - chama `applyLadenOnBoardAtd` apos `confirmBlFreightImport`.
  - invalida `voyage-pol-schedules` e `voyage-timeline` junto dos caches ja existentes.

## TDD RED/GREEN

1. RED helper puro:
   - `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts`
   - Falha esperada: modulo `../ladenOnBoardAtd` inexistente.
2. GREEN helper:
   - `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts`
   - Resultado: 4 testes passaram.
3. RED preview:
   - `npm test -- src/services/__tests__/blFreightImport.test.ts`
   - Falha esperada: `preview.rows[0].ladenOnBoard` vinha `undefined`.
4. GREEN preview:
   - `npm test -- src/services/__tests__/blFreightImport.test.ts`
   - Resultado: 22 testes passaram.
5. RED pos-commit:
   - `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts`
   - Falha esperada: `applyLadenOnBoardAtd is not a function`.
6. GREEN pos-commit:
   - `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts`
   - Resultado: 6 testes passaram.
7. RED modal:
   - `npm test -- src/components/shared/__tests__/BlImportModal.test.tsx`
   - Falhas esperadas: data nao exibida no preview e `applyLadenOnBoardAtd` nao chamado.
8. GREEN modal:
   - `npm test -- src/components/shared/__tests__/BlImportModal.test.tsx`
   - Resultado: 6 testes passaram.

## Verificacao executada

- `npm test -- src/services/__tests__/ladenOnBoardAtd.test.ts src/services/__tests__/blFreightImport.test.ts src/services/__tests__/blParser.test.ts src/components/shared/__tests__/BlImportModal.test.tsx src/services/__tests__/voyageRouteSchedules.test.ts src/services/__tests__/voyageRouteSchedules.omitted.test.ts`
  - 6 arquivos passaram, 48 testes passaram.
- `npm run docs:check`
  - Passed: 144 Markdown files, 40 routes, ADR index coverage.
- `npm run lint`
  - Passed.
- `npm test`
  - 254 arquivos passaram, 1 skipped; 1085 testes passaram, 9 skipped.
- `npm run build`
  - Passed: `tsc -b && vite build`.
- `git diff --check`
  - Sem problemas de whitespace.

## Self-review

- Nao alterei schema, migration ou RPC.
- O payload documental enviado para `import_bl_freight_transactional` permanece sem `Laden on Board`; a data fica apenas no row de preview para o pos-commit de agenda.
- A regra de menor data impede que reimportacao posterior sobrescreva ATD canonico anterior.
- O fluxo fica restrito ao Importar B/L e nao implementa Task 7 nem remove Manifesto CNTR.
- Nao encontrei ambiguidade que exigisse `NEEDS_CONTEXT`.

## Follow-up da revisao WS1 Task 6

- Ajustada a rastreabilidade de `Importar B/L` em `docs/RASTREABILIDADE.md` para refletir o comportamento vigente do pos-confirmacao em `BlImportModal`: apos `confirmBlFreightImport`, o fluxo preserva `tryAutoIssueInvoice`, chama `ladenOnBoardAtd/applyLadenOnBoardAtd` para aplicar o menor ATD por Viagem+POL a partir de `Laden on Board` e invalida `voyage-pol-schedules` e `voyage-timeline`.
- Nenhum codigo de producao foi alterado nesta correcao documental.
