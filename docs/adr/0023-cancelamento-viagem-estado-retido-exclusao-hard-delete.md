# ADR 0023: Cancelamento de Viagem é Estado Retido; Exclusão é Hard Delete

Status: aceito

Data: 2026-07-10

## Contexto

O status `cancelled` de uma viagem havia sido omitido de alguns filtros e uma
alteração de ATD podia recalcular o status para `active` ou `completed`.
Isso confundia cancelamento com exclusão e apagava a intenção operacional
registrada ao cancelar.

## Decisão

- Tratar `cancelled` como estado retido de `voyages`. No Painel, o filtro
  padrão permanece em viagens ativas e canceladas aparecem em `Canceladas` ou
  `Todas`; em Viagens, o filtro padrão `Todas` também inclui canceladas.
- Impedir que a sincronização automática após alteração de ATD modifique uma
  viagem já cancelada.
- Manter exclusão como hard delete controlado, sujeito aos bloqueios de
  dependências já definidos pela ADR 0009; não há status `deleted` de viagem.

## Consequências

O Line-Up e o rail de Viagens devem conservar a opção de filtro `cancelled`.
Automatismos de agenda continuam calculando apenas `active` e `completed` para
viagens não canceladas. Recuperar uma viagem cancelada exige ação explícita que
altere seu status; não é efeito colateral de agenda.
