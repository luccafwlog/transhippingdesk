# Bloco 5 — Relatório de Agência (ADR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** implementar os Alertas e Notificações Internas do ADR em um único
agregado por escala, preservando as regras de sign-off, prazo e histórico das
ADRs 0027–0039.

**Architecture:** a fundação transversal da PR #517 fornece o agregado, itens,
dispensa, fan-out e executor server-only. O Bloco 5 apenas registra os dois
produtores do ADR no catálogo central: pendência departamental normal e prazo
vencido crítico. Ambos usam `agency_departure_report / voyageId::PORTO`; o
departamento fica no item e determina a audiência. As RPCs existentes de
resolução, sign-off, fechamento e reabertura continuam sendo as origens da
verdade, com reconciliação idempotente imediata e varredura de segurança de 15
minutos.

**Tech Stack:** React/TypeScript, Supabase PostgreSQL/RPCs, `pg_cron` somente
através do executor server-only protegido, TanStack Query, Vitest e testes de
contrato SQL.

**Spec:** [`2026-08-17-bloco-524-adr-alertas-design.md`](../spec/2026-08-17-bloco-524-adr-alertas-design.md)
**Issue:** [#524](https://github.com/luccafwlog/transhippingdesk/issues/524)
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)

## Dependências e bloqueio explícito

- Integrar a fundação documental/implementada da PR #517 antes de criar uma
  tabela ou RPC própria de item.
- Respeitar a ordem documental **#517 → #544 → #543 → #545 → #546 → #524**;
  rebasear o bloco #524 depois de cada integração anterior.
- Consumir a regra já implementada na migration `271` para o prazo; não
  reescrever o cálculo como detector independente.
- Antes da tarefa de mutação de seção, o responsável pelo produto deve escolher
  uma das duas alternativas válidas da spec: bloquear a seção até reabrir o
  departamento, ou invalidar atomicamente o sign-off departamental. A terceira
  alternativa — manter seção pendente com sign-off vigente — é proibida pelo
  gate de fechamento.

## Mapa de arquivos

Arquivos que a implementação deverá tocar depois desta etapa documental:

- **Schema/RPCs:** uma ou mais migrations novas, após conferir o próximo prefixo
  disponível no branch integrado; nunca editar `214`, `225`, `251`, `253` ou
  `271`.
- **Catálogo/fan-out:** arquivos da fundação #517 que registram tipo, gravidade,
  item, audiência, dedupe e notificação.
- **Serviço:** `src/services/alerts.ts` e o módulo compartilhado de destino que
  substituirá a regra local de `src/pages/Alertas.tsx`.
- **Tela:** `src/pages/Alertas.tsx` para rótulos, remoção do reconhecimento
  conforme a fundação e destino direto; `src/pages/Viagens.tsx` e
  `src/components/voyages/VoyageAgencyReportTab.tsx` apenas se o contrato de
  deep-link exigir ajuste.
- **ADR:** `src/services/agencyDepartureReport.ts` para mapa de seções/donos e
  reavaliação após mutations; `src/hooks/useAgencyReport.ts` para invalidação.
- **Testes:** testes SQL de migrations/RPCs; `src/services/__tests__/alertsEntityFormat.test.ts`,
  `src/services/__tests__/agencyDepartureReport.test.ts`,
  `src/pages/__tests__/Alertas.behavior.test.tsx` e
  `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`.

## Tarefas

### Task 0: fechar o checkpoint de produto da reabertura de seção

**Arquivos:** spec do Bloco 5, Issue #524 e painel #519; nenhum arquivo de
produção nesta tarefa.

- [ ] **Step 1: Registrar a escolha do responsável.** Atualizar a spec e o
  plano com a alternativa escolhida e a consequência transacional.
- [ ] **Step 2: Definir o teste de contrato.** O teste deve provar que nunca se
  fecha um ADR com seção pendente e sign-off departamental vigente sem uma
  transição auditada que resolva a inconsistência.
- [ ] **Step 3: Revalidar a matriz de audiência.** Confirmar que a escolha não
  cria alerta por seção, audiência por pessoa ou notificação ao Financeiro.

### Task 1: integrar o agregado da fundação ao ADR

**Arquivos:** migrations novas do contrato central #517; catálogo server-side de
tipos; testes de contrato SQL.

