# Bloco 3 — Financeiro: contrato funcional de alertas e notificações

**Issue:** #522, filha do épico #519
**Status:** decisão funcional aprovada; implementação pendente
**Escopo:** `/taxas-locais`, `/taxas-locais/tabelas`, `/demurrage`,
`/demurrage/taxas`, `/reconciliacao`, `/granito` e `/granito/taxas`

Este documento fecha as decisões do Bloco 3. Ele é um contrato para uma PR de
implementação posterior; não cria produtores, tabelas, migrations ou mudanças
de comportamento nesta etapa.

### Nota de integração após a PR #549

A operação de Taxas Locais passou a viver em `/taxas-locais`, enquanto o
cadastro de tabelas e overrides vive em `/taxas-locais/tabelas`. A rota
`/faturamento` permanece apenas como redirect compatível para deep links
legados. Essa reorganização de telas não altera a audiência: eventos de Taxas
Locais continuam sendo tratados por Documentação, e Financeiro permanece fora
do fan-out de Alertas/Notificações deste bloco.

## Princípios do contrato

- **Código:** `Aguardando CE` é estado normal e obrigatório depois que a
  cobrança está calculada, quando o CE Mercante ainda não está disponível. Não
  é alerta nem Notificação Interna.
- **Código:** a audiência Financeiro não recebe nenhum evento deste bloco.
  A diretriz sistêmica é que Financeiro só seria diretamente acionado por uma
  falha de subida da reconciliação PIX por mais de 12 horas; esse evento foi
  retirado do escopo por decisão posterior. Portanto, não há produtor
  financeiro previsto nesta spec.
- Eventos de **Taxas Locais** são de **Documentação**.
- Eventos de **Demurrage** são de **Equipamentos**.
- **Granito não participa do faturamento deste contrato.** O módulo permanece
  como apoio quantitativo operacional; não cria invoice, não exige vínculo de
  cliente, não depende do Portal e não produz Alerta ou Notificação Interna
  financeira.
- Um **Alerta** é um agregado global por entidade, identificado por
  `(entity_type, entity_id)`. Cada condição ativa é um item de pendência
  persistido dentro dele, com seu tipo, origem, departamento, destino, estado e
  histórico. Uma **Notificação Interna** é a entrega direcionada à união dos
  departamentos dos itens ainda ativos. Quando a matriz disser “ambos”, a mesma
  entidade alimenta os dois canais, sem criar dois alertas ou duas pendências
  duplicadas.
- A severidade é a da ocorrência, não uma escala que sobe genericamente com o
  tempo. Não existe escalonamento temporal genérico neste bloco.
- O fechamento de cada item precisa ser derivado do estado resolvido, e não de
  um clique que apenas oculte a ocorrência. O agregado só fecha quando não há
  item interno ativo. Se uma condição voltar, o mesmo agregado é reaberto com a
  lista corrente atualizada e o histórico preservado.

Na matriz e no catálogo, a coluna **Unidade** descreve a granularidade do item
de pendência. Ela não autoriza um novo alerta por invoice, BL ou transação
quando a entidade pai já possui um agregado ativo; condições simultâneas da
mesma entidade entram no mesmo alerta.

## Evidência do estado atual

