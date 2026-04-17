# Roadmap do Sistema

Estado de referencia do projeto em 2026-04-17.

## O que o sistema faz hoje

O Transhipping Desk e uma plataforma operacional interna para agencia maritima. Cobre o ciclo completo de operacao: cadastro de viagens com multiplos POL e POD, importacao e revisao de manifestos CNTR e BB, gestao de veiculos, rastreamento de carga solta, gestao de clientes com regras comerciais, calculo de taxas locais com overrides por cliente, emissao de invoices unitaria e consolidada com registro de baixa e cancelamento, orquestracao de billing por manifesto, reconciliacao de cliente para faturamento, portal do cliente para consulta e consolidacao, alertas operacionais com badges no nav, relatorios gerenciais exportaveis em xlsx, visualizacao de line up para TV e administracao de usuarios com controle de perfil. O backend roda em Supabase com RLS e autenticacao; o frontend em React + TypeScript + Vite e publicado no Firebase Hosting.

---

## Entregue

### Autenticacao e Acesso

- Login por email e senha via Supabase Auth.
- Rotas protegidas por perfil (operador / admin).
- Dropdown "Admin" no nav visivel apenas para administradores.
- Badges numericos no nav com contagens de pendencias por fila.

### Painel Executivo

- KPIs operacionais: B/Ls, containers distintos, viagens, carga solta, veiculos.
- KPIs financeiros: taxas a revisar, prontos para faturar, invoices abertas.
- Cards clicaveis que navegam para a fila correspondente.
- Correcao de encoding de caracteres especiais.

### Viagens

- Cadastro, edicao e exclusao de viagens.
- Armador padrao: Cosco Shipping Specialized Carriers / CSSC.
- Multiplos POL e POD por viagem com ETD, ETA e ATA.
- Filtros por navio e numero de viagem.
- Validacao com Zod no formulario de cadastro.

### Manifestos CNTR

- Importacao de `.xlsx` e `.csv` nos layouts tabular e carrier-style.
- Preview antes da importacao; criacao de viagem inline no fluxo de import.
- Identificacao de trecho POL/POD no manifesto.
- Consulta paginada com filtros por viagem, POL, POD, texto, revisao e financeiro.
- Importacao complementar de IMO/OOG e CE Mercante por planilha.
- Detalhe do B/L com edicao manual e auditoria campo a campo em `audit_logs`.
- Exportacao de manifestos.
- Auto-trigger de billing apos importacao bem-sucedida do manifesto.

### Manifestos BB - Carga Solta

- Importacao de manifesto BB no layout operacional.
- Consulta paginada com filtros e exportacao.
- Importacao complementar de CE Mercante.
- Auto-trigger de billing apos importacao.

### Containers

- Tela consolidada de containers vinculados a viagens com filtros.

### Veiculos

- Importacao de planilha de veiculos com validacao de vinculo viagem -> container -> B/L.
- Varios veiculos por container e por B/L.
- Listagem com busca, filtros e cards de resumo.
- Exibicao de veiculos no detalhe do B/L CNTR.

### Revisao Manual

- Fila de revisao com busca por texto (B/L, consignatario, shipper).
- Filtro por motivo de pendencia com pills clicaveis.
- Correcao manual com justificativa e auditoria.
- Navegacao anterior/proximo no modal sem fechar a fila.
- Avanco automatico para o proximo item apos salvar revisao.
- Contador de progresso no modal (X de Y).
- Marcacao de B/L como reviewed com tratamento de conflito concorrente.

### Clientes

- Cadastro mestre com CNPJ/CPF e Razao Social obrigatorios.
- Importacao de base de clientes e multiplos emails por cliente.
- Ficha com edicao, contatos por finalidade e historico de B/Ls e invoices.
- Regras comerciais por cliente: prazo de pagamento, desconto percentual, notas.
- Provisionamento de acesso ao portal na ficha do cliente.
- Reconciliacao automatica por nome canonico (remove sufixos legais e pontuacao).
- Filtros por email, B/L e saldo pendente.
- Exclusao de cliente.

### Taxas Locais e Billing

- CRUD de tabelas de taxa e itens.
- Overrides por cliente com indicador de vigencia: ativa / futura / vencida / aberta.
- Simulacao de taxa por B/L; lancamentos manuais de other charges.
- Acoes em lote: calcular/recalcular, marcar revisado, marcar pronto para faturar.
- Billing runs por manifesto com logs estruturados de bloqueio e calculo.
- Fila de reconciliacao de cliente quando o manifesto nao encontra vinculo seguro.
- Bloqueio formal de faturamento para B/L sem cliente reconciliado.
- Aba `Operacao` reorganizada em `Visao executiva` e `Grade de B/Ls`, reduzindo densidade e trazendo reconciliacao e billing runs para a primeira dobra.
- Exportacao da operacao filtrada.

### Faturamento

- Emissao por B/L unico ou consolidada por multiplos B/Ls do mesmo cliente.
- Snapshot de itens via `invoice_items`; vinculo N:N invoice <-> B/L via `invoice_bls`.
- Registro de baixa parcial e total.
- Cancelamento com rollback de status financeiro do B/L.
- Detalhe da invoice: cabecalho, itens, pagamentos, B/Ls vinculados.
- Geracao de PDF no frontend via jsPDF.
- `billing_batches` para consolidacao explicitamente rastreada.
- Tela interna de faturamento refinada com resumo de selecao na emissao e detalhe da invoice alinhado ao portal (contexto, snapshot, itens e pagamentos).

