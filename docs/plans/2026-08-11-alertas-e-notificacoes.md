# Alertas e notificações — catálogo decidido

**Status:** TODO
**Origem:** auditoria de alertas e notificações conduzida em 2026-08-11, decidida
caso a caso com o responsável do produto.

Este plano consolida as decisões. Ele não descreve o que existe hoje como se
fosse alvo: cada item diz o estado atual e a mudança acordada.

## Princípio adotado

Um estado só vira **pendência na fila** quando tem os três: ação clara,
responsável claro e momento objetivo de encerrar. Estado sem ação vira registro
histórico, não item de fila. Fila que acumula evento normal ensina a equipe a
ignorar a fila inteira — foi o critério que decidiu os casos abaixo.

Fechamento automático só quando a condição é verificável (saldo zerou, assinatura
existe, endereço mudou). Onde encerrar exige julgamento, o fechamento continua
manual, por decisão e não por omissão.

## Critérios de decisão por evento

Todo evento candidato responde às seis perguntas abaixo. Nenhuma pode ficar em
branco: resposta ausente vira decisão por omissão na implementação.

1. **Alerta, notificação ou ambos?** Alerta é item na fila `/alertas`, que espera
   ser tratado. Notificação é aviso ativo (sino), que interrompe. São coisas
   diferentes e um evento pode ser só uma delas.
2. **Departamento ou global?** A audiência do Evento Notificável é declarada
   numa regra central por tipo. O Alerta continua sendo uma pendência coletiva;
   a Notificação Interna é entregue individualmente aos usuários dos papéis
   definidos para aquele evento. `alerts.assigned_to` permanece sem uso, conforme
   o ADR 0034, até existir uma necessidade real de atribuição individual.
3. **Como fecha — e reabre?** Automático por condição verificável, ou manual por
   decisão. Se a condição volta a valer, reabre o mesmo item ou cria outro.
4. **Qual é a unidade?** Por B/L, por cliente, por viagem, por fatura, por
   transação. Decide se o evento produz um item ou centenas: A3 é por cliente e
   A4 é por viagem exatamente por isso, e A5 foi recusado por não ter unidade que
   sobrevivesse ao volume.
5. **Gravidade — crítico ou normal?** Alimenta a lista única consolidada por E1.
   Sem decisão por evento, o E1 centraliza uma lista que continua sendo só do
   Portal.
6. **Detecção — trigger ou cron?** Instantânea no banco, ou varredura agendada e
   com qual frequência. Não é detalhe de implementação: sem detecção
   independente da tela, o fato não existe enquanto ninguém olha — é o problema
   que o item E2 corrige.

Duas regras valem para todos e não são debatidas caso a caso:

- **Destino.** Toda pendência aponta para a tela onde a ação acontece. Pendência
  sem destino é beco sem saída.
- **Sem escalonamento por tempo.** Nenhum evento vira crítico por envelhecer. O
  único com relógio próprio é o prazo do ADR, que já tem regra explícita
  (migration 271). Escalonamento genérico antes de existir volume é máquina sem
  uso.

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

Estes três vêm primeiro: os demais dependem deles.

### E1 — Centralizar a lista de tipos críticos

A classificação de gravidade já existe, mas só no console de provisionamento, e
está **triplicada literalmente** em `196_portal_provisioning_console_read_model.sql:26`,
`197_portal_provisioning_console_fixes.sql:30` e
`198_portal_provisioning_queue_self_heal.sql:77`.

Extrair para um ponto único e fazer a fila `/alertas` consumir a mesma
definição, de modo que console e fila nunca discordem sobre o que é grave.
Fazer isso **antes** de E2, que adiciona um tipo à lista.

### E2 — Cron para os detectores que hoje dependem de alguém abrir a tela

`detect_agency_report_pending` e `detect_agency_report_deadline_missed` só rodam
no mount de `/alertas` (`src/pages/Alertas.tsx:53-59`); `detect_overdue_invoices`
só roda a partir do Faturamento (`src/services/alerts.ts:98`). Nenhum tem
agendamento — os `cron.schedule` existentes cobrem expiração de convite,
digest do Portal, pendências gerais do Portal e `mark_overdue_invoices`, que é
outra função.

