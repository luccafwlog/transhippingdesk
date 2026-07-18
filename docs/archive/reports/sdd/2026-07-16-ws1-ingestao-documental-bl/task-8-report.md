# Task 8 — remoção do Manifesto CNTR e do EDI Mercante local

## Resultado

A Task 8 da WS1 foi aplicada na branch `claude/review-388-068i9n`, vinculada à
PR 390. O frontend não oferece mais a importação de Manifesto CNTR nem a geração
local de EDI Mercante em `/manifestos` ou nas superfícies atuais de Viagens.

Ao iniciar a execução, o working tree já continha um diff não commitado com a
maior parte desta Task 8, apesar de o brief informar checkout limpo. O estado foi
auditado antes de qualquer correção adicional. Nenhum `reset` ou `clean` foi
executado, e os seis commits locais que já estavam à frente do remoto foram
preservados.

## Consumidores rastreados antes da remoção

| Módulo | Consumidores no `HEAD` inicial | Tratamento |
|---|---|---|
| `UploadManifestModal` | `Manifestos.tsx` | Ação, estado e render removidos; módulo deletado. |
| `MercanteEdiModal` | `Manifestos.tsx`, `VoyageManifestosTab.tsx` | Ações, estados e renders removidos; módulo deletado. |
| `manifestParser` | `UploadManifestModal`, `VoyageImportActions`, `voyageImportSummary`, `manifestImport`, `voyageRouteSchedules` e testes exclusivos | Consumidores do fluxo CNTR removidos; helpers de schedule exclusivos do manifesto também removidos. |
| `manifestOverwritePreview` | `UploadManifestModal` e teste próprio | Módulo e teste deletados. |
| `mercanteEdiGenerator` / `mercanteEdiDownload` | `MercanteEdiModal` e testes exclusivos | Módulos e testes deletados. |
| `manifestImport` | Fluxo CNTR e `Viagens.tsx` | Reduzido a `setImportBatchCeMaster`, ainda usado pela edição legítima de CE Master. |

`VoyageImportActions` deixou de aceitar o tipo `cntr`, e
`VoyageImportacaoTab` deixou de solicitá-lo. `VoyageManifestosTab` deixou de
renderizar o gerador EDI. A ordem/reorganização de ações da WS4 não foi
implementada.

## Exclusões órfãs e documentação

Foram deletados somente módulos, helpers e testes exclusivos do fluxo retirado:

- testes do parser/importador CNTR, overwrite preview e geração/download EDI;
- `voyageImportSummary.ts` e seu teste, usados apenas pelo resumo do importador
  CNTR em `VoyageImportActions`;
- três fixtures `.xlsx` de Manifesto CNTR, que ficaram sem qualquer consumidor
  após a exclusão de `manifestFixtures.real.test.ts`.

Documentação viva foi atualizada para não apontar para módulos deletados:
`WORKFLOW.md`, arquitetura, rastreabilidade, módulos de Manifestos/Viagens,
operações, setup de testes e o playbook local de import parser. Registros
históricos em ADRs, specs, planos e migrations não foram reescritos.

Os testes de contrato SQL de `import_manifest_with_postprocess_transactional`
foram preservados porque a RPC ainda existe no schema. Sua revogação e remoção
pertencem exclusivamente à Task 9. Nenhuma migration ou tipo de banco foi
alterado nesta task.

O fluxo breakbulk também foi preservado: `breakbulkImport.ts` continua usando
`import_breakbulk_manifest_transactional`, sem alterações.

## Verificação

- Focados: 6 arquivos, 29 testes aprovados — ausência das ações, CE Master,
  breakbulk e schedules.
- `npm run docs:check`: aprovado — 147 arquivos Markdown, 40 rotas e índice de
  ADRs verificados.
- `npm run lint`: aprovado.
- `npm test`: 245 arquivos aprovados, 1 ignorado; 1033 testes aprovados, 9
  ignorados.
- `npm run build`: aprovado — TypeScript + Vite, 2498 módulos transformados.
- Varredura de consumidores: nenhuma referência de código remanescente aos
  módulos/helpers removidos.
- `git diff --check`: aprovado.

## Fora de escopo preservado

- CE Master e `setImportBatchCeMaster`.
- Importação breakbulk e sua RPC própria.
- Migration/RPC legada de Manifesto CNTR, reservada à Task 9.
- Reorganização de ações da WS4.
