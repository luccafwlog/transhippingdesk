# WS1 Task 9 Report — remoção da RPC legada de Manifesto CNTR

Data: 2026-07-16
Branch da PR 390: `claude/review-388-068i9n`

## Resultado

A migration `199_drop_import_manifest_cntr_rpc.sql` remove os dois contratos de
`public.import_manifest_with_postprocess_transactional`:

1. a assinatura histórica de 13 argumentos definida na migration 129;
2. a assinatura ativa de 14 argumentos criada na migration 165, com `BOOLEAN`
   ao final.

A mudança é breaking e implementa a ADR 0025: Manifesto CNTR deixa de ser fonte
de ingestão. Nenhuma tabela ou dado é alterado. A RPC central
`public.import_manifest_transactional` permanece intacta para os fluxos que
ainda a compõem, incluindo o importador breakbulk.

Não havia caller no app ou Portal para a RPC removida; UI, parser e service do
Manifesto CNTR já haviam sido retirados na Task 8.

## Divergência entre o plano e o schema vigente

O brief original exigia somente a assinatura de 13 argumentos copiada da
migration 129. A inspeção do histórico mostrou que a migration 165 já executa o
`DROP` dessa assinatura e recria a RPC com um décimo quarto argumento
`BOOLEAN`. Portanto, repetir apenas o contrato de 13 argumentos seria um no-op
e deixaria a RPC ativa.

Após confirmação do usuário, a migration 199 passou a executar, nesta ordem:

- `DROP FUNCTION IF EXISTS` da assinatura histórica de 13 argumentos;
- `DROP FUNCTION IF EXISTS` da assinatura ativa de 14 argumentos.

As migrations 129 e 165 foram apenas consultadas; nenhum arquivo histórico foi
editado.

## Teste de contrato SQL e TDD

O teste `dropImportManifestCntrMigration.test.ts` não depende de uma regex
permissiva. Ele remove comentários, separa statements, reconhece declarações
`DROP FUNCTION IF EXISTS`, decompõe o nome e os tipos e compara a estrutura
completa e ordenada das duas assinaturas.

O contrato também exige exatamente dois alvos, ambos chamados
`public.import_manifest_with_postprocess_transactional`, e comprova que
`public.import_manifest_transactional` não é removida.

RED:

- `npm test -- src/services/__tests__/dropImportManifestCntrMigration.test.ts`
- Resultado esperado: 2 testes falharam porque a migration 199 ainda não
  existia e nenhuma assinatura era encontrada.

GREEN:

- `npm test -- src/services/__tests__/dropImportManifestCntrMigration.test.ts`
- Resultado: 1 arquivo e 2 testes aprovados.

## Rollback e recovery

O comentário de recovery orienta recriar a definição ativa de 14 argumentos e
seus privilégios a partir da migration 165 somente se a ADR 0025 for revertida.
A assinatura histórica de 13 argumentos não deve ser recriada. Não há rollback
de dados.

Nenhum banco remoto ou de produção foi modificado nesta task; a prova executada
foi o teste de contrato SQL e a bateria local solicitada.

## Documentação viva

- `docs/RASTREABILIDADE.md`: removida a RPC extinta do catálogo de contratos
  vigentes.
- `docs/modules/manifesto-edi.md`: registrada a remoção das assinaturas de
  13/14 argumentos e a preservação de `import_manifest_transactional`.

## Verificação

- Focal: 1 arquivo, 2 testes aprovados.
- `npm run docs:check`: aprovado — 148 Markdown files, 40 rotas e cobertura do
  índice de ADRs verificados.
- `npm run lint`: aprovado.
- `npm test`: 246 arquivos aprovados, 1 ignorado; 1.035 testes aprovados, 9
  ignorados.
- `npm run build`: aprovado — TypeScript + Vite, 2.498 módulos transformados.
- `git diff --check`: aprovado.

## Escopo preservado

- commits anteriores da branch atual;
- migrations históricas;
- `public.import_manifest_transactional`;
- RPCs de importação breakbulk, Baplie, veículos e demais fontes legítimas.

Nenhum `reset` ou `clean` foi executado.