- [ ] **Step 1: Registrar os dois itens no catálogo central.** Use exatamente
  `agency_report_department_pending` e `agency_report_deadline_missed`; o
  primeiro é `normal`, o segundo `critical`. Declare o departamento como
  atributo/audiência do item, nunca como `alerts.assigned_to`.
- [ ] **Step 2: Fixar a entidade pai.** Criar a chave única do agregado em
  `(entity_type = 'agency_departure_report', entity_id = voyageId::PORTO)`.
  O departamento deve existir somente na chave interna do item e no payload
  de audiência.
- [ ] **Step 3: Preservar os estados da fundação.** Não criar reconhecimento,
  estado paralelo ou fechamento manual local. O agregado fecha somente sem
  itens ativos; a origem decide a resolução.
- [ ] **Step 4: Escrever testes SQL antes da alteração dos produtores.** Cobrir
  três departamentos, dois tipos simultâneos, reexecução do mesmo detector,
  resolução parcial e retorno de um item ao estado ativo.
- [ ] **Step 5: Rodar o teste focado.** Executar o comando de testes SQL definido
  pelo repositório e esperar que a suíte detecte a ausência dos produtores
  migrados; não tratar o teste estrutural como prova de runtime Supabase.

### Task 2: fazer backfill do legado sem reescrever histórico

**Arquivos:** migration nova de backfill; `src/pages/Alertas.tsx` e seus testes.

- [ ] **Step 1: Mapear a chave histórica para departamento.** Usar os donos das
  seis seções atuais. Para chaves aposentadas, preservar o dono histórico de
  `operacao_patio` (Equipamentos) e `ocorrencias` (Operações) somente para
  converter linhas existentes; não reintroduzir essas seções no contrato vivo.
- [ ] **Step 2: Consolidar linhas abertas.** Para cada linha aberta de
  `agency_report_section_pending`, criar/atualizar no máximo o item
  `agency_report_department_pending` do agregado da escala elegível. Se a
  escala não for elegível, não inventar item ativo.
- [ ] **Step 3: Fechar o legado de forma auditável.** Marcar a linha histórica
  como fechada com `closed_at` da migration e inserir registro de backfill no
  mecanismo de auditoria disponível; não apagar, renomear ou mudar seu
  `entity_id` antigo.
- [ ] **Step 4: Tornar a migration repetível.** A segunda execução não pode
  criar item, notificação ou histórico duplicado. O resultado esperado é zero
  novas linhas e as mesmas chaves abertas/fechadas.
- [ ] **Step 5: Corrigir o catálogo visual.** Remover o rótulo principal de
  `agency_report_section_pending` da fila e adicionar/usar o rótulo de
  `agency_report_department_pending`; manter o label legado somente para
  histórico fechado quando necessário.

### Task 3: ajustar a origem da pendência departamental

**Arquivos:** migration/RPC nova baseada na definição final de `225`, `251` e
`253`; serviço de reavaliação do agregado; testes SQL e de serviço.

- [ ] **Step 1: Reusar a projeção elegível.** A avaliação deve considerar a
  escala unificada, somente porto brasileiro, POD canônico com POL preenchendo
  lacunas, sem `deleted`/`omitted` e respeitando a baseline já gravada.
- [ ] **Step 2: Definir o predicado do item.** Após ATD, o item normal permanece
  ativo enquanto o departamento não tiver sign-off vigente; se uma seção voltar
  a `pending`, a origem específica fica registrada no item sem mudar o
  agregado.
- [ ] **Step 3: Fechar pela origem correta.** O sign-off departamental vigente
  resolve o item; não usar clique em `/alertas`, reconhecimento ou dispensa
  como resolução. A reconciliação deve fechar somente o item correspondente.
- [ ] **Step 4: Acoplar as mutações autoritativas.** ATD, resolução de seção,
  sign-off, fechamento e reabertura chamam a reconciliação server-side dentro
  do limite transacional apropriado; o cron continua sendo a rede de segurança.
- [ ] **Step 5: Cobrir casos de contrato.** Testar ATD sem seção resolvida,
  todas as seções resolvidas sem sign-off, sign-off parcial, reabertura,
  escala só de exportação, escala mista, POD ausente, escala omitida e
  reexecução idempotente.

### Task 4: consumir a migration 271 para o prazo vencido