| Decisão | Evidência | Consequência para a implementação |
|---|---|---|
| `Aguardando CE` não é falha | **Código:** `src/components/billing/validacaoPipeline.ts` separa `aguardando_ce` de `calculo_incompleto`; ADR 0041 e ADR 0042 tratam o estado como espera normal | Não chamar produtor de alerta/notificação ao entrar ou permanecer no estado |
| Falha de cálculo pode bloquear dinheiro | **Código:** `src/services/reviewBillingAutomation.ts` calcula a cobrança e registra `billing_auto_issue_failed` em falhas inesperadas; **Código:** `src/components/billing/validacaoPipeline.ts` expõe `review_status`, linhas de revisão e `billing_hold_reason` | Produzir o evento A2 somente após tentativa autoritativa que deixe uma pendência real |
| Demurrage não tem enforcement de atraso | **Código:** `supabase/migrations/157_demurrage_drop_overdue.sql` remove o enforcement; **Código:** `src/pages/Alertas.tsx` possui rótulo legado `demurrage`, mas não há produtor correspondente | Não transformar indicador, rótulo, free-time ou taxa em alerta |
| PIX órfão não persiste | **Código:** `src/services/reconciliacao.ts` cria linhas `unmatched`/`ambiguous` em memória; `confirmUnifiedPixReconciliation` envia somente matches seguros; não há insert de candidato sem correspondência | A implementação precisa persistir a ocorrência durante a importação e oferecer vínculo em `/reconciliacao` |
| PIX local exige exatidão | **Teste de contrato SQL:** `supabase/migrations/111_pix_exact_and_manual_overpayment_refunds.sql` exige `txid` normalizado e valor exato, com tolerância de R$ 0,01 | Vínculo manual não pode contornar a validação da liquidação |
| Demurrage usa janela financeira própria | **Código:** `docs/adr/0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md`; **Teste de contrato SQL:** `supabase/migrations/158_demurrage_pix_window_conciliation.sql` usa `txid`, duas PTAX mais recentes e data do pagamento, com quitação integral | Preservar o algoritmo atual; divergência não vira liquidação válida |
| Portal consolidado é escolha do cliente | **Código:** produtores `portal_invoice_created` e `portal_consolidation_obsoleted` existem nas migrations, mas o plano central os trata como histórico; não há ação interna necessária | Retirar Alerta/Notificação persistente e manter apenas histórico/auditoria |
| Granito está fora do faturamento | **Código:** `src/pages/Granite.tsx`, `src/services/graniteBillingWorkflow.ts` e `src/services/reviewBillingAutomation.ts` ainda contêm o caminho de emissão; **Decisão de produto:** esse caminho será retirado e Granito ficará como apoio quantitativo operacional | Não criar produtor, conciliação PIX, vencimento, emissão, vínculo de cliente/Portal ou alerta financeiro para Granito; a documentação operacional específica fica fora deste bloco |

## Matriz de decisão por tela

“Nenhum” é deliberado: significa que a tela não é produtora de uma ocorrência
do catálogo, mesmo que exiba indicadores, estados ou erros inline.

