# Fixture QA de Exibição em Produção — Design

## Objetivo

Criar uma massa sintética identificável para testar a disposição atual das
informações operacionais no ambiente de produção, sem alterar taxas locais,
depots, terminais, usuários ou configurações.

## Escopo da fixture

Todas as entidades terão o identificador textual `QA-DISPLAY-2026` ou o prefixo
`QAD26`, conforme o campo permitir. A fixture terá:

- duas viagens, com navios e números de viagem distintos;
- múltiplas escalas brasileiras, POLs e PODs estrangeiros;
- clientes fictícios sem provisionamento de Portal e sem envio de e-mail;
- B/Ls de container, carga solta e exportação;
- containers 20GP, 40GP, 40HC, reefer, tanque e carga perigosa;
- Baplie com containers cheios e vazios;
- veículos vinculados a B/Ls e containers;
- granito com variações de peso, volume e destino;
- vazios embarcados, depots e linhas de serviço usando apenas cadastros
  existentes;
- invoices de taxas locais em estados emitida, parcialmente paga, paga,
  vencida, cancelada e com cobrança consolidada;
- invoices de demurrage com free time, devolução, vencimento, override e
  reversão representados;
- contas sintéticas de Portal para múltiplos clientes;
- pagamentos e conciliações PIX sintéticos, com identificadores de teste;
- registros suficientes para visualização de ADR, exportação, transbordo/COD e
  timeline, incluindo cenários financeiros liquidados e não liquidados.

## Estratégia de criação

Usar os fluxos oficiais do sistema e seus importadores, na ordem abaixo:

1. validar estado atual por consultas somente leitura;
2. criar as viagens e escalas;
3. criar clientes fictícios;
4. importar B/Ls;
5. importar Baplie;
6. importar veículos;
7. importar manifesto de carga solta;
8. criar registros de granito;
9. criar vazios embarcados e linhas de serviço;
10. preparar somente estados operacionais necessários para exibição de ADR,
    omissão, transbordo e COD;
11. criar invoices sintéticas de taxas locais e demurrage, respeitando as
    tabelas e serviços existentes;
12. criar contas sintéticas de Portal sem disparar convites ou mensagens;
13. criar pagamentos e conciliações PIX sintéticos, sem integração bancária;
14. validar as telas e registrar IDs, contagens e evidências.

Invoices, pagamentos, PIX, settlements e contas de Portal serão sintéticos e
identificados pelo prefixo da fixture. Nenhum envio externo, transação bancária
ou convite será disparado. Taxas locais, depots, terminais e seus serviços serão
consultados e referenciados, nunca modificados.

## Isolamento e rollback

Antes da primeira escrita será criado um inventário dos registros existentes e
um catálogo de IDs da fixture. Toda escrita será associada ao usuário de QA e
ao prefixo da fixture. A limpeza será seletiva, baseada nesse catálogo e na
ordem de dependências, nunca por contagem global ou reset operacional.

Se algum fluxo oficial criar efeito derivado não previsto, a execução será
interrompida antes do próximo módulo e o efeito será reportado; não haverá
tentativa de corrigir por exclusão ampla.

## Critérios de validação

- todas as entidades previstas aparecem nas consultas de diagnóstico;
- a rota da viagem mostra múltiplas escalas e sentidos corretamente;
- B/Ls exibem clientes, POL/POD, carga e containers;
- veículos, granito, carga solta e vazios aparecem nas respectivas telas e no
  ADR quando aplicável;
- nenhum registro de taxas locais, depot ou terminal foi alterado;
- invoices de taxas locais e demurrage aparecem em estados variados;
- contas de Portal, pagamentos, settlements e conciliações PIX aparecem sem
  disparo externo;
- nenhum pagamento real, PIX real, convite ou e-mail foi enviado;
- nenhuma alteração ocorreu em taxas locais, depots, terminais ou serviços;
- o catálogo de IDs permite localizar e limpar somente a fixture.

## Evidência operacional

Registrar ambiente, commit/build, data/hora, usuário, IDs, consultas executadas,
resultado observado e limpeza prevista conforme `docs/operations/validacao.md`.
