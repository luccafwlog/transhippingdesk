# PR 550 — tratamento da revisão complementar do Claude Code

## Escopo

Tratamento do comentário `issuecomment-5341466327`, revisado contra o head da
PR 550 após os fixes anteriores.

## Tratado nesta rodada

- O detector público `detect_agency_report_pending()` delega ao detector por
  departamento; o tipo aposentado `agency_report_section_pending` não volta a
  ser criado.
- ADR legado permanece no caminho por escala e só ADR com `terminal_id` usa as
  RPCs por `report_id`; o filtro legado do ADR evita múltiplos resultados.
- Auditoria terminalizada usa `ces`, registra `deleted=false` apenas para
  retirar soft-delete e sincroniza o status da viagem na mesma RPC/transação.
- O SLA inclui o terminal no select, no modelo, na tabela e na chave React.
- Cadastro de terminal rejeita `null`, vazio e zero como `port_id`.
- Backfill, projeção e rail só reconhecem vazios de exportação quando
  `tem_exportacao=true`.

## Evidência

Os testes focados passaram: 7 arquivos e 190 testes. Também passaram
`npm run typecheck`, `npm run lint`, `npm run docs:check` e `npm run build`.
O contrato da migration 306 foi validado por teste textual automatizado; não
houve execução em Postgres descartável nesta máquina porque WSL e Docker estão
indisponíveis. O estado remoto da migration, RLS e grants continua dependente
da execução no ambiente Supabase/CI.
