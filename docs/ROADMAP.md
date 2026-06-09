# Roadmap do Sistema

Atualizado em 2026-06-01.

## Em producao

- Operacao completa com viagens, Baplie EDI, manifestos CNTR e BB, containers, veiculos e revisao manual.
- Modulo Granito em producao (`/granito`, `/granito/taxas`) com importacao COSCO, calculo dedicado e faturamento integrado.
- Modulos de Vazios em producao:
  - Vazios Importacao (`/vazios-importacao`), alimentado por Baplie EDI ou planilha avulsa.
  - Vazios Exportacao (`/embarquevazios`, com redirecionamento de `/vazios`).
- Taxas Locais, Faturamento, Demurrage e Conciliacao PIX em operacao.
- Ledger de faturamento local ativo para B/Ls, invoices individuais e invoices consolidadas.
- Portal do cliente (`/portal/login`, `/portal/billing`) em producao com visao de saldos locais via ledger.
- Alertas, Relatorios, Line Up TV e Admin de usuarios ativos.

## Em evolucao

- Parser de manifestos: novos layouts de armador exigem ajustes iterativos.
- Reconciliacao de cliente: UX ainda pode melhorar para selecao manual em casos ambiguos.
- Cobertura automatizada: ampliar testes de fluxos end-to-end de faturamento, portal e autenticacao.
- UX operacional: melhorias de densidade de dados, feedbacks de loading e refinamentos de tabela.
- Decomposicao gradual das paginas ainda grandes (`BlDetalhe`, `Viagens`, `TaxasLocais`, `Faturamento`, `Revisao`) precedida por testes.

## Backlog

- Formalizar entidade de trecho de viagem (hoje implicita nos B/Ls e agendas).
- Notificacoes em tempo real para eventos operacionais prioritarios.
- Relatorio consolidado de viagem com visao unica CNTR + BB + Granito + Vazios.
- Evolucao de seguranca do portal com camadas adicionais de autenticacao forte.
- Migrar `xlsx` para distribuicao corrigida da SheetJS quando houver PR dedicado com validacao dos parsers.

## Riscos monitorados (ativos)

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| Parser incompativel com layout novo de armador | Medio | Parser isolado + fixtures de regressao por layout |
| Cobertura automatizada parcial em fluxos criticos | Medio | Suite de integracao com Supabase real + roteiro de validacao operacional |
| Reconciliacao ambigua de cliente | Medio | Bloqueio de faturamento enquanto nao houver reconciliacao segura |
| Dependencia de revisao humana para excecoes operacionais | Medio | Fila de revisao com auditoria e trilha de decisao |
| `xlsx` vulneravel sem correcao no npm | Medio | Mantido temporariamente porque `npm audit --omit=dev` informa `No fix available`; mitigado por limite de 10 MB antes de `XLSX.read` e acesso restrito a usuarios internos autenticados; substituir quando houver versao corrigida ou biblioteca alternativa validada para todos os parsers |