### Portal do Cliente

- Login por CNPJ + senha propria.
- Sessao isolada por cliente, sem acesso cross-customer.
- Overview com saldo aberto derivado de invoices ativas.
- Listagem de B/Ls elegiveis para consolidacao.
- Listagem de invoices emitidas.
- Detalhe de invoice com B/Ls, itens e pagamentos.
- Download de PDF a partir do snapshot da invoice.
- Consolidacao sob demanda via `portal_create_consolidation`.
- Fluxo validado em 2026-04-17 com emissao real da invoice `INV-2026-0005` para o cliente `10268203000117` a partir de 2 B/Ls elegiveis.
- Revisao visual ampliada executada em 2026-04-17 nas rotas internas e externas, com screenshots e checklist de UX.

### Alertas Operacionais

- Lista de alertas abertos e reconhecidos.
- Acoes de reconhecer e fechar.
- Badge no nav com total de alertas nao fechados.
- Alertas financeiros integrados ao modulo de Faturamento.

### Relatorios

- Aba Operacional: filtros por periodo, POD e modalidade; KPIs de B/Ls, containers, viagens, peso e CBM; tabela detalhada e export xlsx.
- Aba Financeiro: filtros por periodo e status; KPIs de total emitido, pago, em aberto e canceladas; tabela com saldo; aviso para nao-admin (RLS); export xlsx.
- Aba Por Cliente: agregacao em memoria com ranking por faturamento; export xlsx.
- Limite de 2.000 linhas com flag `truncated` para alertar quando o filtro precisa ser ajustado.

### Line up TV

- Visao consolidada das viagens ativas e concluidas.
- Colunas: armador, navio, viagem, rota (POL -> POD), ETD/ETA/ATA, B/Ls, containers distintos, cargas soltas.
- Filtro por status (todas / ativas / concluidas).
- Auto-refresh a cada 90 segundos com botao de atualizacao manual.

### Administracao de Usuarios

- Listagem de todos os perfis com funcao (admin / operador) e status (ativo / inativo).
- Toggle inline de funcao e status sem sair da tela.
- Acesso restrito a usuarios com `role = 'admin'`.

### Infraestrutura e Qualidade

- React + TypeScript + Vite; Supabase Auth + PostgreSQL + RLS.
- 27 migrations SQL versionadas em `supabase/migrations/`.
- Deploy em Firebase Hosting (projeto `importmanager-bda3e`).
- Global Error Boundary para excecoes React nao tratadas.
- Validacao com Zod nos formularios criticos (viagens, clientes).
- Observabilidade minima: eventos criticos em `audit_logs` com `entity_type = system_event`.
- Suite de testes unitarios com vitest: parser CNTR, parser BB, importacao de veiculos, reconciliacao e faturamento.
- Suite de integracao com Supabase real disponivel via `npm run test:integration`.
- Code splitting por rota e carregamento dinamico de `jspdf`, reduzindo o custo inicial do bundle principal.

---

## Melhorias em Aberto

- **Parser de manifesto**: cobre os layouts conhecidos; ajustes iterativos ainda serao necessarios conforme novos armadores aparecem.
- **Entidade de trecho**: o conceito de trecho ainda esta implicito nos B/Ls; nao ha entidade formal de trecho de viagem.
- **Cobertura de testes**: os fluxos principais ainda exigem validacao manual complementar alem da suite automatica.
- **UX operacional**: ainda ha espaco para refinamento fino em tabelas, dropdowns, responsividade e densidade de informacao.
- **Fila de reconciliacao**: a base esta pronta, mas a selecao manual de cliente pela UI ainda pode ser ampliada.

---

## Proximas Entregas - Curto Prazo

- Melhorar a UI de reconciliacao para escolher cliente manualmente quando nao houver sugestao segura.
- Padronizar feedback visual em botoes (spinner de loading em acoes assincronas).
- Empty states com icone nas tabelas principais.
- Padronizar mensagens de erro inline.

---

## Novas Funcionalidades - Medio Prazo

- Melhoria do parser para novos layouts de armador (depende de fixtures reais de novos armadores).
- Formalizacao da entidade de trecho de viagem no modelo de dados.
- Notificacoes em tempo real para alertas operacionais via Supabase Realtime.
- Expansao da cobertura de testes automatizados para fluxos de faturamento e portal.

---

## Visao de Longo Prazo

- Portal do cliente com autenticao forte adicional e trilha antifraude.
- Integracao automatizada com CE Mercante via API publica.
- Modulo de relatorios avancados com drill-down por viagem e por cliente.
- Auditoria completa e rastreabilidade por usuario em todas as entidades.

---

## Riscos Monitorados

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| Parser incompativel com novo layout de armador | Medio | Ajuste pontual apos novo fixture; parser isolado e coberto por testes |
| Vulnerabilidade conhecida no pacote `xlsx` | Medio | Sem patch disponivel no ecossistema atual; monitorar atualizacoes do pacote |
| Modelo de trecho implicito nos B/Ls | Baixo | Operacao atual nao e afetada; migracao formal planejada para ciclo futuro |
| Cobertura automatizada parcial nos fluxos principais | Medio | Suite de integracao disponivel para homologacao controlada com Supabase real |
| Reconciliacao de cliente ainda depende de revisao humana em casos ambiguos | Medio | Billing bloqueia `ready_for_billing` ate a reconciliacao correta |
