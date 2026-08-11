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

- `create-adr-scenarios.test.mjs`: contrato dos RPCs de omissão, transbordo e COD.
- `create-financial-scenarios.test.mjs`: estados financeiros sintéticos e TXIDs
  `QAD26-TEST`.
- `create-portal-scenarios.test.mjs`: contas técnicas, reconciliações e reversão
  sem expor a senha.
- `cleanup-fixture.test.mjs`: guardas de catálogo, isolamento e dry-run.

Não há evidência de execução em produção neste relatório.
