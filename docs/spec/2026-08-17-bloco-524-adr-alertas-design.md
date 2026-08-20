# Bloco 5 — Relatório de Agência (ADR): contrato de alertas e notificações

**Status:** contrato de eventos consolidado; reabrir uma seção com sign-off
departamental vigente invalida atomicamente esse sign-off e exige nova
assinatura antes do fechamento
**Issue:** [#524](https://github.com/luccafwlog/transhippingdesk/issues/524)
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)
**PR desta etapa:** documental; não encerra a Issue #524

## Objetivo e limites

Esta spec fecha o contrato de Alertas e Notificações Internas do Agency
Departure Report, sem reabrir as decisões dos Blocos 1–4 e sem implementar
produtores, migrations, RPCs ou mudanças de UI nesta etapa.

O escopo cobre:

- pendência departamental do ADR após o ATD;
- prazo de conclusão vencido por departamento;
- encerramento do tipo legado `agency_report_section_pending`;
- reabertura de resolução de seção;
- reabertura de sign-off departamental;
- fechamento e reabertura do ADR;
- detecção server-side, backfill, deduplicação, audiência e destino.

Financeiro continua fora da audiência de Alertas/Notificações deste épico.
Demurrage vencido ou não devolvido continua Indicador Operacional. O ADR
continua sendo uma exibição derivada dos módulos donos; esta spec não cria
campos de carga, veículos, vazios, Granito, depot ou overtime no relatório.

## Fontes de verdade

