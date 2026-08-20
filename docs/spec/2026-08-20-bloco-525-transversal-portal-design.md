# Bloco 6 — Transversal e Portal do Cliente: contrato de superfícies de Alertas e Notificações

**Status:** contrato de superfícies consolidado; as decisões transversais de
produto já estavam fechadas na [#519, §6](https://github.com/luccafwlog/transhippingdesk/issues/519)
e não são reabertas aqui
**Issue:** [#525](https://github.com/luccafwlog/transhippingdesk/issues/525)
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)
**PR desta etapa:** documental; não encerra a Issue #525

## Objetivo e limites

Esta spec fecha o contrato das **superfícies** de Alertas e Notificações
Internas: a fila `/alertas`, o sino interno, o resumo do `/painel`, a
observabilidade de falha de roteamento em `/admin/usuarios` e as declarações
explícitas de "nenhum evento" das telas internas e do Portal do Cliente.

O Bloco 6 é o bloco de fechamento porque `/alertas` e o sino **consomem** o que
os Blocos 1–5 produzem. Ele não cria produtor de evento operacional, não muda
gravidade de tipo existente, não redefine unidade, audiência, dispensa ou ciclo
de vida, e não reabre nenhum conflito X1–X7.

O escopo cobre:

- o **sino interno** — a superfície de leitura da Notificação Interna, explicitamente
  deixada para "o bloco transversal" pelos Blocos 1 e 2;
- a **fila `/alertas`** — catálogo de rótulos completo, gravidade, departamento,
  dispensa auditável e ordenação por prioridade;
- o **resumo do `/painel`** — indicador e atalho por departamento, sem produzir
  Notificação Interna;
- o **Eco de Tratamento** — a única Notificação Interna nova do bloco;
- a **falha de roteamento de notificação** — a superfície que torna visível a
  decisão 2 da §6 da #519;
- as declarações de "nenhum evento" para `/perfil`, `/line-up-tv/display`,
  `/login`, `/admin/usuarios` e as oito telas do Portal do Cliente.

Financeiro continua fora da audiência de Alertas e Notificações Internas.
E-mail interno e digest do Portal continuam fora desta rodada. Demurrage vencido
ou não devolvido continua Indicador Operacional. O cliente nunca acessa a fila
interna.

## Fontes de verdade

As decisões funcionais vêm da Issue [#519](https://github.com/luccafwlog/transhippingdesk/issues/519) —
especialmente o contrato transversal da §3, as identidades canônicas da §4, as
fronteiras da §5 e as **sete decisões transversais do Bloco 6 da §6** —, da Issue
[#525](https://github.com/luccafwlog/transhippingdesk/issues/525) e das specs
vivas dos Blocos 1–5, além das ADRs
[0034](../adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md),
[0046](../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md),
[0053](../adr/0053-ciclo-de-vida-alerta-dispensa-temporaria.md) e
[0054](../adr/0054-portal-como-gate-de-faturamento.md).

O vocabulário de domínio é o de [`CONTEXT.md`](../../CONTEXT.md), seção
"Alertas e notificações": Alerta, Notificação Interna, Cópia Congelada, Evento
Notificável, Regra de Destinatários, **Eco de Tratamento**, Leitura e Dispensa e
Fechamento automático.

O comportamento executável foi conferido em `main` (`1a1a34b`), nas migrations
`317`–`322` e em `src/pages/Alertas.tsx`, `src/pages/Painel.tsx`,
`src/pages/AdminUsuarios.tsx`, `src/pages/Profile.tsx`,
`src/pages/LineUpTVDisplay.tsx`, `src/pages/Login.tsx`, `src/services/alerts.ts`,
`src/services/portalBilling.ts`, `src/hooks/useOperationalCounts.ts`,
`src/components/layout/AppLayout.tsx` e `src/App.tsx`. Onde o documento vivo
diverge do executável, a divergência está marcada na matriz e vira trabalho de
implementação.

## Decisões herdadas sem reabertura

1. **Alerta é coletivo; Notificação Interna é pessoal.** Ler nunca reconhece,
   fecha ou altera o Alerta (§3.1).
2. **Um agregado por `(entity_type, entity_id)`**, com itens independentes. A
   resolução vem da origem e é recomputada no servidor (§3.2).
3. **Não existe reconhecimento nem fechamento manual** de Alerta derivado. A
   única triagem manual transversal é a dispensa temporária da ADR 0053 (§3.2).
4. **Gravidade é catálogo central** (`alert_type_catalog`, migration `317`).
   Nenhuma tela declara sua própria lista de tipos críticos, e nenhum item piora
   com o tempo (§3.3).
5. **Audiência é regra central por tipo**, expandida por usuário interno ativo.
   Departamento é atributo do item, nunca `alerts.assigned_to` (§3.4).
6. **Fallback de audiência para item crítico** vai para os usuários ativos de
   Administrativo, identificado como fallback e auditado; **ausência total de
   destinatários** mantém o Alerta na fila e registra a falha de configuração
   (§6, decisões 1 e 2).
7. **O resumo do `/painel` é indicador/atalho** — não é produtor de Notificação
   Interna. A contagem principal considera itens **ativos não dispensados**,
   agrupados por departamento; dispensados aparecem separadamente (§6, decisão 3).
8. **Abuso de login interno não abre Alerta nem Notificação** nesta rodada
   (§6, decisão 4).
9. **O cliente nunca acessa `/alertas`.** O Portal mantém suas próprias
   notificações; um evento originado no Portal abre tratamento interno sem expor
   a fila (§6, decisão 5).
10. **`/perfil` e `/line-up-tv/display` não produzem eventos** (§6, decisão 6).
11. **`/admin/usuarios` não atribui pendência individual**; `alerts.assigned_to`
    permanece sem uso (§6, decisão 7).
12. **O roteador de destino é compartilhado** entre a fila e o sino, deriva das
    chaves canônicas da §4 e não é duplicado em PL/pgSQL (§3.6).

## Estado executável herdado da fundação

Verificado nas migrations `317`–`321`, mergeadas em `main` pela PR
[#568](https://github.com/luccafwlog/transhippingdesk/pull/568):

| Objeto | O que já entrega | Consequência para o Bloco 6 |
|---|---|---|
| `alert_type_catalog` | 27 tipos com severidade, departamento responsável, audiência e destino padrão | A fila e o sino leem gravidade daqui; nenhuma tela mantém lista paralela |
| `fanout_alert_item` | Uma entrega por usuário ativo da audiência; fallback crítico para `administrativo`/`admin`; `alert_notification_failures` quando não há ninguém | As decisões 1 e 2 da §6 já são servidor; falta **superfície** para a falha |
| `internal_notifications` | Cópia congelada por destinatário, `is_fallback`, `read_at`, `UNIQUE (event_id, recipient_id)` | O sino tem a tabela; **nenhum componente a consome hoje** |
| `list_internal_notifications` / `mark_internal_notification_read` | Leitura e baixa individual, ambas exigindo usuário interno ativo | Existem em `src/services/alerts.ts:150-162` sem consumidor de UI |
| `list_alert_queue` / `count_alert_queue` | Projeção da fila com legado, filtro por entidade e `LIMIT 200` global | O badge do nav já usa `count_alert_queue`; o resumo por departamento **não pode** derivar da lista paginada |
| `dismiss_alert_item` | Motivo obrigatório, autor e revisão futura obrigatória | Grava a dispensa e **não avisa ninguém**: é a lacuna do Eco de Tratamento |
| `alert_item_events` | Histórico append-only com `event_type IN ('opened','updated','resolved')` | O Eco precisa de um quarto tipo de evento para ter `event_id` próprio |

## Matriz de evidências

| Superfície | Comportamento atual | Decisão alvo | Gap | Fonte | Risco de implementação | Teste ou verificação necessária |
|---|---|---|---|---|---|---|
| Sino interno | **Código:** `listInternalNotifications` e `markInternalNotificationRead` existem em `src/services/alerts.ts:150-162`; nenhum componente os chama. O `Bell` de `appLayoutNav.ts:44` é o ícone do link `/alertas`, não um sino. | Sino no cabeçalho do `AppLayout`, com não lidas, leitura individual, marca-todas, indicação de entrega por fallback e destino pelo roteador compartilhado. | A superfície inteira não existe. Os Blocos 1 e 2 a declararam explicitamente como entrega "do bloco transversal". | `src/services/alerts.ts`, `src/components/layout/AppLayout.tsx`, spec do #520 §11, plano do #521 Task 7 | Sino que reconhece ou fecha Alerta; leitura pessoal alterando a fila coletiva. | Teste de UI: ler não altera `alerts`; RLS impede ler linha de outro usuário; contador cai só para quem leu. |
| Paginação da Notificação | **Código:** `list_internal_notifications` (migration `318`) ordena por `created_at DESC` **sem `LIMIT`**. | Limite e cursor no servidor, mais RPC de contagem de não lidas para o badge, no mesmo padrão do Portal (`portal_list_notifications` usa `p_limit: 20`, `src/services/portalBilling.ts:172-177`). | Um destinatário que nunca lê acumula linhas ilimitadas numa RPC chamada a cada render do layout. | `318`, `src/services/portalBilling.ts` | Baixar histórico inteiro no cabeçalho de toda navegação. | Teste SQL de limite/cursor e teste de serviço provando que o badge não baixa a lista. |
| Rótulos da fila | **Código:** `TYPE_LABELS` (`src/pages/Alertas.tsx:12-30`) cobre 16 tipos, dos quais 3 (`portal_invoice_created`, `portal_consolidation_obsoleted`, `demurrage`) são carriers legados fora do catálogo; **12 tipos catalogados não têm rótulo** — os cinco `review_*`, `pix_unreconciled`, `portal_dispute_opened` e os cinco `voyage_*`. | Rótulo derivado do catálogo para todo tipo ativo, com rótulo legado preservado apenas para linhas históricas. | Os produtores dos Blocos 1–4 entram numa fila que exibe o identificador cru. | `317`, `src/pages/Alertas.tsx:12-33` | Fila mostrando `voyage_baplie_documentary_coverage` ao operador. | Teste de contrato comparando o catálogo com o mapa de rótulos: nenhum tipo ativo sem rótulo. |
| Rótulos de entidade | **Código:** `ENTITY_TYPE_LABELS` (`src/pages/Alertas.tsx:31-37`) cobre `invoice`, `container`, `bl`, `agency_departure_report` e `voyage`. Falta `customer`, usado pelos alertas de Portal desde a migration `196`. | Rótulo e destino para todo `entity_type` da §4, incluindo `customer`, `voyage_pod_schedule` e `voyage_escala_terminal`. | Alerta de Portal por cliente aparece com a chave crua; `entity_type` novo dos Blocos 2 e 4 não tem rótulo. | §4 da #519, `196`, `src/pages/Alertas.tsx` | Alerta sem ação navegável, contrariando a §4. | Teste de contrato: todo `entity_type` produzido tem rótulo e rota. |
| Roteador de destino | **Código:** `alertEntityLink` e `alertEntityLinkLabel` são funções locais de `src/pages/Alertas.tsx:185-212`. | Módulo compartilhado consumido pela fila e pelo sino, cobrindo todos os `entity_type` da §4. | A extração é entrega declarada do **Bloco 5** (plano do #524, Task 7, Step 1). O Bloco 6 **consome e completa**, não re-extrai. | §3.6 da #519, plano do #524 | Dois mapas de rota divergentes entre fila e sino. | Teste único de roteamento exercitado pelos dois consumidores. |
| Coluna `destination` | **Código:** o catálogo grava rotas em `default_destination` (`317:23-51`) e a fundação as copia para `alert_items.destination` e `internal_notifications.destination` (`318`). | O roteador compartilhado é a única fonte do deep link; `destination` fica como fallback grosso de módulo e nunca sobrepõe o roteador. | A §3.6 proíbe destino duplicado em PL/pgSQL e congelado em coluna de Notificação; a fundação faz as duas coisas de forma grossa. | §3.6 da #519, `317`, `318` | Rota congelada há meses vencer o roteador atual e abrir a tela errada. | Teste provando que o deep link exibido vem do roteador e que `destination` só é usado quando o roteador devolve nulo. |
| Dispensa na fila | **Código:** `requestDismissal` usa dois `window.prompt` encadeados (`src/pages/Alertas.tsx:70-85`); `list_alert_queue` projeta apenas `dismissed_until`, sem motivo nem autor. | Formulário com motivo e data/hora de revisão validados, e exibição de motivo, autor e revisão na linha dispensada. | A ADR 0053 exige motivo, autor, data/hora e revisão; a fila mostra só a data. | ADR 0053, §3.2, `318`, `src/pages/Alertas.tsx` | Dispensa auditada no banco e invisível na tela que a operou. | Teste de projeção com motivo/autor e teste de UI do formulário. |
| Eco de Tratamento | **Código:** `dismiss_alert_item` (`318:680-706`) grava a dispensa e retorna; não emite evento nem notificação. | Dispensar emite um evento `dismissed` e uma Notificação Interna aos demais destinatários da ocorrência corrente, exceto o autor. | O `CONTEXT.md` declara o Eco como invariante do domínio e nada o implementa. `alert_item_events.event_type` ainda não aceita `dismissed`. | `CONTEXT.md`, `318` | Duas pessoas tratando a mesma pendência; ou eco virando pendência nova. | Teste SQL: evento criado, autor excluído, demais destinatários notificados, reexecução idempotente, item permanece `active`. |
| Ordenação da fila | **Código:** `list_alert_queue` ordena `is_dismissed ASC, created_at DESC, item_id DESC` — gravidade não participa. | Itens críticos primeiro dentro da faixa não dispensada, depois normais, depois dispensados. | Um crítico antigo cai abaixo de normais recentes. | `318:795-798`, §3.2 | Reordenar sem preservar o corte de 200 linhas e o legado. | Teste SQL de ordenação com crítico antigo, normal recente e dispensado. |
| Resumo do `/painel` | **Código:** `Painel.tsx` mostra apenas o Line Up; nenhuma consulta de alertas. O único indicador global é o badge do nav (`useOperationalCounts.ts:74-78` + `AppLayout.tsx:54`). | Cartão de resumo por departamento, com itens ativos não dispensados, dispensados em separado e atalho para `/alertas` já filtrado. | A decisão 3 da §6 não tem superfície. O `LIMIT 200` de `list_alert_queue` impede agregar no cliente. | §6 decisão 3, `318`, `src/pages/Painel.tsx` | Resumo divergente da fila por causa do corte de 200 linhas. | Teste SQL do agregado com mais de 200 itens e teste de coerência resumo × fila. |
| Falha de roteamento | **Código:** `alert_notification_failures` (`318:72-120`) é gravada pelo fan-out e legível por usuário interno ativo; **nenhuma tela a consulta**. | Aba dedicada em `/admin/usuarios`, ao lado de `usuários`, `logs`, `métricas` e `prazo-adr`, com tipo, departamento, motivo e data. | A decisão 2 da §6 é cumprida no banco e invisível na operação. | §6 decisão 2, `318`, `src/pages/AdminUsuarios.tsx:29` | Má configuração de papéis descoberta só por SQL. | Teste de UI da aba e teste de RLS: leitura permitida, escrita pelo cliente negada. |
| Audiência por papel | **Código:** os papéis são `admin`, `operator`, `administrativo`, `financeiro`, `operacoes`, `documentacao`, `equipamentos` (`src/types/database.ts:5759-5766`); o catálogo só usa `documentacao`, `equipamentos` e `operacoes` como audiência. | Consequência documentada e visível: quem não está numa audiência não recebe nada, e o fallback crítico é o único caminho para `administrativo`/`admin`. | A regra existe no fan-out e não é legível por quem administra papéis. | `317`, `318`, §3.4, §6 decisão 7 | Administrador supor que trocar papel atribui pendência a alguém. | Teste de contrato entre papéis, audiências do catálogo e o fallback. |
| `/perfil` | **Código:** `Profile.tsx` edita nome, e-mail e senha do próprio usuário; não lê nem escreve alertas. | Nenhum evento. Registrar o porquê: a tela projeta identidade, não fato operacional. | Nenhum. É confirmação documental. | §6 decisão 6, `src/pages/Profile.tsx` | Criar evento de "perfil alterado" sem ação, responsável e encerramento. | Teste de contrato negativo: a tela não chama produtor de alerta. |
| `/line-up-tv/display` | **Código:** rota autenticada **fora** do `AppLayout` (`src/App.tsx:157-158`); projeta o snapshot do Line Up. | Nenhum evento e **nenhum sino**: a tela não tem cabeçalho de aplicação por definição. | Nenhum. É confirmação documental. | §6 decisão 6, `src/App.tsx` | Vazar aviso pessoal numa tela de exibição coletiva. | Teste de contrato negativo: sino não renderiza fora do `AppLayout`. |
| `/login` | **Código:** `Login.tsx` distingue falha de transporte de credencial inválida e não registra tentativa, contador ou bloqueio. | Nenhum evento nesta rodada; a assimetria com o Portal é **decidida**, não acidental. | Nenhum. Alerta futuro exige contrato próprio. | §6 decisão 4, `src/pages/Login.tsx` | Criar `abuso_login` interno sem origem, gravidade, audiência e resolução declaradas. | Teste de contrato negativo e nota explícita da assimetria. |
| Portal do Cliente | **Código:** canal próprio e completo — `portal_list_notifications`, `portal_notification_unread_count`, `portal_mark_notification_read`, `portal_mark_all_notifications_read` (`src/services/portalBilling.ts:172-186`), tabela da migration `116`, RLS por cliente. | As oito telas do Portal são **origem** de evento interno e **nunca** consumidora da fila interna. Nenhuma RPC interna de alerta é exposta ao escopo do Portal. | Nenhum gap funcional; falta a declaração de fronteira registrada como contrato verificável. | §3.1, §6 decisão 5, `116`, `src/services/portalScope.ts` | Vazar item interno, departamento ou motivo de dispensa ao cliente. | Teste de fronteira: escopo do Portal não alcança `list_alert_queue`, `list_internal_notifications` nem `alert_items`. |

## Modelo funcional alvo

### Superfícies e responsabilidades

```text
Fato operacional (Blocos 1-5)
        │
        ├─► alert_items ──► /alertas          fila coletiva, tratamento
        │        │
        │        └─► internal_notifications ──► sino    aviso pessoal, leitura
        │                     │
        │                     └─► alert_notification_failures ──► /admin/usuarios
        │
        └─► resumo por departamento ──► /painel          indicador e atalho
```

Cada superfície tem exatamente uma responsabilidade:

- **`/alertas`** é onde a pendência é **triada** — filtrada, ordenada, dispensada
  com motivo e aberta no destino que a corrige.
- **O sino** é onde o usuário **descobre** o que aconteceu com ele. Só lê e marca
  como lida. Nunca dispensa, resolve, reconhece ou fecha.
- **`/painel`** é **indicador e atalho**. Não consulta item a item, não notifica e
  não oferece ação sobre a pendência.
- **`/admin/usuarios`** é onde a **configuração de audiência** é corrigida — papel
  e usuário ativo —, e onde a falha de roteamento fica visível.

### O sino interno

O sino vive no cabeçalho do `AppLayout` e, por consequência, não existe em
`/login`, `/line-up-tv/display`, nas telas do Portal nem na inspeção de Portal.

- Lista as Notificações Internas do próprio usuário, não lidas primeiro, com
  paginação servida pelo servidor.
- Exibe tipo, gravidade do catálogo, mensagem congelada, entidade e data.
- Marca uma como lida e oferece marcar todas como lidas. Nenhuma das duas ações
  toca `alerts`, `alert_items` ou `alert_item_dismissals`.
- Identifica visivelmente a entrega **por fallback**, usando `is_fallback`, e
  deixa claro que o departamento responsável pelo tratamento não mudou.
- Navega pelo **mesmo** roteador de destino da fila, derivado no cliente a partir
  de `entity_type`/`entity_id` e das chaves canônicas da §4. A coluna
  `destination` é tratada como **fallback grosso de módulo**, nunca como deep
  link canônico — ver "Destino: o roteador manda" abaixo.
- Não tem backfill: passa a receber eventos a partir do deploy (§3.5).

### Destino: o roteador manda

A §3.6 da #519 determina que o destino **não** seja duplicado em PL/pgSQL nem
congelado em coluna de Notificação Interna. A fundação, porém, grava rotas em
`alert_type_catalog.default_destination` (`/revisao`, `/taxas-locais`,
`/clientes/portal`, …) e as copia para `alert_items.destination` e
`internal_notifications.destination`. A divergência é real e o Bloco 6, dono do
roteador compartilhado, a resolve **sem apagar o trabalho da fundação** e sem
editar migration histórica:

- O **roteador compartilhado é a única fonte do deep link**. É ele que aplica as
  identidades canônicas da §4 — `escala`, `terminal`, `report`, `invoice`,
  `cliente` — e é ele que a fila e o sino chamam.
- `destination` permanece como **fallback grosso de módulo**, usado apenas quando
  o roteador não consegue derivar rota para a entidade, e nunca como deep link.
  Uma linha congelada com `destination` antigo não sobrepõe o roteador atual.
- Nenhuma migration nova de bloco acrescenta parâmetro de rota, chave composta ou
  query string a `default_destination`. Um `entity_type` novo entra no **roteador**,
  não no catálogo SQL.

Assim não existem dois mapas de rota concorrentes: existe um roteador e um
fallback declaradamente inferior a ele.

### A fila `/alertas`

- Rótulo de **todo** tipo ativo do catálogo, com os rótulos legados preservados
  apenas para linhas históricas ainda abertas.
- Rótulo e destino para **todo** `entity_type` da §4, incluindo `customer`.
- Ordenação: não dispensados antes de dispensados; **críticos antes de normais**
  dentro de cada faixa; depois, mais recentes primeiro.
- Filtro por departamento responsável, além dos filtros de estado já existentes.
- Dispensa por formulário — motivo e data/hora futura de revisão validados antes
  do envio, sem `window.prompt` — e exibição de **motivo, autor e revisão** na
  linha dispensada.
- Nenhuma ação de reconhecer ou fechar. As guardas server-side de
  `src/services/alerts.ts:75-84` permanecem.

### O resumo do `/painel`

- Uma consulta agregada dedicada, **não** derivada da lista paginada.
- Contagem principal: itens **ativos não dispensados**, agrupados por
  departamento responsável.
- Itens dispensados contados **separadamente**, nunca somados à contagem
  principal.
- Linhas legadas sem item nem departamento aparecem num grupo próprio e
  identificado, não distribuídas entre departamentos.
- Cada grupo é atalho para `/alertas` já filtrado. Nenhuma ação de tratamento no
  `/painel`.
- Não produz Notificação Interna, não marca nada como lido e não altera a fila.

### A falha de roteamento em `/admin/usuarios`

- Aba nova ao lado de `usuários`, `logs`, `métricas` e `prazo-adr`.
- Lista `alert_notification_failures` com tipo do item, departamento esperado,
  motivo, data e link para o Alerta correspondente.
- Somente leitura: a correção é operacional — ativar um usuário ou atribuir um
  papel na própria aba de usuários.
- A aba de usuários passa a deixar legível quais papéis são audiência de alguma
  regra do catálogo. Isso **não** cria atribuição individual de pendência:
  `alerts.assigned_to` permanece sem uso (§6, decisão 7).

## Contrato dos eventos

### Evento novo — Eco de Tratamento

Único evento novo do bloco. Responde às sete declarações obrigatórias da §3.3.

1. **Alerta, Notificação, ambos ou nenhum?** **Somente Notificação Interna.** O
   Eco não cria Alerta, não cria item, não reabre ocorrência e não altera o
   estado do item dispensado, que permanece `active` com a dispensa vigente.
2. **Entidade e chave canônicas?** As do item dispensado. O Eco não introduz
   `entity_type` novo e não tem chave própria: é uma entrega ligada ao evento de
   dispensa daquele `alert_item` na sua **ocorrência corrente**.
3. **Item e condição de resolução/reabertura?** Não aplicável — o Eco não é
   pendência. Como toda Notificação Interna, é Cópia Congelada: a revisão, a
   resolução ou a reabertura posterior do item não o apaga nem o altera. Ele não
   pode ser dispensado; só lido.
4. **Departamento responsável, audiência e destino?** O departamento continua
   sendo o do item, inalterado pela dispensa. A audiência é **exatamente quem já
   recebeu a notificação da ocorrência corrente daquele item, menos o autor da
   dispensa** — o que preserva o fallback: quem recebeu por fallback recebe o Eco
   e continua marcado como fallback. Não há expansão de audiência nova, não há
   entrega ao Financeiro e não há entrega ao autor da própria ação. Destino: o
   mesmo do item, pelo roteador compartilhado.
5. **Gravidade?** **Normal**, sempre — inclusive quando o item dispensado é
   crítico. O Eco informa que alguém já triou a pendência; ele não é a pendência.
   Isso não altera a gravidade do item no catálogo nem na fila. O Eco **não entra
   em `alert_type_catalog`**: o catálogo é a fonte única de severidade dos **itens**,
   e `alert_items.item_type` tem chave estrangeira para ele. Registrar o Eco ali
   sugeriria que ele pode virar item, que é exatamente o que este contrato proíbe.
   A entrega carrega o `item_type` do item dispensado — a coluna
   `internal_notifications.item_type` é texto livre, sem chave estrangeira — para
   que o sino saiba rotulá-la, e é marcada como Eco no `payload`, para que a UI
   nunca a confunda com a notificação de abertura do mesmo item.
6. **Mutação que dispara?** A RPC `dismiss_alert_item`, na **mesma transação** da
   dispensa. Não há detector agendado: sem dispensa não há Eco. Se não houver
   nenhum outro destinatário além do autor, nada é entregue e isso **não** é
   falha de roteamento — é o caso normal de um único destinatário.
7. **Dispensa, auditoria e retenção?** O Eco não é dispensável. A auditoria já
   existe em `alert_item_dismissals` (motivo, autor, revisão) e ganha um evento
   `dismissed` em `alert_item_events`, que dá ao Eco o `event_id` exigido por
   `internal_notifications`. A retenção acompanha a das demais Notificações
   Internas e pode divergir da retenção do Alerta (§3.5).

**Idempotência:** o `UNIQUE (event_id, recipient_id)` de `internal_notifications`
garante que reexecutar o fan-out do mesmo evento de dispensa não duplica entrega.
Duas dispensas sucessivas da mesma ocorrência geram dois eventos distintos e,
portanto, dois Ecos — corretamente, porque são dois atos de triagem.

### Eventos declarados como "nenhum"

Cada declaração abaixo é decisão registrada, não omissão.

| Superfície | Decisão | Por quê |
|---|---|---|
| `/painel` | Nenhum evento | É indicador e atalho. Um resumo não tem ação, responsável nem momento objetivo de encerramento próprios (§3.1, §6 decisão 3). |
| `/alertas` | Nenhum evento **exceto** o Eco de Tratamento | A fila trata pendência produzida por outros módulos. A única ação manual transversal é a dispensa, e o Eco é a notificação dessa ação. |
| `/perfil` | Nenhum evento | Projeta identidade do próprio usuário. Alteração de nome, e-mail ou senha já tem rastro de auditoria e não gera pendência de terceiro. |
| `/admin/usuarios` | Nenhum evento | É configuração de audiência, não fato operacional. A consequência de má configuração já é registrada pelo fan-out em `alert_notification_failures`. |
| `/line-up-tv/display` | Nenhum evento e nenhum sino | Projeta dados já existentes numa tela coletiva, fora do `AppLayout`. Aviso pessoal em tela de exibição pública violaria a fronteira de audiência. |
| `/login` | Nenhum evento | Decisão 4 da §6: abuso de login interno permanece em auditoria e monitoramento de segurança. A assimetria com `portal_abuso_login` é deliberada; alerta futuro exige contrato próprio. |
| `/portal`, `/portal/billing`, `/portal/operacao`, `/portal/perfil` | Nenhum evento **novo**; são origem dos eventos já contratados pelos Blocos 2 e 3 | Decisão 5 da §6. O tratamento é sempre interno; o cliente vê apenas o canal do Portal. |
| `/portal/login`, `/portal/esqueci-senha`, `/portal/recuperar-senha`, `/portal/ativar` | Nenhum evento **novo**; `portal_abuso_login`, `portal_convite_expirado` e `portal_falha_envio` já pertencem ao Bloco 2 | Não duplicar produtor: todo produtor é único por tipo de evento (§3.5). |

### Fronteira Portal → cliente

Contrato verificável, não apenas afirmação:

- O escopo do Portal (`src/services/portalScope.ts`) **não** inclui, e não pode
  passar a incluir, `list_alert_queue`, `count_alert_queue`,
  `list_internal_notifications`, `mark_internal_notification_read`,
  `dismiss_alert_item`, `upsert_alert_item` ou `resolve_alert_item`.
- Nenhuma projeção do Portal expõe `alert_items`, `alert_item_events`,
  `alert_item_dismissals`, `internal_notifications`, `alert_notification_failures`
  nem o departamento responsável interno.
- Motivo de dispensa, autor da dispensa e mensagem de item interno **nunca**
  chegam ao Portal, mesmo quando o evento nasceu de uma ação do cliente.
- O canal do cliente continua sendo `portal_notifications` e suas RPCs, com RLS
  por cliente. Omissão e COD reutilizam as Notificações do Portal entregues pela
  #553 (§5), sem nova entrega e sem motivo interno.

## Critérios de aceite do contrato

- **525-AC-01:** o sino lista, pagina e marca como lidas apenas as Notificações
  Internas do próprio usuário; ler ou marcar todas nunca altera `alerts`,
  `alert_items` ou qualquer dispensa.
- **525-AC-02:** o sino identifica a entrega por fallback e não apresenta o
  destinatário do fallback como responsável pelo tratamento.
- **525-AC-03:** o sino e a fila usam o **mesmo** roteador de destino; não existe
  segundo mapa de rotas em nenhuma tela nem em PL/pgSQL.
- **525-AC-04:** o deep link exibido pela fila e pelo sino vem do roteador
  compartilhado; `destination` só é usado quando o roteador não deriva rota, e
  nenhuma migration nova acrescenta parâmetro de rota a `default_destination`.
- **525-AC-05:** todo tipo ativo do `alert_type_catalog` tem rótulo na fila, e
  todo `entity_type` produzido pelos Blocos 1–5 tem rótulo e destino navegável.
- **525-AC-06:** a dispensa na fila exige motivo e data/hora futura de revisão em
  formulário validado, e a linha dispensada exibe motivo, autor e revisão.
- **525-AC-07:** dispensar um item entrega o Eco de Tratamento aos demais
  destinatários da ocorrência corrente, **nunca** ao autor, sempre com gravidade
  normal, sem criar Alerta, item ou reabertura, e distinguível no sino da
  notificação de abertura do mesmo item.
- **525-AC-08:** o Eco é idempotente por `(event_id, recipient_id)`; duas
  dispensas da mesma ocorrência geram dois eventos e dois Ecos distintos.
- **525-AC-09:** o resumo do `/painel` agrupa itens ativos **não dispensados** por
  departamento, conta dispensados em separado, isola o grupo legado sem
  departamento e não produz notificação.
- **525-AC-10:** o resumo do `/painel` não deriva de `list_alert_queue` e
  permanece correto com mais de 200 itens ativos.
- **525-AC-11:** a fila ordena não dispensados antes de dispensados e críticos
  antes de normais, preservando o corte de 200 linhas e a visibilidade do legado.
- **525-AC-12:** `/admin/usuarios` expõe `alert_notification_failures` em aba
  somente leitura, e a escrita pelo cliente continua negada pelo RLS.
- **525-AC-13:** `alerts.assigned_to` e `alerts.notified_at` permanecem sem uso;
  nenhuma tela deste bloco atribui pendência a uma pessoa.
- **525-AC-14:** `/perfil`, `/line-up-tv/display` e `/login` não chamam nenhum
  produtor de alerta ou notificação, e o sino não renderiza fora do `AppLayout`.
- **525-AC-15:** nenhuma RPC ou projeção do Portal alcança a fila interna, os
  itens, as dispensas, as Notificações Internas ou as falhas de roteamento.
- **525-AC-16:** nenhuma gravidade de tipo existente muda por causa deste bloco; a
  fila e o sino leem severidade exclusivamente do `alert_type_catalog`.

## Fora desta etapa

- nenhuma alteração em código de produção;
- nenhuma edição de migrations históricas — `317`–`322` permanecem imutáveis;
- nenhum produtor novo de pendência operacional: os Blocos 1–5 continuam donos
  únicos dos seus eventos;
- nenhuma mudança de gravidade, audiência, unidade, dispensa ou ciclo de vida;
- nenhum canal de e-mail interno e nenhum digest do Portal;
- nenhum Alerta de abuso de login interno;
- nenhuma promoção de Demurrage vencido ou não devolvido a Alerta;
- nenhuma inclusão do Financeiro na audiência.
