# Roadmap do Sistema

Estado de referencia do projeto em 2026-04-16.

## Status Geral

- Base web publicada e operacional em Firebase Hosting.
- Backend em Supabase conectado e autenticado.
- Fase 1 esta entregue e operando.
- Fase 2 esta entregue e encerrada: hardening tecnico, taxas locais, faturamento, regras comerciais, melhorias de revisao.
- Migration `023_customer_commercial_rules` versionada no repositorio.
- Modulo de Faturamento hibrido ativo no app (single B/L + consolidada).
- Fase 3.1 entregue: alertas operacionais, badges no nav, painel expandido.
- Fase 3.2 entregue: modulo de Relatorios com tres abas (operacional, financeiro, por cliente) com filtros, KPIs e export xlsx.
- Fase 4 encerrada: Line up TV, administracao de usuarios e dropdown Admin no nav. Administracao de tarifas descartada (nao necessaria).

## Entregue e Em Uso

### Infraestrutura e base tecnica

- React + TypeScript + Vite.
- Supabase Auth por email e senha.
- Rotas protegidas por perfil.
- Deploy em Firebase Hosting.
- Migrations SQL versionadas em `supabase/migrations`.
- Tema visual com variacoes e layout principal revisado.
- Suite minima de testes com `vitest` para parser e importadores criticos.
- Suite dedicada de integracao com Supabase real (`npm run test:integration`, gated por variaveis de ambiente).

### Operacao de viagens e manifestos

- Cadastro de viagens.
- Edicao de viagens.
- Exclusao de viagens quando permitida pelas regras atuais.
- Armador padrao no cadastro:
  - `Cosco Shipping Specialized Carriers`
  - `CSSC`
- Viagens com multiplos POL e multiplos POD.
- ETD por POL.
- ETA e ATA por POD.
- Consolidacao de trechos por viagem.
- Filtros por navio e numero de viagem.

### Manifestos CNTR

- Importacao de manifestos `.xlsx` e `.csv`.
- Parsing de manifesto tabular e de manifesto real carrier-style.
- Preview antes da importacao.
- Criacao de viagem dentro do fluxo de importacao.
- Identificacao de trecho `POL/POD` no manifesto.
- Consulta paginada de B/Ls.
- Filtros por viagem, POL, POD, texto, revisao, financeiro e perfil.
- Exportacao de manifestos.
- Tela consolidada de containers.
- Importacao complementar de IMO/OOG por planilha.
- Importacao complementar de CE Mercante por planilha.
- Detalhe do B/L com edicao manual.
- Auditoria campo a campo em `audit_logs`.

### Carga Solta / BB

- Modulo de manifestos BB ativo.
- Importacao de manifesto BB no layout operacional atual.
- Consulta paginada de B/Ls BB.
- Exportacao da tela de BB.
- Importacao complementar de CE Mercante por planilha.
- Integracao da carga solta com a viagem.

### Veiculos

- Modulo de veiculos ativo.
- Importacao de planilha de veiculos.
- Validacao de vinculo `viagem -> container -> BL`.
- Varios veiculos por container.
- Varios veiculos por BL.
- Listagem, busca, filtros e cards de resumo.
- Exibicao de veiculos no detalhe do B/L CNTR.

### Clientes

- Cadastro mestre de clientes.
- Importacao de base de clientes.
- CNPJ/CPF e Razao Social obrigatorios na importacao.
- Importacao de multiplos emails por cliente.
- Ficha do cliente com edicao.
- Contatos por finalidade.
- Historico de B/Ls e invoices na ficha do cliente.
- Exclusao de cliente.
- Filtros por emails, B/Ls e saldo pendente.

### Revisao Manual

- Fila de revisao manual.
- Correcao manual de B/L com justificativa.
- Marcacao de B/L como `reviewed`.
- Auditoria da revisao.
- Tratamento de conflito concorrente com mensagem especifica ao operador.

### Observabilidade operacional minima

- Eventos criticos registrados em `audit_logs` com `entity_type = system_event`:
  - `manifest_import_rate_limited` (P0429)
  - `manifest_import_duplicate_hash` (23505)
  - `bl_review_concurrent_conflict` (40001)
  - `invoice_create_conflict`
  - `invoice_payment_invalid`
  - `invoice_cancel_blocked`

### Taxas Locais