As decisões funcionais vêm da Issue [#519](https://github.com/luccafwlog/transhippingdesk/issues/519),
da Issue [#524](https://github.com/luccafwlog/transhippingdesk/issues/524), das
PRs documentais [#517](https://github.com/luccafwlog/transhippingdesk/pull/517),
[#544](https://github.com/luccafwlog/transhippingdesk/pull/544),
[#543](https://github.com/luccafwlog/transhippingdesk/pull/543),
[#545](https://github.com/luccafwlog/transhippingdesk/pull/545) e
[#546](https://github.com/luccafwlog/transhippingdesk/pull/546) e da própria
[#548](https://github.com/luccafwlog/transhippingdesk/pull/548), além das ADRs
[0027](../adr/0027-agency-departure-report-agregado-escala-snapshot.md),
[0028](../adr/0028-adr-signoff-historico-justificativa-audit-logs.md),
[0029](../adr/0029-adr-signoff-departamental-fases-ciclo.md),
[0030](../adr/0030-adr-observacoes-por-secao-substitui-ocorrencias.md),
[0034](../adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md),
[ADR 0050](https://github.com/luccafwlog/transhippingdesk/blob/4d975d4ac50cfab822fa8a11247c7b717ce72db4/docs/adr/0050-ciclo-de-vida-alerta-dispensa-temporaria.md),
[0035](../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md),
[0036](../adr/0036-adr-embarque-vazios-secao-unica-escala-fora-das-fases.md) e
[0039](../adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md).

O comportamento executável foi conferido em `supabase/migrations/208`–`228`,
`249`–`258`, `271`–`273`, `src/services/agencyDepartureReport.ts`,
`src/services/alerts.ts`, `src/pages/Alertas.tsx`,
`src/hooks/useAgencyReport.ts`, `src/components/voyages/VoyageAgencyReportTab.tsx`
e `src/components/voyages/AgencyReportDocument.tsx`. Quando uma decisão
histórica diverge da migration final ou do código atual, a divergência está
marcada na matriz abaixo e vira trabalho de implementação.

## Decisões herdadas sem reabertura

1. Existe um Alerta agregado por `(entity_type, entity_id)`; itens de pendência
   são independentes dentro dele.
2. A Notificação Interna é separada, uma entrega por usuário interno ativo da
   audiência, com leitura individual. Não existe reconhecimento.
3. A audiência é derivada do departamento do item. `alerts.assigned_to` não é
   departamento nem será usado para fan-out.
4. Resolução vem da origem. Conforme a ADR 0050, dispensa é triagem temporária
   com motivo, autor, data/hora e data futura de revisão; não há data padrão,
   dispensa indefinida ou exceção por tipo de alerta. Ela não resolve a origem
   nem libera gate.
5. Backfill, deduplicação e reavaliação são server-side e idempotentes.
6. A unidade canônica de ADR novo é o terminal que operou a frente:
   `entity_type = 'agency_departure_report'` e
   `entity_id = voyageId::PORTO::TERMINAL`. O departamento não entra no
   `entity_id` do agregado. ADR legado sem terminal conserva
   `voyageId::PORTO`, sem conversão artificial.
7. O ADR terminalizado existe por `(voyage_id, port, terminal_id)` e é acessado
   pelas RPCs `*_by_report_id`. Portos estrangeiros e escalas `deleted` ou
   `omitted` não são elegíveis para novos detectores. Uma frente `TBC` impede o
   fechamento até receber terminal, mas não pode ser atribuída a um terminal
   arbitrário pelo detector.
8. O ADR tem seis seções: `datas`, `carga_descarregada`,
   `vazios_descarregados`, `veiculos`, `carga_carregada` e
   `vazios_embarcados`. Operação de pátio é subseção de vazios embarcados.
9. Há três sign-offs departamentais. Cada um exige todas as seções do
   departamento resolvidas; o fechamento exige os três.
10. Ausência de dado continua pendente até `Confirmado` ou `Nada a declarar`.
    Reaberturas exigem justificativa e histórico auditável.
11. O prazo segue a ADR 0039 e a PR #550: ATD real do terminal do ADR; somente
    ADR legado sem terminal usa o ATD da escala unificada. A data é tratada sem hora,
    três dias úteis, dia do ATD fora da conta, feriados contam, três prazos
    independentes, sem prazo próprio para o fechamento, sem retroatividade e
    sem prazo quando não houver ATD.
12. A integração documental permanece na ordem
    **#517 → #544 → #543 → #545 → #546 → #548**.

## Matriz de evidências

| Área | Comportamento atual | Decisão alvo | Gap | Fonte | Risco de implementação | Teste ou verificação necessária |
|---|---|---|---|---|---|---|
| Unidade do Alerta | **Código:** a migration 306 introduziu ADRs por terminal e chaves atuais `voyageId::PORTO::TERMINAL::departamento`; ADRs legados permanecem sem terminal. | Um agregado por ADR terminalizado (`voyageId::PORTO::TERMINAL`) ou legado (`voyageId::PORTO`), com itens `department_pending` e `deadline_missed`. | A fundação ainda precisa retirar o departamento da chave sem apagar a dimensão terminal. | `306`, `225`, `271`, ADR 0034, plano da #517 | Colapsar dois terminais do mesmo porto ou migrar histórico legado para o terminal errado. | Teste SQL: dois terminais no mesmo porto geram dois agregados; dois tipos e três departamentos permanecem itens; legado fica separado e idempotente. |
| Pendência departamental | **Código:** `detect_agency_report_pending` usa ATD de `audit_logs`, avalia se alguma seção está pendente e abre `agency_report_department_pending`; o sign-off departamental fecha a linha. | Item normal por departamento após ATD enquanto o departamento ainda não tiver concluído seu sign-off; reavaliação mantém o mesmo item. | Abertura depende da lista de seções e não cobre de forma explícita um departamento já resolvido nas seções mas ainda sem sign-off; não há agregado central. | `225`, `251`, `253`, ADR 0029 | Fechar cedo ou perder pendência quando resolução e sign-off ocorrerem em mutações separadas. | Matriz SQL de ATD, seis seções, sign-off vigente, escala mista, exportação-only e omissão. |
| Prazo vencido | **Código:** migration 271 calcula ATD unificado + três dias úteis e abre uma linha `agency_report_deadline_missed` por departamento sem `signed_at`. | Item crítico independente, no mesmo agregado, resolvido pelo sign-off vigente e reaberto se o sign-off for retirado após o vencimento. | A linha atual usa a unidade errada e não fecha imediatamente na assinatura departamental. | `271`, ADR 0039 | Recriar a regra de prazo ou confundir prazo com pendência. | Teste SQL da aritmética, baseline, `deleted/omitted`, POD→POL, assinatura e reabertura. |
| Legado de seção | **Código:** `214` criou `agency_report_section_pending`; `225` deixou de produzir o tipo; `271` ainda o fecha como legado no fechamento. | Nenhum produtor novo. Linhas antigas abertas são migradas para o item departamental correspondente e depois fechadas, sem apagar ou renomear o histórico. | Linhas antigas podem permanecer abertas; `Alertas.tsx` ainda rotula o legado, enquanto o tipo departamental ativo ainda precisa de rótulo. | `214`, `219`, `225`, `271`, `src/pages/Alertas.tsx:18-33` | Recontar seção aposentada, enviar notificação duplicada ou perder auditoria. | Teste de backfill: uma linha por seção vira no máximo um item por departamento; row legado fica fechado e preservado. |
| Reabertura de seção | **Código:** `set_agency_report_signoff` exige justificativa ao sair de estado resolvido e grava `audit_logs`; não cria tipo de alerta próprio. | Reabrir uma seção invalida atomicamente o sign-off departamental proprietário, com auditoria; a reconciliação reavalia os itens do departamento sem criar alerta por seção. | A transição precisa invalidar o sign-off e impedir fechamento 3/3 até nova assinatura. | `221`, `227`, `253`, ADRs 0028–0030, decisão do Bloco 5 | Permitir fechamento inconsistente ou invalidar assinatura sem histórico. | Teste de contrato da transição atômica, justificativa, auditoria, dedupe e audiência. |
| Reabertura de sign-off | **Código:** `set_agency_report_department_signoff(..., false, justification)` audita a mudança; a migration 253 fecha pendência somente ao assinar e não reabre explicitamente os itens de prazo. | Reabre o item normal; se a data-limite já passou, reabre também o item crítico independente. Mesma chave e mesmo histórico. | Falta reconciliação server-side imediata para os dois itens e preservação dos atores de reabertura. | `223`, `225`, `253`, `271`, `273`, ADR 0039 | Criar novo alerta a cada reabertura ou deixar o atraso sem dono. | Teste SQL de `true → false → true`, dedupe, audiência e nomes dos atores auditados. |
| Fechamento do ADR | **Código:** `close_agency_departure_report` exige três sign-offs e fecha legado e prazo; o contrato central ainda precisa representar os itens no mesmo agregado. | Fechamento é consequência de três sign-offs e se resolve pela origem; não cria evento adicional nem prazo do relatório inteiro. | Fechamento atual não é a origem dos itens e deve chamar/reutilizar reconciliação sem fechamento manual no browser. | `256`, `271`, ADRs 0027 e 0039 | Fechar um item ainda ativo ou emitir notificação de sucesso como pendência. | Teste de fechamento com 3/3, snapshot, itens ativos e repetição idempotente. |
| Reabertura do ADR | **Código:** migration 227 preserva seções e sign-offs e limpa somente o snapshot; reabertura é administrativa e auditada. | Não cria novo tipo nem reinicia prazo. Reavalia o estado vigente; só mutações de origem reabrem itens. | O detector server-side ainda não é independente da tela. | `227`, `src/services/agencyDepartureReport.ts:324-333`, ADR 0030 | Reiniciar SLA ou resetar assinaturas contra a decisão aceita. | Teste de reabertura preservando `signed_at`, `closed_snapshot` nulo e sem item espúrio. |
| Detecção | **Código:** `Alertas.tsx:53-59` chama os dois RPCs no mount de `/alertas`; RPCs exigem `auth.uid()` e role ativa. | Executor server-only, protegido, a cada 15 minutos, mais reavaliação nas mutações autorizadoras; nunca depender da tela nem chamar diretamente pelo `pg_cron` uma função que exige `auth.uid()`. | Um prazo pode não existir até alguém abrir a tela. | `src/pages/Alertas.tsx`, `214`, `251`, `271`, plano #517/E2 | Cron sem contexto de autenticação ou dupla execução não idempotente. | Teste SQL do wrapper e verificação do agendamento em banco descartável. |
| Audiência | **Código:** `alerts` é fila coletiva; não existe tabela/fan-out de Notificação Interna neste checkout. | Alerta legível por usuários internos autorizados; Notificação para usuários ativos do departamento do item. Financeiro nunca é audiência. | E3 ainda é dependência de implementação; `assigned_to` não deve ser sobrecarregado. | ADR 0034, PR #517, `001` | Vazamento entre departamentos ou entrega por pessoa errada. | Teste RLS/fan-out por usuário ativo, inativo, departamento e Financeiro. |
| Destino | **Código:** `Viagens.tsx` já aceita `tab=adr`, `escala`, `terminal` e `report`; `alertEntityLink` ainda abre só a viagem. | Link compartilhado para `/viagens/:voyageId?tab=adr&escala=PORTO&terminal=TERMINAL`; quando o payload congelado possuir `report_id`, preferir também `&report=REPORT_ID`. | Abrir apenas o porto pode selecionar o ADR de outro terminal. | `src/pages/Alertas.tsx`, `src/pages/Viagens.tsx`, `VoyageAgencyReportTab.tsx` | Notificação executar ação no ADR errado. | Teste com dois terminais no mesmo porto, chave legada e `report_id` válido. |
| Seções e rótulos | **Código:** a migration 258 corrige `carga_carregada` para Equipamentos e “Granito”; `agencyDepartureReport.ts` já espelha esse contrato. A migration 253 preserva o estado histórico anterior. | Preservar `carga_carregada → equipamentos` e rótulo “Granito” em SQL, TypeScript, backfill e UI; não reverter para “Carga carregada”/Documentação. | A matriz e o AC-10 descrevem incorretamente a migration 253 como vigente e mandam uma correção que recriaria o bloqueio de Equipamentos. | `253`, `258`, ADRs 0027, 0035, 0036, `src/services/agencyDepartureReport.ts:34-52` | Sign-off enviado ao departamento errado e ADR impossível de fechar 3/3. | Teste de contrato comparando mapa TypeScript, funções SQL vigentes, backfill e seis seções. |

## Modelo funcional alvo

### Agregado e itens

O agregado vivo é único por ADR/terminal, com compatibilidade legada:

```text
Alerta agregado
  entity_type = agency_departure_report
  entity_id   = voyageId::PORTO::TERMINAL
  ├─ item agency_report_department_pending / departamento
  └─ item agency_report_deadline_missed / departamento
```

Para ADR sem terminal anterior à PR #550, `entity_id = voyageId::PORTO`. O
`department` é atributo do item e regra de audiência. Nunca é gravado em
`alerts.assigned_to` nem anexado à chave do agregado. Os identificadores de
item podem continuar usando os tipos ativos já conhecidos (`agency_report_department_pending`
e `agency_report_deadline_missed`) para preservar origem, filtros e histórico;
o tipo legado não volta a ser produtor.

O agregado permanece aberto enquanto houver pelo menos um item ativo. Resolver
um item não resolve os outros. Um item que volta a ser ativo reutiliza seu ciclo
e sua chave, preservando o histórico; não há uma nova linha de Alerta por
execução do detector.

### Audiência e gravidade

| Item | Alerta | Notificação Interna | Departamento | Gravidade |
|---|---|---|---|---|
| `agency_report_department_pending` | Sim, no agregado da escala | Sim, uma entrega por usuário ativo do departamento, somente na abertura/reabertura do item | dono das seções e do sign-off pendente | normal |
| `agency_report_deadline_missed` | Sim, independente do item de pendência | Sim, uma entrega por usuário ativo do departamento, somente na abertura/reabertura do item | departamento sem sign-off vigente | crítico |
| `agency_report_section_pending` | Não como evento atual | Não | — | legado |
| Reabertura de seção | Não cria tipo novo; reavalia o item departamental | Somente se a reavaliação ativar um item antes inativo | dono da seção | herda o item |
| Reabertura de sign-off | Não cria tipo novo; reavalia pendência e prazo | Uma entrega por cada item que passar de inativo para ativo | departamento reaberto | herda cada item |
| Fechamento/reabertura do ADR | Não cria tipo novo | Não por si só | — | — |

O Alerta agregado continua consultável pela leitura interna global autorizada.
O fan-out da Notificação Interna não inclui Financeiro nem todos os
departamentos por padrão. Usuários administrativos podem consultar a fila
conforme o contrato de leitura interna, mas não recebem uma cópia de cada
evento apenas por serem administradores.

### Destino canônico

Todo item deste bloco aponta para:

```text
/viagens/:voyageId?tab=adr&escala=PORTO&terminal=TERMINAL
```

`PORTO` é o porto normalizado e `TERMINAL` é o código cadastrado. Se a entrega
congelar `report_id`, o roteador acrescenta `report=REPORT_ID`. A aba ADR
é a tela onde se resolve seção, assina departamento, reabre sign-off ou fecha o
ADR. A fila e o sino usam a mesma função de roteamento; não haverá mapa de
rotas duplicado em SQL.

## Contrato dos eventos

As seis perguntas obrigatórias da #519 estão respondidas abaixo. “Reabrir”
significa reavaliar a origem no mesmo item, nunca criar um alerta novo por
seção, pessoa ou tentativa do detector.

### 1. Pendência departamental do ADR

1. **Alerta, Notificação ou ambos?** Ambos. O Alerta é o item normal no
   agregado da escala; a Notificação Interna é a entrega para o departamento.
2. **Audiência?** Usuários internos ativos cujo departamento é o dono do item.
   A fila do Alerta permanece visível para leitores internos autorizados; não
   usar `assigned_to` e não incluir Financeiro no fan-out.
3. **Resolve e reabre como?** Resolve quando o sign-off departamental vigente
   existe, derivado de `agency_departure_report_department_signoffs.signed_at`.
   Reabre quando esse sign-off deixa de ser vigente ou quando uma seção do
   departamento volta a `pending`, conforme a decisão de invalidação atômica
   abaixo. Se o
   item já estiver ativo por outra causa, a atualização não entrega uma segunda
   Notificação.
4. **Unidade e chave?** Agregado terminalizado
   `agency_departure_report / voyageId::PORTO::TERMINAL` (ou legado
   `voyageId::PORTO`);
   item identificado por `agency_report_department_pending + department`.
5. **Gravidade?** Normal. É trabalho pendente após a saída, mas ainda não é
   prova de violação do prazo de três dias úteis.
6. **Detecção e frequência?** Reavaliação server-side nas mutações autorizadas
   de ATD, resolução, sign-off, fechamento e reabertura, com varredura protegida
   a cada 15 minutos. A execução não depende de `/alertas` estar aberta.

### 2. Prazo de conclusão do ADR vencido

1. **Alerta, Notificação ou ambos?** Ambos. É um item crítico independente da
   pendência departamental no mesmo agregado.
2. **Audiência?** Usuários internos ativos do departamento cujo sign-off não
   está vigente; não enviar para Financeiro nem para uma pessoa específica.
3. **Resolve e reabre como?** Resolve quando o sign-off departamental vigente
   tem `signed_at`, mesmo que o fechamento geral ainda não tenha ocorrido.
   Reabre quando esse sign-off é reaberto depois de a data-limite já ter
   passado. O fechamento do ADR faz reconciliação de segurança, mas não substitui
   a resolução por sign-off.
4. **Unidade e chave?** Mesmo agregado terminalizado
   `agency_departure_report / voyageId::PORTO::TERMINAL` (ou legado sem terminal);
   item identificado por `agency_report_deadline_missed + department`.
5. **Gravidade?** Crítico. O tipo representa o descumprimento explícito da
   obrigação da ADR 0039; isso não cria escalonamento genérico por idade.
6. **Detecção e frequência?** Reutilizar a regra da migration 271: ATD real da
   escala unificada, `agency_report_deadline_date`, baseline de vigência,
   exclusão de `deleted` e `omitted` e data-limite anterior a `CURRENT_DATE`.
   A guarda de `deleted` da migration 272 deve ser preservada no nível do item
   ou da operação de upsert do agregado, mesmo que a futura estrutura deixe de
   inserir uma linha de `alerts` por item. Rodar no executor server-only a cada
   15 minutos e nas mutações de ATD/sign-off.

### 3. Legado `agency_report_section_pending`

1. **Alerta, Notificação ou ambos?** Nenhum evento atual. É histórico de um
   produtor obsoleto.
2. **Audiência?** Nenhuma nova audiência. A linha antiga permanece auditável;
   eventual condição atual passa pelo item departamental ativo.
3. **Resolve e reabre como?** O backfill fecha as linhas legadas abertas após
   copiar sua condição para o item departamental correspondente, quando a
   escala ainda for elegível. O tipo não reabre e não volta a ser produzido.
4. **Unidade e chave?** A linha histórica conserva `agency_departure_report` e
   seu `entity_id` antigo; o item ativo usa a chave canônica da escala e o
   departamento, sem alerta por seção.
5. **Gravidade?** Não aplicável. A gravidade do item ativo derivado é normal.
6. **Detecção e frequência?** Backfill único, idempotente, na migration de
   integração. Nenhum detector novo e nenhuma chamada no mount da tela.

### 4. Reabertura de resolução de seção

1. **Alerta, Notificação ou ambos?** Não cria tipo novo. A mutação reavalia o
   item departamental existente; a Notificação só nasce na transição inativo →
   ativo.
2. **Audiência?** O departamento dono da seção, nunca o usuário que clicou e
   nunca Financeiro.
3. **Resolve e reabre como?** A origem é o estado atual da seção. Sair de um
   estado resolvido exige justificativa e grava evento em `audit_logs`, conforme
   ADR 0028. A reabertura invalida atomicamente o sign-off departamental
   proprietário quando ele estiver vigente e faz o item departamental refletir
   a pendência; não há alerta por seção.
4. **Unidade e chave?** ADR por terminal (ou ADR legado); a seção é metadado de origem do item,
   não parte de `entity_id`.
5. **Gravidade?** Herda normal da pendência departamental; não é escalonamento.
6. **Detecção e frequência?** Reavaliação server-side na RPC de resolução,
   mais varredura de 15 minutos como segurança. Não chamar detector pelo
   browser como fonte de verdade.

### 5. Reabertura de sign-off departamental

1. **Alerta, Notificação ou ambos?** Não cria tipo novo. Reabre o item normal
   e, se aplicável, o item crítico de prazo no mesmo agregado; cada transição
   inativo → ativo gera no máximo uma entrega por usuário elegível.
2. **Audiência?** Usuários ativos do departamento reaberto.
3. **Resolve e reabre como?** `signed_at` vigente resolve o item normal e o
   item de prazo; `signed_at = NULL` com seções resolvidas pode reabrir apenas o
   item normal, e com data-limite vencida reabre também o crítico. A RPC exige
   justificativa e audita `true → false`, como já define a migration 253.
4. **Unidade e chave?** ADR por terminal (ou ADR legado); item por origem e departamento dentro
   do agregado.
5. **Gravidade?** Normal para pendência; crítico para prazo já vencido.
6. **Detecção e frequência?** Reavaliação na RPC autorizada e cron server-only
   a cada 15 minutos. A reexecução deve ser idempotente e não fan-outar uma
   notificação repetida enquanto o item seguir ativo.

### 6. Fechamento e reabertura do ADR

1. **Alerta, Notificação ou ambos?** Nenhum tipo novo. O fechamento e a
   reabertura são transições do agregado existente e não notificações de
   sucesso.
2. **Audiência?** Nenhuma nova audiência. Itens existentes continuam sob a
   regra de seus departamentos.
3. **Resolve e reabre como?** O fechamento exige três sign-offs, congela o
   snapshot e reconcilia itens derivados; não tem prazo próprio. A reabertura
   exige justificativa administrativa, limpa o snapshot e preserva seções e
   sign-offs, conforme ADR 0030/migration 227. Só uma mutação de origem — por
   exemplo reabrir seção ou sign-off — pode reativar os itens correspondentes.
4. **Unidade e chave?** O mesmo agregado `voyageId::PORTO::TERMINAL` (ou a
   chave legada sem terminal); não criar entidade
   para o fechamento.
5. **Gravidade?** Não aplicável; não é alerta.
6. **Detecção e frequência?** RPC transacional na ação de fechamento/reabertura
   e varredura server-only de 15 minutos como reconciliação. Não reiniciar o
   relógio do SLA e não resetar assinaturas.

## Decisão de produto concluída

As ADRs fixam que uma seção pode ser reaberta com justificativa e que um
departamento só assina com todas as suas seções resolvidas. Para manter esse
invariante, quando uma seção for reaberta enquanto o sign-off do seu
departamento ainda estiver vigente, a mesma mutação deve invalidar
atomicamente o sign-off, registrar a justificativa e reavaliar os itens do
departamento. A nova assinatura só pode ocorrer depois que todas as seções
voltarem a estar resolvidas. A terceira alternativa permanece proibida.

| Alternativa | Consequência | Risco |
|---|---|---|
| Bloquear a reabertura da seção até o departamento reabrir seu sign-off | Mantém a assinatura válida e força a ordem explícita de auditoria | Duas ações para uma correção; pode travar uma correção legítima se a UI não explicar a dependência |
| **Reabrir a seção e invalidar atomicamente o sign-off do departamento (escolhida)** | Preserva o gate “todas as seções resolvidas” e reabre o item normal imediatamente | A ação de seção tem efeito departamental adicional; exige evento de auditoria e confirmação clara |
| Permitir ambas as situações sem mudar o sign-off | Menor mudança imediata | Permite ADR com seção pendente e sign-off vigente, contrariando o pré-requisito do fechamento e o cálculo do SLA |

O contrato de Alertas já está fechado independentemente: qualquer estado-fonte
que resulte em seção pendente deve reavaliar o item departamental, sem criar um
novo tipo. A dispensa, inclusive para o item crítico de prazo, segue a ADR 0050:
é temporária, exige data futura de revisão informada pelo operador, não tem
data padrão nem exceção por tipo e nunca resolve a origem.

## Critérios de aceite do contrato

- **524-AC-01:** cada ADR terminalizado possui no máximo um agregado
  `agency_departure_report / voyageId::PORTO::TERMINAL`; dois terminais do
  mesmo porto não colapsam. ADR legado conserva `voyageId::PORTO`.
- **524-AC-02:** `agency_report_department_pending` é normal, por departamento,
  resolve no sign-off vigente e não usa `assigned_to` como audiência.
- **524-AC-03:** `agency_report_deadline_missed` é crítico, independente da
  pendência, usa ATD + três dias úteis da migration 271 e resolve no sign-off
  vigente. Dispensa-se somente conforme a ADR 0050: com motivo, autor, data/hora
  e data futura de revisão, sem data padrão, dispensa indefinida ou exceção por
  tipo.
- **524-AC-04:** reabrir seção ou sign-off reutiliza os itens existentes; não há
  alerta por seção, por pessoa ou por tentativa do detector.
- **524-AC-05:** linhas abertas do legado são backfilladas sem apagar histórico,
  fechadas e não voltam a ser produtoras.
- **524-AC-06:** nenhuma notificação vai para Financeiro; a entrega é uma linha
  por usuário ativo do departamento do item e a leitura não altera o alerta.
- **524-AC-07:** detectores não dependem de `/alertas`, executam a cada 15
  minutos no servidor e não são chamados diretamente pelo `pg_cron` com
  `auth.uid()` ausente.
- **524-AC-08:** o destino leva diretamente a
  `/viagens/:voyageId?tab=adr&escala=PORTO&terminal=TERMINAL`, preferindo também
  `report=REPORT_ID` quando disponível.
- **524-AC-09:** escala `deleted` ou `omitted`, porto estrangeiro e ATD fora da
  baseline não criam item novo; sem ATD não há prazo.
- **524-AC-10:** a implementação preserva o dono `equipamentos` e o rótulo
  “Granito” de `carga_carregada`, conforme a migration 258 e o TypeScript atual;
  não reverte para a regra histórica da migration 253.
- **524-AC-11:** carga em transbordo conta no ADR do terminal da frente de
  descarga no Porto de Transbordo, separada da carga de destino final; COD não
  muda essa descarga física. Frente `TBC` bloqueia o fechamento.

## Fora desta etapa

- nenhuma alteração em código de produção;
- nenhuma edição de migrations históricas;
- nenhum detector novo que substitua o `271`;
- nenhum modelo concorrente de estado, reconhecimento, audiência ou
  escalonamento;
- nenhum redesenho geral do impresso. O impresso deve continuar refletindo o
  snapshot quando a implementação do bloco tocar essa superfície.
