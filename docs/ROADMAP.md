# Roadmap do Sistema

Atualizado em 2026-05-13.

## Em producao

- Operacao completa com viagens, manifestos CNTR e BB, containers, veiculos e revisao manual.
- Modulo Granito em producao (`/granito`, `/granito/taxas`) com importacao COSCO e faturamento dedicado.
- Modulos de Vazios em producao:
  - Vazios Importacao (`/vazios-importacao`)
  - Vazios Exportacao (`/embarquevazios`, com redirecionamento de `/vazios`)
- Taxas Locais, Faturamento, Demurrage e Conciliacao PIX em operacao.
- Portal do cliente (`/portal/login`, `/portal/billing`) em producao.
- Alertas, Relatorios, Line Up TV e Admin de usuarios ativos.

## Em evolucao

- Parser de manifestos: novos layouts de armador exigem ajustes iterativos.
- Reconciliacao de cliente: UX ainda pode melhorar para selecao manual em casos ambiguos.
- Cobertura automatizada: ampliar testes de fluxos end-to-end de faturamento e portal.
- UX operacional: melhorias de densidade de dados, feedbacks de loading e refinamentos de tabela.

## Backlog

- Formalizar entidade de trecho de viagem (hoje implicita nos B/Ls e agendas).
- Notificacoes em tempo real para eventos operacionais prioritarios.
- Relatorio consolidado de viagem com visao unica CNTR + BB + Granito + Vazios.
- Evolucao de seguranca do portal com camadas adicionais de autenticacao forte.

## Riscos monitorados (ativos)

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| Parser incompativel com layout novo de armador | Medio | Parser isolado + fixtures de regressao por layout |
| Cobertura automatizada parcial em fluxos criticos | Medio | Suite de integracao com Supabase real + roteiro de validacao operacional |
| Reconciliacao ambigua de cliente | Medio | Bloqueio de faturamento enquanto nao houver reconciliacao segura |
| Dependencia de revisao humana para excecoes operacionais | Medio | Fila de revisao com auditoria e trilha de decisao |