Consequência atual: um prazo vencido não existe enquanto ninguém abre a tela, e
portanto não pode notificar. Agendar os três, seguindo o padrão do Portal, mas
sem chamar diretamente pelo `pg_cron` uma função que exige `auth.uid()`: a
implementação deve usar um wrapper server-only protegido ou uma invocação HTTP
autenticada. É pré-requisito de qualquer notificação por sino.

### E3 — Notificação Interna por destinatário, separada do Alerta

O ADR 0034 define que `alerts` é uma fila coletiva e que o sino precisa de uma
entidade separada, com uma linha por usuário destinatário e estado de leitura
individual. A audiência de cada tipo fica declarada num único registro de regras;
os produtores continuam apenas criando ou atualizando Alertas.

- A nova Notificação Interna congela o evento no momento da entrega e mantém
  `read_at` por usuário.
- O fan-out resolve os papéis internos definidos para o tipo e cria uma entrega
  por usuário ativo, com deduplicação idempotente.
- Ler a Notificação Interna nunca reconhece nem fecha o Alerta coletivo.
- `alerts.assigned_to` e `alerts.notified_at` permanecem sem uso; não são
  sobrecarregados para representar departamento ou entrega pessoal.

## Bloco A — Operacional

### A1 — B/L aguardando revisão → pendência + sino (Documentação)

Hoje é só um contador ao lado do menu Revisão. Vira pendência na fila com aviso,
fechando quando `review_status` sai de `pending_review`.

Motivos canônicos, de `compute_bl_review_pendencies`
(`188_review_gate_remove_portal.sql:6` — versão vigente): `Cliente nao vinculado`,
`Cliente sem e-mail cadastrado`, `Peso BB ausente` (só `carga_solta`).

### A2 — Taxa não calculada → pendência + sino (Faturamento)

Hoje é contador no menu do faturamento. Vira pendência identificando o B/L e o
motivo da trava. É o único caso do catálogo que impede dinheiro de entrar; o
valor está em ver o acumulado do que não pode ser faturado.

### A3 — Cliente sem e-mail → uma pendência **por cliente**

Não por B/L. A ação é uma só (cadastrar o e-mail) e a fila já trata e-mail como
trava de nível cliente (`revisaoHelpers.ts:98`). A pendência cita quantos B/Ls
dependem dela e fecha quando o contato é cadastrado.

Responsável: Documentação. **Bloqueado pela dependência externa acima.**

### A4 — Divergência Baplie → pendência por viagem

Hoje só aparece dentro da aba de relatório da viagem. Vira pendência com
navio/viagem no texto.

A trava de cobertura de rotas já existe e deve ser respeitada: só criar
pendência quando `reconcileBaplieWithManifest` retorna `source === 'reconciled'`
e `items.length > 0`. Nos estados `not_imported` e `awaiting_route_coverage`,
nada é criado — `hasCompleteBaplieRouteCoverage`
(`src/services/baplieReconciliation.ts:38`) exige que toda rota POL/POD do EDI
tenha ao menos um B/L importado.

Divergência aqui é só de **existência** (container no Baplie e em nenhum B/L, ou
o inverso). Flags físicas não geram divergência: o Baplie é soberano e
sobrescreve o B/L com auditoria.

### A5 — Conciliação de cliente → **não promover**

Permanece como aviso na ficha do cliente. É etapa obrigatória do fluxo: todo B/L
nasce pendente por definição e a contagem é por B/L, o que produziria centenas
de itens abertos por semana sem que nada esteja errado.

## Bloco B — Portal

Todos os cinco já existem e já gravam em `alerts`. As decisões são sobre
gravidade e fechamento.

