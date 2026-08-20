# Bloco 6 — Transversal e Portal do Cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** entregar as superfícies transversais de Alertas e Notificações
Internas — sino interno, fila `/alertas` completa, resumo do `/painel`,
observabilidade de falha de roteamento e o Eco de Tratamento —, e registrar como
contrato verificável as telas que não produzem evento, incluindo as oito telas do
Portal do Cliente.

**Architecture:** a fundação (migrations `317`–`321`, PR
[#568](https://github.com/luccafwlog/transhippingdesk/pull/568)) já entrega
catálogo, agregado, itens, histórico, dispensa, fan-out com fallback e registro
de falha. Os Blocos 1–5 entregam os produtores. O Bloco 6 **não cria produtor de
pendência**: ele consome a fila, constrói o sino que a fundação deixou sem UI,
agrega o resumo por departamento, torna visível a falha de roteamento e fecha a
única lacuna de evento transversal — o Eco de Tratamento sobre a dispensa.

**Tech Stack:** React/TypeScript, Supabase PostgreSQL/RPCs, TanStack Query,
Vitest e testes de contrato SQL.

**Spec:** [`2026-08-20-bloco-525-transversal-portal-design.md`](../spec/2026-08-20-bloco-525-transversal-portal-design.md)
**Issue:** [#525](https://github.com/luccafwlog/transhippingdesk/issues/525)
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)

## Dependências e bloqueio explícito

- **Bloqueio de sequência:** este bloco é executado **depois** da PR de
  integração dos Blocos 1–5, conforme o §2 da #519, passo 11. Ele consome os
  rótulos, `entity_type` e destinos que aqueles blocos registram; implementá-lo
  antes exigiria adivinhar o conjunto final.
- **Roteador compartilhado:** a extração de `alertEntityLink` para módulo
  compartilhado é entrega declarada do **Bloco 5** (plano do #524, Task 7,
  Step 1). Este plano **consome e completa** esse módulo. Se, na integração, a
  extração não tiver acontecido, a Task 3 a executa — mas nunca cria um segundo
  roteador ao lado do da fila.
- **Prefixo de migration:** conferir o próximo prefixo livre no branch integrado.
  Hoje `322` é o último em `main`; as PRs
  [#570](https://github.com/luccafwlog/transhippingdesk/pull/570) e
  [#571](https://github.com/luccafwlog/transhippingdesk/pull/571) já reservam
  `323` e `324`.
- **Migrations históricas imutáveis:** `317`–`322` não são editadas. Toda
  alteração de RPC ou constraint entra em migration nova, com `CREATE OR REPLACE`
  ou `ALTER`.
- **Sem reabertura de contrato:** nada em §3, §4, §5, §6 ou §7 da #519 é
  redefinido. Nenhuma gravidade muda, nenhuma audiência é ampliada, o Financeiro
  continua fora e `alerts.assigned_to` continua sem uso.

## Mapa de arquivos

- **Schema/RPCs:** migrations novas para o evento `dismissed` e o Eco, a
  paginação e a contagem de Notificações Internas, a projeção de motivo/autor da
  dispensa, a ordenação por gravidade e o agregado por departamento.
- **Serviço:** `src/services/alerts.ts` — hoje o único cliente das RPCs da
  fundação (`listAlerts`, `countAlertQueue`, `dismissAlertItem`,
  `listInternalNotifications`, `markInternalNotificationRead`).
- **Roteador:** o módulo compartilhado de destino extraído pelo Bloco 5 a partir
  de `src/pages/Alertas.tsx:185-212`.
- **Sino:** componente novo, montado no cabeçalho de
  `src/components/layout/AppLayout.tsx`, com hook próprio de consulta.
- **Fila:** `src/pages/Alertas.tsx` — rótulos, filtro por departamento,
  ordenação, formulário de dispensa.
- **Painel:** `src/pages/Painel.tsx` e o hook do resumo.
- **Admin:** `src/pages/AdminUsuarios.tsx` (`AdminTab` em `:29`) e
  `src/services/adminObservability.ts`.
- **Contadores:** `src/hooks/useOperationalCounts.ts` e
  `src/components/layout/AppLayout.tsx:54`.
- **Testes:** testes de contrato SQL das migrations novas;
  `src/pages/__tests__/Alertas.behavior.test.tsx`, testes novos do sino, do
  resumo do painel, da aba de falhas e os testes de contrato negativo das telas
  sem evento.

## Tarefas

### Task 1: Eco de Tratamento — evento de dispensa e fan-out

**Arquivos:** migration nova; testes de contrato SQL.

- [ ] **Step 1: Escrever o teste SQL antes.** Cobrir: dispensa com três
  destinatários entrega dois Ecos; o autor nunca recebe; destinatário de fallback
  recebe e continua marcado como fallback; item permanece `active` e a dispensa
  permanece vigente; reexecutar o fan-out do mesmo evento não duplica entrega;
  duas dispensas da mesma ocorrência geram dois eventos e dois Ecos; item com um
  único destinatário que é o próprio autor não entrega nada e **não** grava falha
  de roteamento.
- [ ] **Step 2: Ampliar `alert_item_events`.** Em migration nova, substituir o
  CHECK de `event_type` para aceitar `'dismissed'` além de `opened`, `updated` e
  `resolved`. `new_status` continua `'active'`: dispensar não muda o estado do
  item. Não editar a migration `318`.
- [ ] **Step 3: Emitir o evento dentro de `dismiss_alert_item`.** `CREATE OR
  REPLACE` da função da `318`, preservando as validações existentes de motivo
  obrigatório e revisão futura. Inserir o evento `dismissed` com
  `occurrence_id` do item, `actor_id = auth.uid()` e metadados com motivo e
  `review_at`, na **mesma transação** da dispensa.
- [ ] **Step 4: Entregar o Eco.** Fan-out para os destinatários distintos que já
  receberam Notificação Interna dos eventos da **ocorrência corrente** daquele
  `alert_item`, excluindo `auth.uid()`. Preservar `is_fallback` e
  `recipient_department` de cada destinatário. Gravidade **normal**, sempre,
  inclusive quando o item é crítico. Título e mensagem devem dizer que a
  pendência foi dispensada, por quem e até quando.
- [ ] **Step 5: Marcar a entrega como Eco.** Não registrar o Eco em
  `alert_type_catalog` — `alert_items.item_type` tem chave estrangeira para o
  catálogo, e o Eco nunca pode virar item. Carregar o `item_type` do item
  dispensado, que é texto livre em `internal_notifications`, e marcar a entrega
  como Eco no `payload`, para que o sino a distinga da notificação de abertura do
  mesmo item.
- [ ] **Step 6: Não gravar falha de roteamento.** Zero destinatários no Eco é o
  caso normal de um único destinatário; não inserir em
  `alert_notification_failures`. Essa tabela continua reservada ao fan-out de
  abertura/reabertura.
- [ ] **Step 7: Rodar o teste SQL focado** em banco descartável e registrar o
  resultado como **Teste de contrato SQL**, não como runtime de produção.

### Task 2: paginação, contagem e projeção das RPCs de leitura

**Arquivos:** migration nova; `src/services/alerts.ts`; testes SQL e de serviço.

- [ ] **Step 1: Paginar `list_internal_notifications`.** `CREATE OR REPLACE` com
  `p_limit` (padrão alinhado ao Portal, que usa 20 em
  `src/services/portalBilling.ts:172`) e cursor por `created_at`/`id`. A função
  hoje não tem `LIMIT` algum e é candidata a chamada em todo render do layout.
- [ ] **Step 2: Criar a contagem de não lidas.** RPC de contagem para o badge do
  sino, sem baixar linhas, no mesmo padrão de `count_alert_queue`. Grants:
  revogar de `PUBLIC`/`anon`, conceder a `authenticated`, exigir usuário interno
  ativo.
- [ ] **Step 3: Criar a baixa em massa.** `mark_internal_notification_read` só
  aceita um id por chamada. Com a lista paginada, um laço no cliente zera no
  máximo a página carregada e deixa badge diferente de zero. Criar RPC de baixa em
  massa escopada a `recipient_id = auth.uid()`, com os mesmos grants e a mesma
  exigência de usuário interno ativo, no padrão de
  `portal_mark_all_notifications_read`. Testar com mais de uma página.
- [ ] **Step 4: Filtrar a fila por departamento no servidor.** `list_alert_queue`
  já aceita `p_entity_type`; acrescentar o departamento do mesmo jeito, aplicado
  **antes** do `LIMIT 200`. Filtrar no cliente operaria sobre a lista truncada e
  faria a fila discordar do resumo do `/painel`, que é agregado sem corte.
- [ ] **Step 5: Projetar motivo e autor da dispensa.** `list_alert_queue` hoje
  projeta apenas `dismissed_until`. Acrescentar motivo, autor e data/hora da
  dispensa vigente, sem alterar o `LIMIT 200` nem a união com o legado.
- [ ] **Step 6: Ordenar por gravidade.** Dentro de `list_alert_queue`, ordenar
  não dispensados antes de dispensados, **críticos antes de normais** e depois
  mais recentes primeiro. Preservar a visibilidade das linhas legadas sem item.
- [ ] **Step 7: Criar o agregado do `/painel`.** RPC de resumo que devolve, por
  departamento responsável, a contagem de itens **ativos não dispensados**, a
  contagem de dispensados em separado e um grupo próprio para linhas legadas sem
  departamento. A função **não** usa `list_alert_queue` e não sofre o corte de
  200 linhas.
- [ ] **Step 8: Estender o serviço.** Acrescentar as funções correspondentes em
  `src/services/alerts.ts`, mantendo o `alertsRpc` estreito já usado ali —
  `src/types/database.ts` é protegido e não é regenerado por este bloco.
- [ ] **Step 9: Testar.** Teste SQL de limite/cursor, de contagem, de baixa em
  massa com duas páginas, de filtro por departamento com mais de 200 itens, de ordenação
  com crítico antigo × normal recente × dispensado, e do agregado com mais de 200
  itens ativos provando divergência zero contra a fila.

### Task 3: roteador de destino compartilhado e completo

**Arquivos:** módulo compartilhado de destino; `src/pages/Alertas.tsx`; testes de
roteamento.

- [ ] **Step 1: Consumir a extração do Bloco 5.** Se o módulo compartilhado já
  existir após a integração, usá-lo. Se não existir, extraí-lo de
  `src/pages/Alertas.tsx:185-212` **uma vez**, sem criar um segundo mapa de rotas.
- [ ] **Step 2: Cobrir os `entity_type` faltantes.** Acrescentar `customer` — os
  alertas de Portal usam essa entidade desde a migration `196` e hoje só têm
  destino quando o tipo começa com `portal_` — e os `entity_type` que os Blocos 2
  e 4 registrarem, incluindo `voyage_pod_schedule` e `voyage_escala_terminal`.
  Preservar os parâmetros terminalizados `escala`, `terminal` e `report` da §4.
- [ ] **Step 3: Rebaixar `destination` a fallback.** O deep link exibido vem do
  roteador; `destination` só é usado quando o roteador devolve nulo. Uma linha
  congelada com destino antigo nunca sobrepõe o roteador atual.
- [ ] **Step 4: Não gravar rota nova em SQL.** Nenhuma migration deste bloco
  acrescenta parâmetro, chave composta ou query string a
  `alert_type_catalog.default_destination`.
- [ ] **Step 5: Testar uma vez para os dois consumidores.** O mesmo teste de
  roteamento é exercitado pela fila e pelo sino; cobrir dois terminais no mesmo
  porto, chave legada, entidade de cliente e entidade sem rota derivável.

### Task 4: sino interno

**Arquivos:** componente e hook novos; `src/components/layout/AppLayout.tsx`;
testes de UI e de contrato.

- [ ] **Step 1: Criar o hook de consulta.** Seguir o padrão de React Query do
  repositório: chave própria, `staleTime` compatível com o dos demais indicadores
  do layout e invalidação após marcar como lida. Usar a contagem de não lidas para
  o badge e a lista paginada só quando o sino abre.
- [ ] **Step 2: Montar no cabeçalho do `AppLayout`.** Por consequência, o sino não
  existe em `/login`, `/line-up-tv/display`, nas telas do Portal nem na inspeção
  de Portal — todas fora do `AppLayout` (`src/App.tsx:152-170`).
- [ ] **Step 3: Exibir a Cópia Congelada.** Rótulo do tipo, mensagem, entidade,
  data e link pelo roteador compartilhado. A gravidade vem de
  `internal_notifications.severity`, **não** de uma releitura do catálogo: o Eco
  é normal mesmo carregando o `item_type` de um item crítico, e um aviso já
  entregue não pode ser reescrito por mudança futura de catálogo. Não reconsultar
  o estado atual da entidade para reescrever a mensagem.
- [ ] **Step 4: Distinguir o Eco.** Uma entrega marcada como Eco de Tratamento é
  apresentada como "pendência dispensada por fulano até tal data", nunca como
  pendência nova. Ela não oferece ação e não reaparece como item a tratar.
- [ ] **Step 5: Identificar a entrega por fallback.** Quando `is_fallback` for
  verdadeiro, deixar explícito que a entrega veio pelo fallback de Administrativo
  e que o departamento responsável pelo tratamento não mudou.
- [ ] **Step 6: Ler sem tratar.** Marcar uma como lida e marcar todas como lidas,
  esta pela RPC de baixa em massa da Task 2 — nunca por laço sobre a página
  carregada.
  Nenhuma das duas ações pode tocar `alerts`, `alert_items` ou
  `alert_item_dismissals`. O sino **não** oferece dispensar, resolver, reconhecer
  ou fechar.
- [ ] **Step 7: Testar.** Ler não altera a fila nem o badge de `/alertas`; o
  contador cai só para quem leu; RLS impede ler linha de outro destinatário; o
  sino não renderiza fora do `AppLayout`.

### Task 5: fila `/alertas` completa

**Arquivos:** `src/pages/Alertas.tsx`; testes de comportamento e de contrato.

- [ ] **Step 1: Completar os rótulos de tipo.** `TYPE_LABELS`
  (`src/pages/Alertas.tsx:12-30`) cobre 16 tipos e deixa **12 tipos catalogados
  sem rótulo**: os cinco `review_*`, `pix_unreconciled`, `portal_dispute_opened` e
  os cinco `voyage_*`. Preencher todos e preservar os rótulos legados de
  `portal_invoice_created`, `portal_consolidation_obsoleted` e `demurrage`, que
  são carriers históricos fora do catálogo.
- [ ] **Step 2: Adicionar o teste de contrato do catálogo.** Um teste que falhe
  quando um tipo ativo do `alert_type_catalog` não tiver rótulo. É essa guarda que
  impede a fila de voltar a exibir identificador cru quando um bloco futuro
  registrar um tipo.
- [ ] **Step 3: Completar os rótulos de entidade.** `ENTITY_TYPE_LABELS`
  (`:31-37`) precisa de `customer` e dos `entity_type` novos dos Blocos 2 e 4.
- [ ] **Step 4: Substituir os `window.prompt`.** `requestDismissal` (`:70-85`) usa
  dois prompts encadeados. Trocar por formulário com motivo obrigatório e
  data/hora futura de revisão validada antes do envio, mantendo a mesma validação
  server-side da ADR 0053.
- [ ] **Step 5: Exibir a dispensa por inteiro.** Motivo, autor e revisão na linha
  dispensada, consumindo a projeção da Task 2. A ADR 0053 exige os quatro dados; a
  fila mostra hoje apenas a data.
- [ ] **Step 6: Filtrar por departamento.** Consumir o parâmetro server-side da
  Task 2, Step 4 — não filtrar o resultado no cliente — e aceitar o departamento
  vindo do atalho do `/painel`.
- [ ] **Step 7: Preservar as guardas.** Nenhum caminho de reconhecer ou fechar.
  `acknowledgeAlert` e `closeAlert` (`src/services/alerts.ts:75-84`) continuam
  lançando e sem chamador de UI.

### Task 6: resumo do `/painel`

**Arquivos:** `src/pages/Painel.tsx`; hook do resumo; testes.

- [ ] **Step 1: Consumir o agregado dedicado.** Usar a RPC da Task 2, nunca
  derivar do `listAlerts`, que é cortado em 200 linhas.
- [ ] **Step 2: Renderizar indicador e atalho.** Cartão com a contagem por
  departamento, dispensados exibidos **separadamente** e o grupo legado sem
  departamento identificado como tal. Cada grupo leva a `/alertas` já filtrado.
- [ ] **Step 3: Não produzir evento.** O resumo não notifica, não marca nada como
  lido, não dispensa e não oferece ação sobre a pendência (§6, decisão 3).
- [ ] **Step 4: Não competir com o Line Up.** Seguir o padrão já usado em
  `useOperationalCounts.ts:22-28`, que adia os indicadores não críticos para
  depois da primeira pintura da rota.
- [ ] **Step 5: Testar coerência.** A soma dos grupos ativos do resumo é igual à
  contagem de `count_alert_queue('active')`; com mais de 200 itens ativos, o
  resumo continua correto e a fila continua cortada.

### Task 7: falha de roteamento em `/admin/usuarios`

**Arquivos:** `src/pages/AdminUsuarios.tsx`; `src/services/adminObservability.ts`;
testes.

- [ ] **Step 1: Acrescentar a aba.** Nova aba em `AdminTab`
  (`src/pages/AdminUsuarios.tsx:29`), ao lado de `usuários`, `logs`, `métricas` e
  `prazo-adr`, com carregamento sob demanda como as demais.
- [ ] **Step 2: Listar as falhas.** Ler `alert_notification_failures` — tipo do
  item, departamento esperado, motivo, data e link para o Alerta correspondente
  pelo roteador compartilhado. Somente leitura; a tabela já é gravável apenas pelo
  servidor (`318:112-120`).
- [ ] **Step 3: Tornar a audiência legível.** Na aba de usuários, deixar visível
  quais papéis são audiência de alguma regra do catálogo. Os papéis são `admin`,
  `operator`, `administrativo`, `financeiro`, `operacoes`, `documentacao` e
  `equipamentos` (`src/types/database.ts:5759-5766`), e o catálogo só usa
  `documentacao`, `equipamentos` e `operacoes` como audiência — `administrativo` e
  `admin` entram somente pelo fallback crítico.
- [ ] **Step 4: Não criar atribuição individual.** Nada nesta aba grava
  `alerts.assigned_to` nem associa pendência a pessoa (§6, decisão 7).
- [ ] **Step 5: Testar.** Renderização da aba, leitura permitida a usuário interno
  ativo, escrita pelo cliente negada, e teste de contrato entre papéis, audiências
  do catálogo e fallback.

### Task 8: contratos negativos das telas sem evento

**Arquivos:** testes novos; nenhum arquivo de produção precisa mudar.

- [ ] **Step 1: `/perfil`.** Teste de contrato negativo provando que
  `src/pages/Profile.tsx` não chama produtor de alerta ou notificação.
- [ ] **Step 2: `/line-up-tv/display`.** Provar que a tela não produz evento e que
  o sino não renderiza nela — ela está fora do `AppLayout` (`src/App.tsx:158`).
- [ ] **Step 3: `/login`.** Provar que `src/pages/Login.tsx` não registra
  tentativa, contador ou bloqueio, e registrar em comentário/teste que a
  assimetria com `portal_abuso_login` é a decisão 4 da §6, não um esquecimento.
- [ ] **Step 4: Fronteira do Portal.** Teste provando que o escopo do Portal
  (`src/services/portalScope.ts`) não alcança `list_alert_queue`,
  `count_alert_queue`, `list_internal_notifications`,
  `mark_internal_notification_read`, `dismiss_alert_item`, `upsert_alert_item`
  nem `resolve_alert_item`, e que nenhuma projeção do Portal expõe item interno,
  departamento, motivo ou autor de dispensa.
- [ ] **Step 5: Não duplicar produtor.** Conferir que as oito telas do Portal
  continuam sendo apenas origem dos eventos já contratados pelos Blocos 2 e 3, sem
  produtor novo (§3.5: todo produtor é único por tipo de evento).

### Task 9: rollout, regressões e aceite

**Arquivos:** testes, documentação viva e registro de verificação.

- [ ] **Step 1: Testes de contrato SQL.** Evento `dismissed`, Eco e sua
  idempotência, paginação, contagem, projeção da dispensa, ordenação por
  gravidade, agregado por departamento, grants e RLS.
- [ ] **Step 2: Testes de serviço e UI.** Sino, fila, resumo do painel, aba de
  falhas e os contratos negativos da Task 8.
- [ ] **Step 3: Regressão funcional.** Exercitar item crítico com e sem
  destinatário, fallback de Administrativo, ausência total de destinatários,
  dispensa por dois usuários diferentes, revisão vencida com condição persistente,
  linha legada sem item, fila com mais de 200 itens e usuário com papel fora de
  toda audiência.
- [ ] **Step 4: Gates do repositório.** Executar `npm run docs:check`,
  `git diff --check`, `npm run typecheck`, `npm run lint`, `npm test` e
  `npm run build`. Esperar exit code 0 em todos; registrar falhas sem declarar
  implementação concluída.
- [ ] **Step 5: Rollout.** Aplicar as migrations em banco descartável, conferir
  grants e RLS, e publicar depois da PR de integração dos Blocos 1–5. A publicação
  da SPA depende das migrations correspondentes.
- [ ] **Step 6: Encerrar o ciclo documental.** Com a última task mergeada e
  verificada, mover esta spec para `docs/archive/specs/`, este plano para
  `docs/archive/plans/` e remover a linha do índice de planos **no mesmo change**,
  conforme `docs/CONVENCOES.md`. Registrar a entrega no `docs/CHANGELOG.md` e o
  fechamento do bloco na #519.

## Critérios de aceite do plano

- O contrato atende `525-AC-01` a `525-AC-16` da spec.
- Nenhuma migration histórica é editada; `317`–`322` permanecem intactas.
- Nenhum produtor de pendência operacional é criado, movido ou duplicado.
- Nenhuma gravidade de tipo existente muda. A fila lê severidade do
  `alert_type_catalog`; o sino lê a severidade congelada da entrega.
- O Eco de Tratamento é a única Notificação Interna nova, é sempre normal, nunca
  vai ao autor e nunca cria Alerta, item ou reabertura.
- Existe **um** roteador de destino, consumido pela fila e pelo sino;
  `destination` é fallback declaradamente inferior a ele.
- O resumo do `/painel` não deriva da fila paginada e não produz notificação.
- `alerts.assigned_to` e `alerts.notified_at` continuam sem uso.
- O Financeiro continua fora da audiência e o cliente continua sem acesso à fila
  interna.
