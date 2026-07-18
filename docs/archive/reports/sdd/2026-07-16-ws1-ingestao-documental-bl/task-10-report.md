# WS1 Task 10 Report — documentação viva e fixtures

Data: 2026-07-16
Branch da PR 390: `claude/review-388-068i9n`

## Resultado

A documentação viva passou a descrever o B/L como fonte documental vigente da
carga de container, sem manter como estado atual as divergências transitórias da
ADR 0025. A remoção da RPC concluída na Task 9 foi preservada e refletida como
comportamento vigente; migrations históricas e registros de decisão não foram
reescritos.

A fixture `test-fixtures/qa-manifest-cntr.xlsx` e somente a sua linha no
`test-fixtures/README.md` foram removidas. As fixtures de Baplie e veículos
permanecem no repositório.

## Inspeção dos documentos exigidos

- `docs/RASTREABILIDADE.md`: a Task 9 já havia removido a RPC extinta do catálogo
  de contratos vigentes. A linha de `/manifestos` foi ajustada para catalogar
  somente as ações atuais e a autoridade documental do B/L.
- `docs/modules/manifesto-edi.md`: a invariante que ainda dizia que a RPC
  permaneceria até a Task 9 foi substituída pelo estado vigente da migration 199.
  A nota técnica da Task 9 sobre as assinaturas removidas foi preservada.
- `WORKFLOW.md` §7: já havia sido atualizado pela Task 8 e lista somente parsers
  vigentes. Nenhuma alteração adicional foi necessária.
- `test-fixtures/README.md`: removida somente a linha da fixture obsoleta; a ordem
  vigente continua B/L → Baplie → veículos.
- `docs/operations/validacao.md`: removido o parágrafo transitório que projetava
  a remoção futura da RPC na Task 9.

## Escopo preservado

- Todos os nove commits locais anteriores ao início da Task 10, incluindo os
  commits e relatórios das Tasks 8 e 9.
- `public.import_manifest_transactional` e os fluxos legítimos que a compõem.
- ADRs, plans, migrations históricas e o relatório da Task 9.
- Fixtures `qa-baplie-3cntr.edi` e `qa-veiculos.xlsx`.
- Divergências de Portal e IMO/OOG reservadas a outros workstreams.

Nenhuma implementação de WS2, WS3 ou WS4 foi realizada. Nenhum `reset` ou
`clean` foi executado.

## Verificação

- `npm run docs:check`: aprovado — 150 arquivos Markdown, 40 rotas e cobertura
  do índice de ADRs verificadas.
- `npm test`: aprovado — 246 arquivos aprovados, 1 ignorado; 1.035 testes
  aprovados e 9 ignorados.
- `git diff --check`: aprovado, sem erros de whitespace.
- Inspeção de escopo: cinco caminhos de produto alterados — quatro Markdown e a
  exclusão exata da fixture CNTR — além deste relatório da Task 10.