| Tipo | Produtor | Fecha sozinho hoje |
|---|---|---|
| `portal_pendencia_geral` | `portal_refresh_general_pendencies()` (190) | Sim |
| `portal_convite_expirado` | cron 15 min (`181_portal_invite_expiry.sql`) | Não |
| `portal_falha_envio` | `supabase/functions/portal-invite-send/index.ts:45` | Não |
| `portal_email_suprimido` | `supabase/functions/portal-email-webhook/index.ts:30` | Não |
| `portal_abuso_login` | `supabase/functions/portal-login/index.ts:45` | Não |

### B1 — `portal_email_suprimido` entra na lista de críticos

Estava de fora por omissão. Um e-mail de recuperação suprimido (bounce
permanente ou complaint) deixa o cliente sem caminho de recuperação de senha —
mesmo efeito prático da falha de envio, que já é crítica. Depende de E1.

### B2 — Auto-fechamento onde a condição é objetiva

- `portal_convite_expirado` → fecha quando um novo convite é enviado.
- `portal_email_suprimido` → fecha quando o endereço muda ou sai da supressão.
- `portal_falha_envio` e `portal_abuso_login` → **continuam manuais**, por
  decisão: encerrar exige julgamento sobre a origem.

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

### C3 — Transação PIX órfã vira pendência persistida

Hoje `/reconciliacao` casa por TXID em memória e as transações sem documento
candidato (`src/services/reconciliacao.ts:150`) desaparecem ao fechar a tela —
`reconciliacao.ts` só lê, nunca persiste. É dinheiro recebido sem destino cujo
único rastro é a memória do operador.

Persistir as transações não casadas e abrir pendência por transação órfã,
fechando quando for conciliada.

Contexto que a implementação precisa respeitar: PIX exige quitação exata (o QR
tem valor fixo; divergência para mais ou menos é rejeitada — `111`), e demurrage
valida o valor contra as **duas** PTAX mais recentes até a data do pagamento,
porque o QR é estático e o cliente pode pagar com um de ontem (`158`, ADR 0015).

### C4 — Ações do cliente ganham fecho próprio

- `portal_dispute_opened` → fecha quando a disputa vai para `resolvido`; o
  trigger `notify_dispute_responded` já detecta essa transição.
- `portal_consolidation_obsoleted` → fecha quando uma nova consolidada é emitida
  ou o caso é tratado.

## Bloco D — Relatório de Agência (ADR)

O desenho atual está correto e não muda: a migration 225 trocou pendência por
seção por pendência **por departamento** (ADR 0029), fechando ao assinar; a 271
somou o alerta independente de prazo vencido (ATD da escala unificada + 3 dias
úteis), que fecha no Fechamento do ADR. Os dois convivem porque dizem coisas
diferentes.

### D1 — Encerrar o tipo legado `agency_report_section_pending`

Obsoleto desde a 225; nada mais o cria. Fechar as linhas antigas ainda abertas e
substituir o rótulo legado pelo tipo ativo
`agency_report_department_pending` em `src/pages/Alertas.tsx:31`, para a tela
continuar apresentando corretamente as pendências departamentais criadas pela
migration 225. O histórico das migrations preserva o registro legado.

## Limpeza colateral

Dois predicados da fila de revisão testam motivos que nenhum produtor grava:

- `groupNeedsPortal` (`src/pages/revisaoHelpers.ts:103`) procura
  `acesso ao portal nao provisionado`, removido do conjunto canônico pela 188.
- `needsCeMercante` (`src/pages/revisaoHelpers.ts:108`) procura `ce mercante`,
  que nenhum produtor jamais escreveu. O bloqueio por CE Mercante vive em
  `src/components/billing/validacaoPipeline.ts:120`, outra fila.

Remover junto com o bloco A, que já toca esse arquivo.

## Ordem sugerida

1. E1 → E2 → E3 (estrutural; E1 antes de B1)
2. Bloco D (D1 é isolado e pequeno)
3. Bloco B (B1 depende de E1)
4. Bloco C (C3 é o maior — persistência nova)
5. Bloco A (A3 bloqueado pela dependência externa; A1/A2/A4/A5 livres)
