# ADR 0043 — Vínculo de cliente somente por documento

## Status

Aceito e implementado nas migrations `284`–`287`.

## Decisão

O vínculo automático de um B/L ou Granito só pode ocorrer por CPF/CNPJ exato,
normalizado para dígitos. Match por nome continua sendo uma sugestão persistida
em `bls.suggested_customer_id` ou `granite_bls.suggested_client_id` e só vira
vínculo após confirmação humana na fila de revisão.

As duas FKs para `customers` são qualificadas nos embeds PostgREST. O
faturamento continua lendo apenas `customer_id`/`client_id`; sugestões não
liberam cobrança. O backfill 287 exclui faturados e decisões humanas e pode ser
reexecutado sem mover a mesma linha novamente.

## Consequências

Imports de container, carga solta e Granito preservam o candidato sugerido, a
fila o exibe, e a confirmação usa os RPCs de revisão existentes. A contagem de
impacto deve ser executada em somente-leitura antes da aplicação em cada ambiente.