- Tela operacional ativa em `/taxas-locais`.
- CRUD de tabelas de taxa e itens.
- Overrides por cliente.
- Simulacao por B/L.
- Lancamentos manuais de other charges por B/L.
- Acoes em lote:
  - calcular/recalcular
  - marcar revisado
  - marcar pronto para faturar
- Exportacao da operacao filtrada.

### Faturamento

- Tela funcional em `/faturamento`.
- Emissao hibrida:
  - por B/L unico
  - consolidada por multiplos B/Ls do mesmo cliente
- Snapshot de itens na invoice via `invoice_items`.
- Vinculo N:N invoice <-> B/L via `invoice_bls`.
- Registro de baixa parcial e total.
- Cancelamento com rollback de status financeiro do B/L.
- Detalhe da invoice com:
  - cabecalho
  - itens
  - pagamentos
  - B/Ls vinculados
- Geracao de PDF da invoice no frontend via `jsPDF` (estavel com React 19).

### Estabilizacao operacional (Fase 2.2)

- Auto-trigger de taxas locais (fire-and-forget) apos import CNTR e BB em
  `manifestImport.ts` e `breakbulkImport.ts`: calcula em lotes de 5; falhas
  de calculo nao invalidam o import.
- Validacao com Zod nos formularios criticos: viagens (`voyageFormSchema`),
  clientes (CNPJ/CPF + Razao Social) — erros inline por campo.
- Global Error Boundary (`src/components/ErrorBoundary.tsx`): captura
  excecoes React nao tratadas e exibe tela amigavel com reload.
- Reconciliacao automatica aprimorada (`customerReconciliation.ts`):
  `canonicalizeName()` remove sufixos legais (LTDA, S/A, EIRELI, EPP, ME)
  e pontuacao antes da comparacao; terceiro mapa `customersByCanonicalName`
  em `loadCustomerMaps()`. Permite casar "ALLOG GALERIA - TRANSPORTES LTDA."
  com "ALLOG GALERIA TRANSPORTES".
- Suite de testes estabilizada: 10 arquivos, 38 testes, 0 falhas.

### Encerramento da Fase 2 (2026-04-16)

- Melhorias de produtividade na revisao manual (`Revisao.tsx`):
  - Busca por texto (B/L, consignatario, shipper) com filtro em memoria.
  - Filtro por motivo de pendencia (pills clicaveis com todas as razoes unicas).
  - Navegacao anterior/proximo dentro do modal sem fechar a fila.
  - Avanco automatico para o proximo item apos salvar revisao.
  - Contador de progresso no modal (X de Y).
- Overrides de taxa com indicador de vigencia: ativa / futura / vencida / aberta.
  Linhas vencidas aparecem com opacidade reduzida e texto riscado.
- Regras comerciais por cliente (`migration 023_customer_commercial_rules`):
  - Colunas `payment_terms_days` (default 30), `discount_pct` (default 0), `commercial_notes`
    na tabela `customers`.
  - Card "Regras Comerciais" na ficha do cliente com formulario dedicado e auditoria.

### Line up TV e Administracao (Fase 4)

- Tela `/line-up-tv`: visao consolidada das viagens ativas e concluidas com colunas
  de armador, navio, viagem, rota (POL → POD), ETD/ETA/ATA, contagem de B/Ls, containers
  distintos e cargas soltas. Filtro por status (todas / ativas / concluidas). Auto-refresh
  a cada 90 segundos com botao de atualizacao manual.
- Tela `/admin/usuarios` (acesso restrito a admins): listagem de todos os perfis de usuario
  com funcao (admin / operador) e status (ativo / inativo). Acoes inline para alternar
  funcao e status sem sair da tela.
- Dropdown "Admin" no nav: visivel apenas para usuarios com `role = 'admin'`.

### Relatorios (Fase 3.2)

- Modulo `/relatorios` ativo com tres abas operacionais:
  - **Operacional**: filtros por periodo, POD e modalidade; KPIs de B/Ls, containers
    distintos, viagens, peso e CBM; tabela detalhada e export xlsx.
  - **Financeiro**: filtros por periodo e status; KPIs de total emitido, pago, em aberto
    e canceladas; tabela com invoice, cliente, datas e saldo; trata RLS com aviso
    amigavel para nao-admin; export xlsx.
  - **Por Cliente**: filtros por periodo; agregacao em memoria com B/Ls, peso, CBM,
    invoices e totais por cliente; ranking por faturamento; export xlsx.
- Servicos dedicados em `src/services/reports.ts` com limite de 2.000 linhas e flag
  `truncated` para alertar quando o filtro precisa ser ajustado.
