# Roadmap

> **Atualizado:** 2026-06-18. Estado atual, em evolução, backlog e riscos ativos.

## Em produção

- Operação completa: viagens (master-detail), Baplie EDI, manifestos CNTR e break-bulk, containers, veículos e revisão manual.
- **Chegadas/Saídas** (`/chegadas-saidas`): schedule de navios por porto (`vessel_schedules`).
- Módulo **Granito** (`/granito`, `/granito/taxas`): import COSCO, cálculo dedicado e faturamento integrado.
- **Vazios**: importação (`/vazios-importacao`, via Baplie ou planilha) e exportação (`/embarquevazios`).
- **Financeiro**: Taxas Locais, Faturamento (ledger local, invoices individuais e consolidadas), Demurrage e Conciliação PIX.
- **Portal do Cliente** expandido: dashboard, billing, operação, perfil, login por CNPJ ou email, recuperação de senha, disputas de demurrage, notificações in-app, reconsolidação self-service e gate por CE Mercante.
- Suporte: Alertas, Relatórios, Line-Up TV e Admin de usuários.

## Em evolução

- **Parser de manifestos:** novos layouts de armador exigem ajustes iterativos (mitigado por fixtures de regressão).
- **Reconciliação de cliente:** UX para seleção manual em casos ambíguos.
- **Cobertura automatizada:** ampliar testes end-to-end de faturamento, portal e autenticação.
- **UX operacional:** densidade de dados, feedbacks de loading, refinamentos de tabela.
- **Decomposição de páginas grandes** ainda pendentes (`BlDetalhe`, `TaxasLocais`, `Faturamento`, `Revisao`), precedida por testes. *(A página `Viagens` já foi refatorada para master-detail — ADR 0012.)*

## Backlog

- Formalizar entidade de **trecho de viagem** (hoje implícita nos B/Ls e agendas).
- Notificações em tempo real para eventos operacionais prioritários.
- Relatório consolidado de viagem com visão única CNTR + BB + Granito + Vazios.
- Camadas adicionais de autenticação forte no portal.
- Migrar `xlsx` para distribuição corrigida da SheetJS quando houver PR dedicado com validação dos parsers.

## Riscos monitorados (ativos)

| Risco | Impacto | Mitigação |
|---|---|---|
| Parser incompatível com layout novo de armador | Médio | Parser isolado + fixtures de regressão por layout |
| Cobertura automatizada parcial em fluxos críticos | Médio | Suíte de integração com Supabase real + [roteiro de validação](operations/validacao.md) |
| Reconciliação ambígua de cliente | Médio | Bloqueio de faturamento enquanto não houver reconciliação segura |
| Dependência de revisão humana para exceções | Médio | Fila de revisão com auditoria e trilha de decisão |
| `xlsx` vulnerável sem correção no npm | Médio | Limite de 10 MB antes de `XLSX.read` + acesso restrito a usuários autenticados; substituir quando houver versão corrigida |

Decisões já tomadas estão em [adr/](adr/); entregas relevantes em [CHANGELOG.md](CHANGELOG.md).