**Arquivos:** migration/RPC nova de reconciliação; `271` somente como fonte
imutável de regra; testes SQL e de serviço.

- [ ] **Step 1: Reusar `agency_report_deadline_date`.** Não criar segunda
  função de calendário. A data inicial é o ATD real da escala unificada; o dia
  do ATD não conta, sábados/domingos não contam e feriados contam.
- [ ] **Step 2: Reusar a baseline.** Não retroagir a regra para ATDs anteriores
  à baseline `agency_report_deadline_missed`; sem ATD não criar item; `omitted`
  fica fora em definitivo.
- [ ] **Step 3: Abrir o item crítico independente.** Para cada departamento
  sem sign-off vigente após `deadline_date < CURRENT_DATE`, inserir/atualizar
  `agency_report_deadline_missed` no agregado já existente. Nunca criar alerta
  por relatório inteiro ou por pessoa.
- [ ] **Step 4: Resolver na assinatura departamental.** A RPC de sign-off deve
  reconciliar imediatamente o item de prazo correspondente. O fechamento do
  ADR conserva o update de segurança da 271, mas não é a fonte primária.
- [ ] **Step 5: Testar a fronteira temporal.** Cobrir ATD de sexta, prazo de
  quarta, data corrente igual ao vencimento (ainda não vencido se a regra exige
  `< CURRENT_DATE`), feriado contado, ATD lançado tardiamente, assinatura
  antes/depois do vencimento e reabertura posterior.

### Task 5: mover a detecção para server-only a cada 15 minutos

**Arquivos:** migration de agendamento/executor; Edge Function ou wrapper
server-only conforme o padrão da fundação #517; testes de contrato SQL e
verificação operacional.

- [ ] **Step 1: Extrair avaliadores internos.** Manter os RPCs autenticados
  compatíveis para chamadas autorizadas, mas compartilhar a avaliação com um
  runner não dependente de `auth.uid()`. O executor deve ser revogado para
  `PUBLIC`, `anon` e `authenticated` quando não houver autorização específica.
- [ ] **Step 2: Criar o caminho protegido.** Usar o mecanismo server-only da
  fundação, com segredo/allowlist e `search_path` controlado. O `pg_cron` não
  deve chamar diretamente `detect_agency_report_pending()` ou
  `detect_agency_report_deadline_missed()` enquanto essas funções exigirem
  sessão de usuário.
- [ ] **Step 3: Agendar a frequência.** Registrar exatamente um job de
  `*/15 * * * *` para a reconciliação dos dois itens, no mesmo fuso/contrato
  operacional da fundação. O job precisa ser seguro quando executado duas vezes.
- [ ] **Step 4: Remover a dependência da tela.** `Alertas.tsx` não será fonte de
  detecção. Durante rollout, a chamada de mount pode permanecer apenas como
  compatibilidade temporária se não duplicar notificações; o alvo final é
  leitura da fila, não produção de fatos.
- [ ] **Step 5: Verificar banco descartável.** Reproduzir job, grants, RLS,
  baseline, escala omitida e dedupe no banco local descartável do workflow;
  registrar o resultado como teste de contrato SQL, não como runtime de
  produção.

### Task 6: implementar fan-out e audiência de Notificação Interna

**Arquivos:** schema/RPC da fundação #517; catálogo de destinatários; testes RLS
e de fan-out.

- [ ] **Step 1: Entregar uma linha por usuário ativo.** Para cada item ativo,
  resolver o departamento do item e criar uma entrega por usuário interno ativo
  daquele departamento. Usuários inativos, Financeiro e duplicatas ficam fora.
- [ ] **Step 2: Congelar o evento.** Persistir tipo, título, mensagem, entidade e
  data do evento na Notificação; leitura individual nunca muda o Alerta.
- [ ] **Step 3: Deduplicar abertura/reabertura.** Uma atualização do item já
  ativo não envia novamente. Reabrir depois de resolvido gera uma nova entrega
  do novo evento, preservando entregas anteriores.
- [ ] **Step 4: Testar isolamento.** Provar que Documentação não recebe item de
  Equipamentos, que usuários inativos não recebem, que Financeiro não recebe e
  que marcar como lida não altera a fila coletiva.

### Task 7: corrigir destino e superfície da fila

