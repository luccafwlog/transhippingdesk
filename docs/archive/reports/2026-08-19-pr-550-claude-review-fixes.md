# PR 550 — correções da revisão do Claude Code (5341466327)

## Escopo

Revisão publicada pelo Claude Code sobre o head `dd1bbd9`, com os bloqueadores
de alertas terminalizados, o recorte por sentido/modalidade do ADR e os
follow-ups restantes da rodada anterior.

## Tratado nesta rodada

- Alertas de seção, departamento e prazo passaram a usar a identidade
  `viagem::porto::terminal::assunto` quando há ADR terminalizado; ADRs legados
  continuam em `viagem::porto::assunto`.
- Detectores selecionam cada ADR terminalizado sem fan-out, deduplicam por
  chave terminalizada e fecham chaves legadas abertas quando a escala migra.
- Sign-off departamental e fechamento por `report_id` fecham somente os
  alertas do terminal selecionado.
- A projeção preserva `(sentido, modalidade)` por seção; tela e snapshot usam
  o mesmo gate, inclusive para `vazios_descarregados` e `vazios_embarcados`.
- O payload e a RPC removem estados de terminal que ficaram sem frente,
  registrando a remoção na auditoria.
- O caminho legado captura a revisão atual antes de chamar a RPC, em vez de
  fixar `expectedRevision: 0`.

## Follow-ups registrados

- M7: a cobertura da migration continua sendo contrato textual; falta um
  harness Postgres descartável executado no CI para provar grants, RLS e
  atomicidade remotamente.
- Frente de importação persistida sem fonte atual ainda não tem ação explícita
  de remoção; exige uma decisão de produto sobre a autoridade para apagar a
  declaração operacional.
- Permanecem menores de manutenção: paginação de B/Ls, preflight de códigos de
  terminal duplicados antes da migration, comentários sobre `MATCH SIMPLE`,
  limpeza de exports/helpers mortos, nome de PDF e rebase assíncrono do modal.

## Evidência

Os testes focados cobrem o snapshot por sentido/modalidade, a remoção de estado
órfão no payload, a captura de revisão e o contrato da migration 306. Os gates
completos e a resolução do conflito com `origin/main` ficam registrados na
verificação final desta mesma branch.
