# Relatório histórico — Fixture QA de exibição em produção

## Escopo

Este relatório acompanha os scripts da fixture sintética `QA-DISPLAY-2026`/`QAD26`.
As Tasks 3–6 adicionam cenários de ADR e exceções, financeiro, Portal/PIX,
validação e limpeza seletiva.

## Segurança operacional

Nenhuma execução contra produção faz parte deste change. Os scripts exigem um
catálogo com o prefixo correto, não retornam senhas e mantêm efeitos externos
desabilitados. `cleanup-fixture.mjs` opera em dry-run por padrão e rejeita
remoção destrutiva quando os registros não estão marcados explicitamente como
criados pela fixture.

## Evidência local

- A correção PR #514 adiciona `fixture-catalog.mjs`, normalização fail-closed,
  validação de contagens, fake compartilhado com contratos RPC e guardas antes
  de mutações.
- `create-adr-scenarios.test.mjs`: contrato dos RPCs de omissão, transbordo e COD.
- `create-financial-scenarios.test.mjs`: estados financeiros sintéticos e TXIDs
  `QAD26-TEST`.
- `create-portal-scenarios.test.mjs`: contas técnicas, reconciliações e reversão
  sem expor a senha.
- `cleanup-fixture.test.mjs`: guardas de catálogo, isolamento e dry-run.

Os testes focados dos scripts corrigidos passam localmente. A execução contra
Supabase controlado não foi realizada nesta sessão: não há credenciais
`SUPABASE_*` configuradas e o artefato operacional existente ainda precisa ser
regenerado pela ordem documentada para registrar IDs de invoices e receivables.
O teste de catálogo que lê esse artefato permanece como evidência explícita
dessa pendência; nenhum ID foi inventado e nenhum cleanup destrutivo foi feito.

## Nota editorial (2026-08-12)

O plano foi encerrado sem executar a fixture contra produção e movido para
`docs/archive/plans/`. O artefato parcial `operational-fixture.json` saiu do
repositório e o teste que fixava a pendência foi substituído por um teste de
contrato do `normalizeCatalog`, que já não depende de nenhum arquivo em disco.
`create-operational.mjs` continua gravando o artefato no mesmo caminho quando a
fixture for reexecutada; o caminho passou a ser ignorado pelo git.