**Arquivos:** módulo compartilhado de roteamento; `src/services/alerts.ts`;
`src/pages/Alertas.tsx`; testes de rota e comportamento.

- [ ] **Step 1: Extrair o roteador.** Retirar `alertEntityLink` da página e
  compartilhar a mesma função com o sino. Para `agency_departure_report`,
  validar `voyageId::PORTO` e retornar
  `/viagens/:voyageId?tab=adr&escala=PORTO`.
- [ ] **Step 2: Rotular o agregado.** Exibir “ADR” e a escala/departamento na
  apresentação; nunca mostrar `::departamento` como se fosse entidade.
- [ ] **Step 3: Remover o contrato morto.** Alinhar filtros e ações da fila à
  fundação: não introduzir reconhecimento, fechamento manual de item derivado
  ou rótulo principal de seção legada.
- [ ] **Step 4: Preservar deep-link.** Testar `Viagens.tsx` lendo `tab=adr` e
  `escala=PORTO`, inclusive quando a escala é somente exportação elegível.

### Task 8: alinhar o serviço do ADR e prevenir regressão de domínio

**Arquivos:** `src/services/agencyDepartureReport.ts`,
`src/hooks/useAgencyReport.ts`, `VoyageAgencyReportTab.tsx` e testes focados.

- [ ] **Step 1: Alinhar donos/rótulos.** Fazer `carga_carregada` seguir a função
  SQL vigente e as ADRs: Documentação e “Carga carregada”; Granito permanece
  conteúdo, não nome da seção.
- [ ] **Step 2: Preservar seis seções.** Não reintroduzir `operacao_patio` ou
  `ocorrencias` como seção assinável. A subseção de pátio continua dentro de
  `vazios_embarcados`.
- [ ] **Step 3: Invalidar consultas após origem.** Mutations de seção,
  departamento, fechamento e reabertura devem atualizar ADR, eventos,
  Alertas, contadores e dashboard sem produzir alerta no browser.
- [ ] **Step 4: Testar o contrato da aba.** Verificar estados vazio/pending,
  `Confirmado`/`Nada a declarar`, justificativa, histórico, três sign-offs,
  fechamento 3/3 e deep-link para o porto correto.

### Task 9: rollout, regressões e aceite

**Arquivos:** testes, documentação viva e relatório de verificação; nenhum
arquivo histórico deve ser editado.

- [ ] **Step 1: Executar testes de contrato SQL.** Validar agregação, backfill,
  baselines, grants, RLS, dedupe, fechamento/reabertura e cron.
- [ ] **Step 2: Executar testes de serviço/UI.** Rodar os testes focados de
  alertas, ADR, deep-link e tela `/alertas`; esperar que nenhum teste dependa
  do mount como produtor.
- [ ] **Step 3: Regressão funcional.** Exercitar escala de importação, somente
  exportação, mista, POD/POL divergente, sem ATD, ATD anterior à baseline,
  omitida, seis seções, três departamentos, deadline vencido e reaberturas.
- [ ] **Step 4: Rodar gates do repositório.** Executar:
  `npm run docs:check`, `git diff --check`, `npm run typecheck`, `npm run lint`,
  `npm test` e `npm run build`. Esperar todos com exit code 0; registrar falhas
  sem declarar implementação concluída.
- [ ] **Step 5: Validar rollout.** Aplicar migrations em banco descartável,
  conferir jobs/grants/RLS no ambiente controlado e só então publicar a ordem
  #517 → #524. A publicação da SPA depende das migrations correspondentes.
- [ ] **Step 6: Encerrar o ciclo documental.** Depois que a última task de
  implementação estiver mergeada e verificada, mover esta spec para
  `docs/archive/specs/`, este plano para `docs/archive/plans/` e remover a linha
  do índice de planos no mesmo change.

## Critérios de aceite do plano

- O contrato atende `524-AC-01` a `524-AC-10` da spec.
- Nenhuma migration histórica é editada.
- `271` continua sendo a fonte do detector de prazo.
- Não existe produtor de `agency_report_section_pending`.
- Não há alerta por seção, por pessoa, por Financeiro ou por Demurrage.
- O detector server-side roda independentemente de `/alertas`, com frequência
  de 15 minutos e deduplicação idempotente.
- Toda ação de alerta/notificação ADR abre a aba ADR da escala correta.
