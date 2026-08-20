# Alertas e notificações — catálogo decidido

**Status:** TODO
**Origem:** auditoria de alertas e notificações conduzida em 2026-08-11, decidida
caso a caso com o responsável do produto.
**Última sincronização:** 2026-08-20.

Este plano consolida as decisões. Ele não descreve o que existe hoje como se
fosse alvo: cada item diz o estado atual e a mudança acordada.

## Nota de sincronização — 2026-08-20

Este plano foi escrito em 11/08, antes do grilling de 17–18/08 e antes das cinco
specs de bloco. As decisões tomadas depois dele mudaram parte do que estava
escrito aqui. Esta revisão traz o plano de volta ao contrato vigente, registrado
na [#519, §3](https://github.com/luccafwlog/transhippingdesk/issues/519).

O que mudou nesta sincronização:

| Ponto | Antes (11/08) | Agora |
|---|---|---|
| Ação manual sobre o alerta | reconhecimento implícito da ADR 0034 | **dispensa temporária** (ADR 0053); reconhecimento não existe mais |
| Fechamento | automático onde verificável, **manual** onde exige julgamento | sempre automático, pela recomputação da origem |
| Bloco 0 | E1, E2, E3 | E1, E2, E3 e **E4 — dispensa** |
| Gravidade por evento | não decidida ("continua sendo só do Portal") | **catálogo completo** consolidado no E1 |
| B1 | `portal_email_suprimido` vira crítico | **revertido**: permanece normal (spec do #521, §8.1) |
| Portal na Revisão | remover `groupNeedsPortal` (migration 188) | **manter**: Portal volta a ser motivo canônico (ADR 0054) |
| Escalonamento por tempo | "o único com relógio próprio é o prazo do ADR" | prazo do ADR **e** os detectores D−7/D−5 do #523 abrem por data-limite |
| Blocos | 0, A, B, C, D | mapeados para as issues #520–#525, incluindo o #523, que não tinha lugar |

Nada foi decidido nesta revisão. Ela apenas transcreve decisões já registradas
nas ADRs 0053 e 0054 e nas specs dos Blocos #520–#524.

## Princípio adotado

Um estado só vira **pendência na fila** quando tem os três: ação clara,
responsável claro e momento objetivo de encerrar. Estado sem ação vira registro
histórico, não item de fila. Fila que acumula evento normal ensina a equipe a
ignorar a fila inteira — foi o critério que decidiu os casos abaixo.

Todo fechamento é automático e vem da recomputação da origem no servidor (saldo
zerou, assinatura existe, endereço mudou). Onde encerrar pareceria exigir
julgamento, a condição de origem precisa ser modelada como um fato verificável —
o registro da análise, a providência tomada — e não como um botão de fechar. A
única ação manual transversal é a dispensa temporária do E4, que **não** encerra
nada.

## Mapa de blocos — letra e issue

Este plano organiza o catálogo por letra; o épico executa por issue. As duas
taxonomias não coincidem, e é por isso que a tabela abaixo existe.

| Aqui | Onde é implementado | Issue |
|---|---|---|
| Bloco 0 — E1, E2, E3, E4 | fundação transversal | — |
| A1 — B/L aguardando revisão | Bloco 1 | [#520](https://github.com/luccafwlog/transhippingdesk/issues/520) |
| A2 — taxa não calculada | Bloco 3 | [#522](https://github.com/luccafwlog/transhippingdesk/issues/522) |
| A3 — cliente sem e-mail | Blocos 1 e 2 | [#520](https://github.com/luccafwlog/transhippingdesk/issues/520) · [#521](https://github.com/luccafwlog/transhippingdesk/issues/521) |
| A4 — divergência Baplie | Bloco 4 | [#523](https://github.com/luccafwlog/transhippingdesk/issues/523) |
| A5 — conciliação de cliente | não promovido | — |
| Bloco B — Portal | Bloco 2 | [#521](https://github.com/luccafwlog/transhippingdesk/issues/521) |
| Bloco C — Financeiro | Bloco 3 | [#522](https://github.com/luccafwlog/transhippingdesk/issues/522) |
| Bloco D — Relatório de Agência | Bloco 5 | [#524](https://github.com/luccafwlog/transhippingdesk/issues/524) |
| — | Bloco 6 — transversal e Portal do Cliente | [#525](https://github.com/luccafwlog/transhippingdesk/issues/525) |

O Bloco 4 (#523) não tem letra correspondente aqui: este catálogo previu apenas
a divergência Baplie (A4), e a spec do bloco cobre também BL esperado, Baplie
ausente, CE Mercante, cadeia de datas da escala e exportação pós-ATD. O #523 é o
maior conjunto de produtores do épico e sua fonte canônica é
[`../spec/2026-08-16-bloco-4-operacao-viagem-alertas-design.md`](../spec/2026-08-16-bloco-4-operacao-viagem-alertas-design.md),
não este plano.

## Critérios de decisão por evento

Todo evento candidato responde às sete perguntas abaixo. Nenhuma pode ficar em
branco: resposta ausente vira decisão por omissão na implementação. A lista é a
mesma da [#519, §3.3](https://github.com/luccafwlog/transhippingdesk/issues/519).

1. **Alerta, notificação ou ambos?** Alerta é item na fila `/alertas`, que espera
   ser tratado. Notificação é aviso ativo (sino), que interrompe. São coisas
   diferentes e um evento pode ser só uma delas — ou nenhuma.
2. **Departamento ou global?** A audiência do item de pendência é declarada
   numa regra central por tipo. Existe um único Alerta agregado por entidade,
   global para consulta; a Notificação Interna é entregue individualmente aos
   usuários dos departamentos que ainda têm itens ativos. `alerts.assigned_to`
   permanece sem uso, conforme o ADR 0034, até existir uma necessidade real de
   atribuição individual.
3. **Como fecha — e reabre?** Cada item fecha automaticamente por condição
   verificável, recomputada no servidor. O alerta agregado fecha somente quando
   não houver item interno ativo. Se uma condição voltar, o mesmo agregado é
   reaberto com a lista atual e o histórico preservado. **Não existe fechamento
   manual nem reconhecimento** (ADR 0053).
4. **Qual é a unidade?** A unidade do alerta é sempre uma entidade — B/L,
   cliente, viagem, escala, terminal, fatura ou transação. Cada condição é um
   item de pendência dentro desse agregado; não se criam centenas de alertas
   para a mesma entidade.
5. **Gravidade — crítico ou normal?** Decidida por evento e registrada no
   catálogo central do E1, abaixo. Nenhum evento entra sem gravidade declarada.
6. **Detecção — trigger ou cron?** Instantânea no banco, ou varredura agendada e
   com qual frequência. Não é detalhe de implementação: sem detecção
   independente da tela, o fato não existe enquanto ninguém olha — é o problema
   que o item E2 corrige.
7. **Dispensa, auditoria e retenção?** Como o item se comporta sob a dispensa
   temporária do E4, que rastro a ação deixa e por quanto tempo a Notificação
   Interna correspondente é preservada.

Duas regras valem para todos e não são debatidas caso a caso:

- **Destino.** Toda pendência aponta para a tela onde a ação acontece. Pendência
  sem destino é beco sem saída.
- **Sem escalonamento por tempo.** Nenhum item existente muda de gravidade por
  envelhecer, e não há promoção genérica por idade. Isso não proíbe abertura por
  data-limite: o prazo do ADR (ATD + 3 dias úteis, migration 271) e os
  detectores D−7 e D−5 do Bloco 4 abrem itens já na gravidade que o catálogo
  declara. A distinção é entre *abrir num prazo objetivo* — permitido — e *piorar
  com o tempo* — proibido.

## Dependência externa

O item **A3 (cliente sem e-mail)** depende da correção implementada na PR
[#518](https://github.com/luccafwlog/transhippingdesk/pull/518), que faz o vínculo
automático somente por documento exato e preserva match por nome como sugestão.
O audit histórico está em
`docs/archive/audits/2026-08-11-vinculo-de-cliente-por-nome.md`.
A fila agrupa por CNPJ (`src/pages/revisaoHelpers.ts:45`); enquanto a importação
gravar `customer_id` a partir de match por nome, o agrupamento não é confiável —
dois B/Ls do mesmo cliente podem cair em grupos distintos, ou um grupo pode
juntar clientes diferentes. Não implementar A3 antes daquela correção.

## Bloco 0 — Estrutural

Estes quatro vêm primeiro: os demais dependem deles. E1 e E2 são independentes
do schema novo e podem ser implementados imediatamente. E3 e E4 compartilham o
mesmo desenho de agregado e itens e devem ser especificados juntos antes de
qualquer migration.

### E1 — Centralizar a lista de tipos críticos

A classificação de gravidade já existe, mas só no console de provisionamento, e
está **triplicada literalmente** em `196_portal_provisioning_console_read_model.sql:26`,
`197_portal_provisioning_console_fixes.sql:30` e
`198_portal_provisioning_queue_self_heal.sql:77`. A fila `/alertas` **não tem
nenhuma noção de gravidade** hoje — E1 não é só desduplicar, é introduzir o
conceito na fila.

Extrair para um ponto único e fazer console e fila consumirem a mesma definição,
de modo que nunca discordem sobre o que é grave. Fazer isso **antes** de E2 e do
Bloco 2.

As migrations 196, 197 e 198 são históricas e protegidas: a definição única entra
em **migration nova**, que redefine as funções do console; nenhum arquivo
existente é editado.

#### Catálogo de gravidade — consolidado

A lista abaixo reúne as decisões das cinco specs de bloco, que até esta revisão
viviam espalhadas. É a fonte que a definição única do E1 deve materializar.

| Evento / item | Gravidade | Bloco | Fonte |
|---|---|---|---|
| Revisão Manual do B/L (motivos canônicos agregados) | **Crítico** | 1 | spec #520, `520-AC-17` |
| `portal_pendencia_geral` | Normal | 2 | spec #521, §8.1 |
| `portal_convite_expirado` | Normal | 2 | spec #521, §8.1 |
| `portal_falha_envio` | Normal | 2 | spec #521, §8.1 |
| `portal_email_suprimido` | Normal | 2 | spec #521, §8.1 |
| `portal_abuso_login` | **Crítico** | 2 | spec #521, §8.1 |
| `portal_excecao_critica_fatura` | **Crítico** | 2 | spec #521, §8.1 |
| Cálculo bloqueado por pendência financeira real (A2) | **Crítico** | 3 | spec #522, §A2 |
| Falha de emissão automática | **Crítico** | 3 | spec #522 |
| Invoice vencida (`invoice_overdue`) | Normal | 3 | spec #522 |
| PIX sem conciliação segura | **Crítico** | 3 | spec #522 |
| Disputa de invoice Demurrage | Normal | 3 | spec #522 |
| BL esperado por POL/POD | **Crítico** | 4 | spec #523, matriz |
| Baplie ausente | **Crítico** | 4 | spec #523, matriz |
| Cobertura documental Baplie/BL | **Crítico** | 4 | spec #523, matriz |
| CE Mercante ausente | **Crítico** | 4 | spec #523, matriz |
| Cadeia de datas da escala (ETA→ATA→ETB→ETD) | Normal | 4 | spec #523, matriz |
| Datas do terminal (ATB→ATD) | Normal | 4 | spec #523, matriz |
| Exportação pós-ATD | Normal | 4 | spec #523, matriz |
| `agency_report_department_pending` | Normal | 5 | spec #524, §Audiência e gravidade |
| `agency_report_deadline_missed` | **Crítico** | 5 | spec #524, §Audiência e gravidade |

Duas consequências que a implementação precisa assumir explicitamente:

- A lista atual do console é
  `('portal_excecao_critica_fatura','portal_convite_expirado','portal_falha_envio','portal_abuso_login')`.
  O catálogo acima **retira** `portal_convite_expirado` e `portal_falha_envio`
  dos críticos. `has_critical_alert` muda de comportamento para contas que hoje
  aparecem sinalizadas por esses dois tipos; a mudança é intencional e precisa de
  teste de contrato.
- Os tipos do Bloco 2 passam a ser **chaves de item** dentro do alerta agregado do
  cliente, não linhas independentes de `alerts`. A gravidade é do item.

### E2 — Cron para os detectores que hoje dependem de alguém abrir a tela

`detect_agency_report_pending` e `detect_agency_report_deadline_missed` só rodam
no mount de `/alertas` (`src/pages/Alertas.tsx:54,57`). `detect_overdue_invoices`
tem **dois** pontos de disparo pelo browser, ambos em `src/services/alerts.ts:103`:
a abertura de `/taxas-locais` (`src/pages/TaxasLocais.tsx:108`) e a emissão no
detalhe da invoice (`src/components/billing/InvoiceDetailModal.tsx:246`). A rota
`/faturamento` é apenas redirect legado desde a PR #549 e não dispara nada.

Nenhum dos três tem agendamento — os `cron.schedule` existentes cobrem expiração
de convite, digest do Portal, pendências gerais do Portal e
`mark_overdue_invoices`, que é outra função.

Consequência atual: um prazo vencido não existe enquanto ninguém abre a tela, e
portanto não pode notificar. Agendar os três, seguindo o padrão do Portal, mas
sem chamar diretamente pelo `pg_cron` uma função que exige `auth.uid()`: a
implementação deve usar um wrapper server-only protegido ou uma invocação HTTP
autenticada. É pré-requisito de qualquer notificação por sino.

Há template pronto no repositório: `185_portal_daily_digest_schedule.sql` já faz
`cron.schedule` → `net.http_post` → Edge Function com bearer, que é exatamente o
caminho exigido.

A frequência padrão de reconciliação fixada pelas specs dos Blocos 2, 4 e 5 é de
**15 minutos**; detectores com data-limite própria (D−7, D−5, prazo do ADR) usam
a mesma varredura e decidem pela data, não pela cadência.

### E3 — Notificação Interna por destinatário, separada do Alerta

O ADR 0034 define que `alerts` é uma fila coletiva e que o sino precisa de uma
entidade separada, com uma linha por usuário destinatário e estado de leitura
individual. A audiência de cada tipo fica declarada num único registro de regras;
os produtores continuam apenas criando ou atualizando o alerta agregado e seus
itens de pendência.

- A nova Notificação Interna congela o evento no momento da entrega e mantém
  `read_at` por usuário.
- O fan-out resolve os papéis internos definidos para o tipo e cria uma entrega
  por usuário ativo, com deduplicação idempotente.
- Ler a Notificação Interna nunca reconhece nem fecha o Alerta coletivo.
- `alerts.assigned_to` e `alerts.notified_at` permanecem sem uso; não são
  sobrecarregados para representar departamento ou entrega pessoal.
- Sem usuário ativo no departamento responsável, item **crítico** cai para todos
  os usuários ativos de Administrativo, com a entrega identificada como fallback
  e auditada. Sem destinatário nem em Administrativo, o Alerta continua sendo
  criado, permanece na fila coletiva e a ausência é registrada como falha de
  configuração ([#519, §6](https://github.com/luccafwlog/transhippingdesk/issues/519),
  decisões 1 e 2).
- Não há backfill de Notificações Internas: o sino passa a receber eventos a
  partir do deploy.

### E4 — Dispensa temporária (ADR 0053)

A [ADR 0053](../adr/0053-ciclo-de-vida-alerta-dispensa-temporaria.md) supersede
parcialmente a ADR 0034: o estado e a ação de **reconhecer** deixam de existir, e
a única ação manual sobre um Alerta passa a ser a dispensa temporária. Este item
não constava do plano original e é dependência declarada dos cinco planos de
bloco — todos supõem que a fundação a forneça.

- A dispensa tira o item da fila prioritária. **Não** resolve a origem, **não**
  fecha o Alerta, **não** libera gate de faturamento e não é estado terminal.
- Exige motivo, autor, data/hora e **data futura de revisão**. Sem data padrão,
  sem dispensa indefinida, sem exceção por tipo — inclusive para itens críticos,
  como `agency_report_deadline_missed`.
- Na data de revisão, se a condição persistir, o item volta à fila ativa e nova
  Notificação Interna pode ser entregue; se a origem tiver sido resolvida, a
  recomputação fecha o Alerta.
- É representada como metadado/registro temporário ligado ao Alerta aberto, nunca
  como estado que possa ser confundido com resolução. A unidade e a unicidade do
  Alerta não mudam.
- A guarda é **server-side** e igual para todos os produtores. A UI pode separar
  fila ativa, dispensados e encerrados, mas não apaga histórico.

Trabalho de remoção que acompanha o E4: `acknowledgeAlert` segue ativo em
`src/services/alerts.ts:49` e `src/pages/Alertas.tsx:68`, e o CHECK de
`001_schema.sql:30` ainda admite `acknowledged`. O estado histórico é preservado;
o que sai são a ação, o controle na tela e qualquer caminho novo que o reintroduza.

### Contrato de schema — pendência aberta

Nenhum plano ou spec vivo contém DDL. E3 e E4 dependem de decisões de schema que
**ainda não foram escritas em lugar nenhum**: nome e colunas da Notificação
Interna, RLS por destinatário, forma da tabela de itens do agregado e forma do
registro de dispensa. `alerts` continua sendo a tabela achatada de
`001_schema.sql:24-35`, e migrar para agregado + itens exige backfill das linhas
vivas.

Antes de abrir a PR de implementação de E3/E4, escrever a spec de schema em
`docs/spec/`. É a única decisão de design ainda aberta no Bloco 0 — E1 e E2 não
esperam por ela.

### Regra transversal — um alerta agregado por entidade

Para cada entidade existe no máximo um alerta agregado, identificado pela chave
`(entity_type, entity_id)`, independentemente da quantidade de condições ou dos
departamentos envolvidos. Os valores canônicos de `entity_type`/`entity_id` —
incluindo a camada de terminal introduzida pela PR #550 — estão na tabela da
[#519, §4](https://github.com/luccafwlog/transhippingdesk/issues/519); porto não
identifica sozinho uma operação terminalizada. Cada condição ativa é um item de pendência persistido,
com origem, tipo, departamento, destino, estado, timestamps e histórico próprios.

- Um novo evento adiciona ou atualiza o item correspondente no mesmo agregado;
  não cria um segundo alerta para a entidade.
- Resolver um item remove somente aquele item da lista atual e do departamento
  que deixou de ter pendência; o histórico do item permanece consultável.
- O agregado só fecha quando todos os itens ativos estiverem resolvidos. Uma
  ocorrência futura reutiliza o mesmo registro agregado, atualizando a história.
- A audiência do sino é a união dos departamentos dos itens ainda ativos. Um
  departamento sem item ativo não recebe a Notificação Interna, mesmo que tenha
  participado de um item resolvido.
- A resolução vem sempre da origem, recomputada no servidor de forma idempotente.
  O browser não é fonte de verdade e não fecha Alerta derivado.

## Bloco A — Operacional

### A1 — B/L aguardando revisão → pendência + sino (Documentação)

Hoje é só um contador ao lado do menu Revisão. Vira pendência na fila com aviso,
fechando quando `review_status` sai de `pending_review`. O alerta é **crítico**.

Motivos canônicos para `bls`, conforme a spec do #520 §5, já com a
[ADR 0054](../adr/0054-portal-como-gate-de-faturamento.md):

- cliente não vinculado;
- cliente sem e-mail cadastrado/utilizável;
- **Conta de Portal não ativa, não vinculada ao Auth ou sem acesso utilizável**;
- peso de carga solta ausente (só `carga_solta`).

Os três primeiros da versão anterior vinham de `compute_bl_review_pendencies`
(`188_review_gate_remove_portal.sql:6`). A ADR 0054 restabelece o Portal como
gate de revisão/faturamento e devolve o quarto motivo. A migration 188 é
histórica e imutável: a restauração ocorre em **migration nova**, com a guarda
aplicada server-side na fronteira de `ready_for_billing`/emissão.

Para `granite_bls`, a condição vigente é `client_id IS NULL`, tratada no mesmo
alerta único, sem motivos de Portal ou de peso.

### A2 — Taxa não calculada → pendência + sino (Faturamento)

Hoje é contador no menu de Taxas Locais (`/taxas-locais`; `/faturamento` é só
redirect legado desde a PR #549). Vira pendência identificando o B/L e o
motivo da trava. É o único caso do catálogo que impede dinheiro de entrar; o
valor está em ver o acumulado do que não pode ser faturado. Gravidade
**crítica**.

`Aguardando CE` é estado normal e obrigatório, não falha: não chama produtor de
alerta ao entrar nem ao permanecer nesse estado.

### A3 — Cliente sem e-mail → uma pendência **por cliente**

Não por B/L. A ação é uma só (cadastrar o e-mail) e a fila já trata e-mail como
trava de nível cliente (`revisaoHelpers.ts:98`). A pendência cita quantos B/Ls
dependem dela e fecha quando o contato é cadastrado.

Responsável: Documentação. **Bloqueado pela dependência externa acima.**

### A4 — Divergência Baplie → pendência por viagem

Hoje só aparece dentro da aba de relatório da viagem. Vira pendência com
navio/viagem no texto. Gravidade **crítica**.

A trava de cobertura de rotas já existe e deve ser respeitada: na regra normal,
só criar pendência quando `reconcileBaplieWithManifest` retorna
`source === 'reconciled'` e `items.length > 0`. Nos estados `not_imported` e
`awaiting_route_coverage`, nada é criado — `hasCompleteBaplieRouteCoverage`
(`src/services/baplieReconciliation.ts:38`) exige que toda rota POL/POD do EDI
tenha ao menos um B/L importado.

Divergência aqui é só de **existência** (container no Baplie e em nenhum B/L, ou
o inverso). Flags físicas não geram divergência: o Baplie é soberano e
sobrescreve o B/L com auditoria.

O Bloco 4 (#523) amplia este item com o override de D−7 e com os demais
produtores de viagem; a fonte canônica daquele escopo é a spec do #523, não este
parágrafo.

### A5 — Conciliação de cliente → **não promover**

Permanece como aviso na ficha do cliente. É etapa obrigatória do fluxo: todo B/L
nasce pendente por definição e a contagem é por B/L, o que produziria centenas
de itens abertos por semana sem que nada esteja errado.

## Bloco B — Portal

Todos os cinco já existem e já gravam em `alerts`; um sexto tipo,
`portal_excecao_critica_fatura`, já é consumido pelo console e faltava neste
catálogo. As decisões são sobre gravidade e fechamento.

| Tipo | Produtor | Fecha sozinho hoje |
|---|---|---|
| `portal_pendencia_geral` | `portal_refresh_general_pendencies()` (190) | Sim |
| `portal_convite_expirado` | cron 15 min (`181_portal_invite_expiry.sql`) | Não |
| `portal_falha_envio` | `supabase/functions/portal-invite-send/index.ts:45` | Não |
| `portal_email_suprimido` | `supabase/functions/portal-email-webhook/index.ts:30` | Não |
| `portal_abuso_login` | `supabase/functions/portal-login/index.ts:45` | Não |
| `portal_excecao_critica_fatura` | trigger de invoice já `issued` (spec #521) | Não |

### B1 — Gravidade do Portal segue a spec do Bloco 2

**Decisão revista.** A versão de 11/08 deste plano propunha promover
`portal_email_suprimido` a crítico, por analogia com `portal_falha_envio`, que
estava na lista do console. A spec do #521 (§8.1), posterior e canônica, decidiu
diferente: os dois permanecem **normais**, e os únicos críticos do bloco são
`portal_abuso_login` e `portal_excecao_critica_fatura`.

O raciocínio original — falta de caminho de recuperação de senha — continua
válido como pendência, mas foi endereçado como **item do alerta agregado do
cliente** com fechamento próprio, não por promoção de gravidade. O catálogo do E1
acima é a fonte; este item deixa de ser uma mudança e passa a ser conformidade.

Consequência para o E1: a lista única nasce **diferente** da lista hoje
triplicada no console, que ainda inclui `portal_convite_expirado` e
`portal_falha_envio`.

### B2 — Fechamento por condição objetiva

- `portal_convite_expirado` → fecha quando um novo convite é enviado.
- `portal_email_suprimido` → fecha quando o endereço muda ou sai da supressão.
- `portal_falha_envio` → fecha quando uma tentativa de envio posterior é
  bem-sucedida para o endereço vigente.
- `portal_abuso_login` → fecha quando o departamento registra a análise e a
  providência tomada. O fim automático da janela de bloqueio **não** resolve o
  item.

**Decisão revista.** A versão de 11/08 mantinha `portal_falha_envio` e
`portal_abuso_login` como "fechamento manual, por decisão". A ADR 0053 aboliu o
fechamento manual: onde encerrar exigiria julgamento, o julgamento vira um fato
registrado — e é esse fato que a recomputação observa. O botão que resta é a
dispensa temporária do E4, que não encerra.

`portal_pendencia_geral` já fecha sozinho e é preventivo por decisão da
migration 188 — permanece fora dos críticos.

## Bloco C — Financeiro

### C1 — `portal_invoice_created` sai da fila

Avisa que o cliente montou uma consolidada no Portal (`038_portal_invoice_alert.sql:53`):
evento normal, bem-sucedido, sem ação, sem dono e sem fecho. Vira registro de
histórico. Mesmo critério de A5.

### C2 — `invoice_overdue` fecha ao quitar

Hoje fica aberto mesmo depois de a fatura ser paga (`168_overdue_invoice_alerts_ptbr_entity.sql:62`
cria com dedup, e nada fecha). Passa a fechar quando o saldo zera, seguindo o
padrão de fechamento por condição verificável das migrations 189 e 190.
Gravidade **normal**; vale somente para invoices locais
(`individual`/`consolidated`). Demurrage e Granito ficam fora.

### C3 — Transação PIX órfã vira pendência persistida

Hoje `/reconciliacao` casa por TXID em memória e as transações sem documento
candidato (`src/services/reconciliacao.ts:150`) desaparecem ao fechar a tela —
`reconciliacao.ts` só lê, nunca persiste. É dinheiro recebido sem destino cujo
único rastro é a memória do operador. Gravidade **crítica**.

Persistir as transações não casadas e abrir um item de pendência no alerta
agregado da transação, fechando o item quando for conciliada. O processamento e a
persistência são server-side, com identidade própria por linha, tratamento de
txid ausente ou duplicado e reprocessamento idempotente.

Contexto que a implementação precisa respeitar: PIX exige quitação exata (o QR
tem valor fixo; divergência para mais ou menos é rejeitada — `111`), e demurrage
valida o valor contra as **duas** PTAX mais recentes até a data do pagamento,
porque o QR é estático e o cliente pode pagar com um de ontem (`158`, ADR 0015).

### C4 — Ações do cliente ganham fecho próprio

- `portal_dispute_opened` → fecha quando a disputa vai para `resolvido`; o
  trigger `notify_dispute_responded` já detecta essa transição. Gravidade
  **normal**; o item existe enquanto a próxima ação for de Equipamentos.
- `portal_consolidation_obsoleted` → fecha quando uma nova consolidada é emitida
  ou o caso é tratado.

## Bloco D — Relatório de Agência (ADR)

O desenho de produto está correto e **não é reaberto**: a migration 225 trocou
pendência por seção por pendência **por departamento** (ADR 0029), fechando ao
assinar; a 271 somou um item independente de prazo vencido (ATD + 3 dias úteis)
no agregado do ADR, que fecha no Fechamento do ADR. Os dois itens convivem porque
dizem coisas diferentes, sem criar dois alertas para a mesma unidade.

A **implementação**, porém, não é pequena: além do D1 abaixo, o Bloco 5 (#524)
reancorou a unidade, precisa de backfill, detector agendado e fan-out. Ver
[`2026-08-17-implementacao-bloco-524-adr-alertas.md`](./2026-08-17-implementacao-bloco-524-adr-alertas.md).

A **unidade** deste bloco mudou com a terminalização (PR #550): o ADR novo agrega
por `agency_departure_report / voyageId::PORTO::TERMINAL` e o prazo é apurado por
`terminal_atd`, não pelo ATD de uma escala unificada por porto. O ADR legado sem
terminal preserva `voyageId::PORTO`. A tabela canônica está na
[#519, §4](https://github.com/luccafwlog/transhippingdesk/issues/519).

Gravidades: `agency_report_department_pending` é **normal**;
`agency_report_deadline_missed` é **crítico** e independente. A dispensa do item
crítico segue a ADR 0053, sem exceção por tipo.

### D1 — Encerrar o tipo legado `agency_report_section_pending`

Obsoleto desde a 225; nada mais o cria. Fechar as linhas antigas ainda abertas e
substituir o rótulo legado pelo tipo ativo
`agency_report_department_pending` em `src/pages/Alertas.tsx:31`, para a tela
continuar apresentando corretamente as pendências departamentais criadas pela
migration 225. O histórico das migrations preserva o registro legado.

## Limpeza colateral

Um predicado da fila de revisão testa um motivo que nenhum produtor grava:

- `needsCeMercante` (`src/pages/revisaoHelpers.ts:110`) procura `ce mercante`,
  que nenhum produtor jamais escreveu. O bloqueio por CE Mercante vive em
  `src/components/billing/validacaoPipeline.ts:120`, outra fila.

Remover junto com o bloco A, que já toca esse arquivo.

**`groupNeedsPortal` não é removido.** A versão de 11/08 mandava removê-lo
(`src/pages/revisaoHelpers.ts:105`) porque a migration 188 tinha tirado
`acesso ao portal nao provisionado` do conjunto canônico. A
[ADR 0054](../adr/0054-portal-como-gate-de-faturamento.md), posterior,
restabelece o Portal como gate e devolve o motivo à Revisão Manual (A1). O
predicado permanece e passa a ter produtor de novo, a partir da migration nova
que restaura o gate.

## Ordem sugerida

**Fundação, em sequência:**

1. **E1** — gravidade única em migration nova. Independente do schema novo;
   pode começar hoje. Pré-requisito de E2 e do Bloco 2.
2. **E2** — cron dos três detectores, com o template de
   `185_portal_daily_digest_schedule.sql`. Também independente do schema novo.
3. **Spec de schema** em `docs/spec/`, cobrindo agregado, itens, Notificação
   Interna e dispensa. É a decisão de design que falta.
4. **E3 + E4** — mesma PR de schema: notificação por destinatário com RLS e
   dispensa temporária, mais a retirada do reconhecimento das telas e RPCs.

**Blocos, por issue:**

5. **Bloco 5 — #524 (ADR).** Isolado, decisões fechadas, D1 é pequeno.
6. **Bloco 2 — #521 (Portal).** Depende do E1; define a prontidão do Portal que
   o Bloco 1 consome.
7. **Bloco 3 — #522 (Financeiro).** C3/PIX é o maior — exige persistência nova.
8. **Bloco 1 — #520 (B/L e Revisão).** Depende da prontidão do Portal do #521 e
   da migration nova que restaura o gate da ADR 0054. A3 depende da #518,
   já mergeada.
9. **Bloco 4 — #523 (Operação e Viagem).** O maior conjunto de produtores;
   depende dos detectores agendados do E2.
10. **Bloco 6 — #525 (transversal e Portal do Cliente).** Documentar em paralelo
    a partir do passo 4: as decisões de produto já estão fechadas na
    [#519, §6](https://github.com/luccafwlog/transhippingdesk/issues/519), e
    escrever a spec depois que a fundação existir dá a `/alertas` e ao `/painel`
    a forma executável real.