- Link "Relatorios" adicionado ao dropdown Financeiro no nav.

## Entregue, Mas Ainda Precisa Complemento

### Parsing de manifesto

- O parser atual cobre os layouts ja utilizados nos testes.
- Ainda nao ha garantia de leitura correta para qualquer layout novo de armador.
- O parser ainda depende de ajustes iterativos conforme novos manifestos reais aparecem.

### Modelagem de viagem

- O sistema hoje opera bem com o modelo atual.
- Porem, o conceito de trecho ainda esta implicito nos B/Ls importados.
- Ainda nao existe uma entidade formal de trecho ou manifesto de viagem.

### Qualidade e regressao

- `npm test` passa.
- `npm run lint` passa.
- `npm run build` passa.
- `npm run test:integration` disponivel para homologacao com Supabase real.
- Ha cobertura automatizada inicial para:
  - parser CNTR
  - parser BB
  - importacao de veiculos
  - importacao de CE Mercante
  - validacao de hardening (dedupe/rate-limit/optimistic-lock/RLS) via suite de integracao gated
- Os fluxos principais seguem exigindo validacao manual complementar.

### UX operacional

- O visual principal esta em nivel utilizavel e consistente.
- Ainda existe espaco para refinamento fino em tabelas, dropdowns, responsividade e densidade de informacao.

## Nao Tratar Como Pronto

### Fase 2 — Encerrada

Todos os itens da Fase 2 foram entregues. Ver secao "Entregue e Em Uso".

### Fase 3

- Relatorios.

### Fase 4 — Encerrada

Todos os itens planejados foram entregues. Administracao de tarifas descartada pelo time.

## Principais Riscos Atuais

- Parser pode exigir ajuste para novos layouts de manifesto.
- A suite automatizada ainda e inicial e cobre apenas os fluxos mais criticos.
- `xlsx` segue com vulnerabilidade conhecida sem correcao disponivel no ecossistema atual.
- O modelo de trecho ainda esta implicito nos B/Ls.
- Ainda existem rotas placeholder acessiveis por URL direta, embora escondidas da navegacao principal.

## Proximos Passos Recomendados

### Fase 2.1 - Gate de estabilizacao (executado)

1. Hardening de banco aplicado ate migration `015`.
2. Documentacao de validacao e baseline atualizada.
3. Eventos criticos mapeados em observabilidade minima (`audit_logs`).
4. Suite de integracao com Supabase real disponivel para homologacao controlada.

### Fase 2.2 — Encerrada

- Reconciliacao automatica: entregue (canonical name matching em `canonicalizeName()`).
- Melhoria do parser: bloqueada — depende de novos fixtures reais de armadores.
- Formalizacao da entidade de trecho: adiada para pos-Fase 3.

### Fase 3.1 — Entregue

- Badges no nav com contagens de pendencias (revisao, taxas, faturamento, alertas).
- Painel expandido: KPIs de charge_status (taxas para revisar, prontos para faturar),
  cards cliclantes que navegam para a tela correspondente, bug de encoding corrigido.
- Modulo de Alertas ativo em `/alertas`: lista de alertas open/acknowledged,
  acoes de reconhecer e fechar, badge no nav com total de alertas nao fechados.

### Fase 3 - Operacao expandida

1. ~~Implementar Alertas operacionais.~~ (entregue em Fase 3.1)
2. ~~Implementar Relatorios.~~ (entregue em Fase 3.2)
3. ~~Integrar alertas financeiros no modulo de faturamento.~~ (entregue em Fase 3.3)

### Fase 4 — Encerrada

1. ~~Line up TV.~~ (entregue)
2. ~~Administracao de usuarios.~~ (entregue)
3. Administracao de tarifas: descartada pelo time.

### Ciclo atual — Refinamento de UX/UI

- Padronizacao de feedback visual em botoes (spinner de loading).
- Empty states com icone nas tabelas principais.
- Padronizacao de mensagens de erro inline.
- Remocao de rotas placeholder inacessiveis.

## Conclusao objetiva

Estado honesto:

- O sistema atende integralmente a operacao assistida de viagens, manifestos CNTR, carga solta, veiculos, revisao, clientes, taxas locais, faturamento, alertas, relatorios, line up TV e administracao de usuarios.
- Todas as fases planejadas (1, 2, 3, 4) foram encerradas.
- O ciclo atual foca em refinamento de UX/UI e qualidade visual sem novas funcionalidades.
