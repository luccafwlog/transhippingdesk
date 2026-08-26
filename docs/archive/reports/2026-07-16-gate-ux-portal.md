# Gate UX pré-piloto do Portal — registro de 2026-07-16

Registro histórico de aplicação das migrations e validação do console de
provisionamento. Não substitui o roteiro vivo em
[`docs/operations/validacao.md`](../../operations/validacao.md).

Antes do piloto, a orientação era aplicar migrations numeradas pelo fluxo
controlado, confirmar as migrations `196` e `197` no ambiente alvo e registrar
comandos e resultados. A validação deveria ocorrer em desktop, notebook, mobile
e teclado, sem registrar PII.

Confirmado via `mcp__Supabase__list_migrations` no projeto Transhipping Desk em
2026-07-16: as migrations `196`, `197` e `198` estavam aplicadas. A `198`
reparava lacunas antes da leitura e registrava o evento de sistema sem criar
Auth, convite ou email.

A aceitação exigia zero `customers_missing_record` e a fila `Todos` populada,
sem registrar CNPJ ou email nas evidências.

Runtime confirmado em 2026-07-16 após a aplicação da `198` e o backfill
autorizado: `total_customers=310`, `existing_portal_records=310`,
`existing_auth_links=0`, `existing_recovery_emails=0` e
`customers_missing_record=0`; `/clientes/portal?filtro=todos` exibiu Total 310
e Aguardando análise 310; o badge de Clientes também exibiu 310.

Nenhum ID, usuário, B/L, container, invoice, pagamento, disputa, programação ou
arquivo de banco foi criado nesta execução. O script suspenso
`supabase/scripts/reset_operational_data.sql` não foi executado.