| Tela | Evento candidato | Decisão | Audiência | Unidade | Fechamento e reabertura | Detecção | Tela de correção |
|---|---|---|---|---|---|---|---|
| `/taxas-locais` | Tabela ativa ausente ou configuração insuficiente descoberta pela tentativa de cálculo | **Alerta + Notificação Interna** | Departamental: Documentação | BL / cobrança local | Fecha quando a configuração válida permite cálculo faturável ou isenção válida; reabre se o bloqueio voltar | Ação/RPC de cálculo autoritativo | `/taxas-locais/tabelas` para tabela/configuração; `/taxas-locais` quando a configuração está correta e o problema é outro |
| `/taxas-locais/tabelas` | Criar, editar, inativar tabela; aviso de validade ou sobreposição | **Nenhum** | — | — | — | Ação normal de manutenção | A própria tela, sem ocorrência |
| `/taxas-locais` | Cálculo local bloqueado após tentativa autoritativa, impedindo dinheiro faturável | **Alerta + Notificação Interna** | Departamental: Documentação | BL / cobrança local | Fecha quando há cálculo faturável válido ou isenção válida; reabre se `review_status`, `billing_hold_reason` ou linhas inválidas voltarem | Ação/RPC; cron é somente backstop se o contrato central assim permitir | `/taxas-locais` |
| `/taxas-locais` | Falha inesperada na emissão automática local | **Alerta + Notificação Interna** | Departamental: Documentação | BL | Fecha após emissão bem-sucedida ou correção operacional comprovada; reabre na próxima falha da mesma unidade | Ação de emissão automática | `/taxas-locais` |
| `/taxas-locais` | Invoice local vencida com saldo | **Alerta + Notificação Interna** | Departamental: Documentação | Invoice | Fecha com saldo zero/pagamento; reabre se pagamento for revertido ou o saldo voltar a vencer | Cron diário | `/taxas-locais` |
| `/taxas-locais` | Exceção crítica de Portal na emissão da invoice (`portal_excecao_critica_fatura`, propriedade do #521) | **Nenhum neste bloco** | — | — | A implementação do #521 mantém o item no B/L agregado, com referência à invoice; este bloco não duplica o evento por invoice | Produtor e reprocessamento do #521 | `/manifestos/{blId}?tab=faturamento`, conforme o #521 |
| `/taxas-locais` | `Aguardando CE` local | **Nenhum** | — | — | — | Mudança normal de estado | `/taxas-locais`, como operação normal |
| `/taxas-locais` | Fatura consolidada criada ou tornada obsoleta pelo Portal | **Nenhum** | — | — | — | Evento de histórico do Portal | Portal/histórico; não há correção interna |
| `/taxas-locais` | Falha transitória de pagamento manual ou bloqueio de cancelamento (`invoice_payment_invalid`, `invoice_cancel_blocked`) | **Nenhum** | — | — | — | Ação/guard de interface | Feedback da própria ação; não persistir ocorrência de trabalho |
| `/demurrage` | Disputa de invoice aberta no Portal | **Alerta + Notificação Interna** | Departamental: Equipamentos quando a próxima ação for interna | Invoice Demurrage | Item interno existe somente enquanto a próxima ação for de Equipamentos; ao aguardar o cliente ou resolver, sai da lista corrente; volta a ser criado/reaberto quando a próxima ação retornar a Equipamentos | Trigger/ação na mudança da próxima ação, conforme o contrato do #521 | `/demurrage` |
| `/demurrage` | Contagem de vencidos, free-time, container não devolvido ou ausência de invoice | **Nenhum** | — | — | — | Indicador operacional e estado do módulo | `/demurrage`, sem ocorrência |
| `/demurrage` | Taxa ausente, PTAX fora da janela ou falha inline de cálculo | **Nenhum** | — | — | — | Ação/validação inline | `/demurrage` ou `/demurrage/taxas`, sem alerta neste bloco |
| `/demurrage/taxas` | Criar, editar ou inativar taxa Demurrage | **Nenhum** | — | — | — | Ação normal de manutenção | A própria tela, sem ocorrência |
| `/reconciliacao` | PIX sem conciliação segura: sem invoice candidata, `txid` duplicado, candidato com valor divergente ou outra ambiguidade que impeça confirmação segura | **Alerta + Notificação Interna** | Departamental: Documentação **e** Equipamentos | Linha persistida de transação PIX; `txid` normalizado quando houver | Fecha somente após vínculo válido e liquidação confirmada; reabre se o vínculo for removido ou invalidado | Importação server-side do extrato, imediatamente após a persistência; não depende de abrir a tela | `/reconciliacao` |
| `/reconciliacao` | Upload e leitura bem-sucedidos do extrato, sem linhas inseguras | **Nenhum** | — | — | — | Ação normal de importação | `/reconciliacao`, sem ocorrência |
| `/granito` | Apoio quantitativo operacional, inclusive ausência de taxa, CE, cliente ou erro inline | **Nenhum** | — | — | — | Estado/ação operacional; não há faturamento a monitorar | `/granito`, sem ocorrência financeira |
| `/granito/taxas` | Manutenção ou consulta de dados de apoio do Granito | **Nenhum** | — | — | — | Ação normal de manutenção | `/granito/taxas`, sem ocorrência financeira |

## Catálogo dos eventos ativos

### A2 — cálculo bloqueado por pendência financeira real

O evento só existe depois de uma tentativa de cálculo que tenha evidência de
que a cobrança deveria ser calculada e que deixou uma pendência persistida,
como `review:no_table`, `review_status=pending_review`, linhas inválidas,
`billing_hold_reason` ou ausência de valor faturável quando essa ausência é
inesperada. Não se aplica a `Aguardando CE`, `sem_cliente` do fluxo de revisão
do #520, isenção válida ou manutenção informativa da tabela.

- Tipo: Alerta + Notificação Interna.
- Audiência: Documentação; nenhuma entrega direta para Financeiro.
- Unidade: BL/cobrança local.
- Gravidade: **Crítico**, porque impede dinheiro de entrar no faturamento.
- Detecção: ação/RPC de cálculo; eventual cron é apenas mecanismo de
  recuperação definido pela fundação, não o produtor primário.
- Fechamento: cálculo faturável válido ou isenção válida. Reabertura: a mesma
  causa volta a bloquear a unidade.
- Correção: `/taxas-locais/tabelas` para tabela/configuração; `/taxas-locais`
  para revisão de cálculo ou correção operacional.

### Falha de emissão automática

Abrange `billing_auto_issue_failed` somente para o fluxo local quando uma
emissão automática realmente falha. Granito não tem faturamento neste contrato
e, portanto, não participa deste evento. O retorno normal `awaiting_flow` por CE
ausente, revisão pendente, cliente ausente ou ausência de valor prevista também
não é ocorrência financeira.

- Tipo: Alerta + Notificação Interna.
- Audiência: Documentação.
- Unidade: BL local.
- Gravidade: **Crítico**.
- Detecção: ação de emissão automática.
- Fechamento: emissão bem-sucedida ou resolução operacional verificável;
  reabertura na próxima falha.
- Correção: `/taxas-locais`.

### Invoice vencida

Aplica-se somente às invoices locais com saldo vencido. Granito não gera
faturamento neste contrato. Não se aplica às invoices Demurrage, cujo
enforcement de atraso foi removido.

- Tipo: Alerta + Notificação Interna.
- Audiência: Documentação.
- Unidade: invoice local.
- Gravidade: **Normal**; não há promoção genérica por idade.
- Detecção: cron diário server-side, por wrapper protegido conforme E2 do
  catálogo central; não depende de abrir `/taxas-locais`.
- Fechamento: saldo zero/pagamento; reabertura se a liquidação for revertida
  ou a invoice voltar a ficar vencida.
- Correção: `/taxas-locais`.

### PIX sem conciliação segura

O evento cobre tanto o órfão estrito quanto uma linha conhecida que não pode
ser confirmada com segurança. A importação deve manter a identidade da
transação pelo `txid` e registrar o motivo operacional suficiente para o
usuário escolher ou corrigir a invoice. A regra de vínculo não pode virar uma
conciliação arbitrária:

- local: `txid` normalizado e valor exato, dentro da tolerância de R$ 0,01;
- Demurrage: `txid` identificado, invoice compatível com as duas PTAX mais
  recentes aplicáveis à data do pagamento, e quitação integral;
- Granito não participa: não há invoice Granito, vínculo de cliente/Portal ou
  candidato Granito neste fluxo;
- qualquer confirmação continua sujeita às RPCs e invariantes das migrations
  financeiras existentes.

Quando o `txid` não puder ser normalizado, ele não pode ser usado sozinho como
`entity_id`: a persistência deve atribuir identidade própria a cada linha
recebida e guardar também data, valor, txid bruto/normalizado (quando houver) e
motivo. Mesmo um `txid` normalizado repetido é uma ambiguidade que precisa
preservar as linhas distintas, usando identidade da linha e da importação para
idempotência; reprocessar o mesmo extrato não pode duplicar, e transações
distintas sem `txid` não podem colidir no mesmo item.

- Tipo: Alerta + Notificação Interna.
- Audiência: Documentação e Equipamentos; é uma pendência compartilhada para
  que qualquer um dos dois departamentos possa resolvê-la.
- Unidade: uma linha de transação PIX persistida; o `txid` normalizado é a
  chave de busca quando existir, mas a identidade persistida da linha continua
  própria para tratar duplicidade, ausência ou invalidez do `txid`.
- Gravidade: **Crítico**, porque o dinheiro recebido não está associado a um
  documento conciliável.
- Detecção: importação server-side do extrato, imediatamente após a persistência;
  não depende de abrir `/reconciliacao`.
- Fechamento: vínculo válido seguido de liquidação confirmada. Reabertura:
  vínculo removido, inválido ou novamente incapaz de ser confirmado.
- Correção: `/reconciliacao`, com ação explícita de vincular à invoice do
  sistema ou corrigir a escolha.

### Disputa de invoice Demurrage

É a única ocorrência Demurrage ativa neste bloco. O produtor existente
`portal_dispute_opened` deve ser direcionado para a unidade `demurrage_invoice`
e seguir o contrato do #521: o item de trabalho interno existe somente quando a
próxima ação é de Equipamentos. Enquanto a próxima ação for do cliente, a
conversa permanece acompanhável, mas não há cobrança interna ativa. A rota de
correção é `/demurrage`.

- Tipo: Alerta + Notificação Interna.
- Audiência: Equipamentos enquanto a próxima ação for interna.
- Unidade: invoice Demurrage.
- Gravidade: **Normal**.
- Detecção: trigger/ação na abertura e na mudança da próxima ação da disputa,
  conforme o contrato do #521.
- Fechamento: a mudança da próxima ação para o cliente ou a resolução fecha o
  item interno; a volta da próxima ação para Equipamentos reabre o mesmo item e
  o mesmo agregado, preservando o histórico.
- Correção: `/demurrage`.

## Decisões explícitas de “nenhum evento”

As seguintes situações não devem produzir Alerta nem Notificação Interna no
Bloco 3:

1. `Aguardando CE` local; estados equivalentes exibidos no apoio quantitativo
   do Granito também não são eventos financeiros.
2. Criação ou obsolescência de fatura consolidada do Portal: é escolha do
   cliente e não existe ação interna.
3. Indicador de Demurrage, atraso/free-time, container não devolvido ou
   ausência de invoice, respeitando ADR 0034 e o estado atual documentado em
   `docs/modules/demurrage.md`.
4. Taxa Demurrage ausente, PTAX fora da janela ou erro inline de cálculo, sem
   ADR nova que promova a condição a ocorrência.
5. Manutenção informativa de tabelas locais ou taxas Granito.
6. `sem_cliente` e revisão de cliente pertencentes ao fluxo do #520, para não
   duplicar a responsabilidade de Documentação.
7. Falha transitória de pagamento manual e cancelamento bloqueado, que são
   guards da ação e não trabalho pendente.
8. Upload/leitura de extrato bem-sucedidos sem transação insegura.
9. Apoio quantitativo do Granito, inclusive dados de taxa, CE, cliente ou
   contagem operacional: não há faturamento nem alerta financeiro.

## Invariantes financeiras que não podem ser alteradas

- Quitação é integral: não marcar invoice como paga por associação parcial ou
  por soma aproximada fora da tolerância contratada.
- A identificação primária do PIX é o `txid` normalizado.
- Local Charge usa a regra de valor exato da migration 111, com tolerância de
  R$ 0,01.
- Demurrage usa as duas PTAX mais recentes disponíveis até a data do
  pagamento, a própria data do pagamento e o `txid`, conforme ADR 0015 e
  migration 158.
- Demurrage continua em sua persistência própria; não criar uma falsa tabela
  de ledger unificado para fazê-la caber no fluxo local.
- Granito não cria invoice, não participa da reconciliação PIX e não exige
  vínculo de cliente ou Portal neste bloco.
- Um alerta ou notificação nunca substitui a confirmação financeira nem
  libera uma invoice por si só.

## Dependências e bloqueios

### BLOCKED — fundação de Notificações Internas

A entrega dupla exige a fundação transversal do plano central de alertas,
especialmente E3/PR #517. O `main` atual tem leitura e produtores de `alerts`,
mas não oferece, por si só, o contrato final de persistência/entrega de
Notificações Internas. A implementação do Bloco 3 fica **BLOCKED** para a parte
de Notificações Internas até que a PR #517 seja mergeada e seu schema/RPCs
sejam validados. Não inventar tabela ou migration de notificação no Bloco 3.

### Dependência coordenada — revisão de cliente (#520)

O fluxo de cliente ausente/revisão permanece no bloco #520. A implementação
financeira deve consumir o estado real desse fluxo e não criar uma segunda
ocorrência para a mesma causa. Isso é uma dependência de integração, não um
bloqueio das decisões deste documento.

### Sem dependência de PR #518

Como Granito não gera faturamento nem exige vínculo de cliente/Portal neste
bloco, sua documentação de apoio quantitativo não depende da PR #518. O fluxo
de revisão de cliente que permanece ativo é o de B/Ls do #520.

## Critérios de aceite da implementação posterior

- Cada linha “Alerta + Notificação Interna” tem produtor observável, audiência,
  unidade, severidade, fechamento, reabertura e destino conforme esta spec.
- Cada linha “Nenhum” não cria ocorrência persistente, inclusive os rótulos
  legados de Demurrage e os retornos normais de `Aguardando CE`.
- Um PIX órfão permanece visível após o fim da tela/importação e pode ser
  resolvido em `/reconciliacao`; não é possível confirmar pagamento violando
  `txid`, valor, PTAX, data ou quitação integral.
- Invoices locais vencidas são detectadas por cron server-side e Demurrage não
  entra nesse detector; Granito está fora por não gerar faturamento.
- Produtores atuais de consolidação do Portal e de guards transitórios deixam
  de criar pendência de trabalho, preservando histórico técnico quando
  necessário.
- A navegação do alerta `portal_dispute_opened` para uma invoice Demurrage é
  resolvível em `/demurrage`.
- A implementação não encerra #522 até que código, verificação e documentação
  de entrega estejam completos.
