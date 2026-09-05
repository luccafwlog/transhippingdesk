# Auditoria de mensageria, disparo de comunicados e automação de cobrança — 2026-09-05

Documento histórico. Retrata o estado do repositório em `bdf2241` (merge da
PR #653). Não é fonte de verdade corrente: em caso de divergência com o
código, o código manda.

Escopo auditado: `send-customer-communication`, `demurrage-dunning`,
`customer-communication-auto-runner`, `portal-email-webhook`,
`_shared/email.ts`, `_shared/portalBounceCascade.ts` e as RPCs
`claim_demurrage_dunning_candidates`, `create_customer_communication_atomic`,
`customer_communication_recipient_allowed`,
`repair_customer_contact_box_fallbacks`.

Decisões de referência: ADR 0058 (canal separado), ADR 0059 (chave global),
ADR 0064 (caixas de comunicação).

## Sumário dos achados

| # | Achado | Severidade | Vetor |
| --- | --- | --- | --- |
| [A1](#a1) | Fallback de caixa religa contato puramente operacional em `financeiro`/`demurrage` | **Alta** | Caixas |
| [A2](#a2) | Evento de bounce do Resend pode ser perdido permanentemente (dedup antes da resolução) | **Alta** | Pipeline |
| [A3](#a3) | Régua reclama eternamente faturas cujo cliente não tem contato em caixa elegível; starvation do lote | **Alta** | Régua |
| [A4](#a4) | Comunicado realmente enviado fica gravado como `simulado` | **Média-alta** | Auditoria |
| [A5](#a5) | `idempotency_key` guarda o e-mail em claro ao lado do `recipient_masked` | **Média** | Auditoria |
| [A6](#a6) | Sem teto por cliente: N faturas × M contatos no mesmo ciclo | **Média** | Spam |
| [A7](#a7) | Notificação de bounce ao cliente escapa da chave global | **Média** | Chave global |
| [A8](#a8) | Índice de idempotência de `customer_communications` inclui coluna mutável `status` | **Baixa (latente)** | Duplicidade |
| [A9](#a9) | Porta de opt-out da régua lê tabela morta (`customer_contact_preferences`) | **Baixa** | Régua |

## Vetor 1 — Trava global e governança

**Veredito: a trava se sustenta no caminho de Comunicado. Existe uma escapada
adjacente (A7), fora do canal.**

O canal inteiro tem um único ponto de saída para o provedor:
`supabase/functions/_shared/email.ts:79` é o único `fetch` para
`api.resend.com` em todo o repositório. Os três consumidores chegam nele assim:

- `send-customer-communication/index.ts:475-492` lê
  `app_settings.communications_enabled` e passa `resendApiKey: enabled ? key : null`;
- `demurrage-dunning/index.ts:260` faz o mesmo (`communicationsEnabled ? key : null`);
- `customer-communication-auto-runner` não fala com o Resend: delega por HTTP
  para `send-customer-communication` (`index.ts:103`), herdando a trava.

Com `resendApiKey` nulo, `sendEmail` grava a tentativa e retorna em dry-run
(`email.ts:66-69`) antes de qualquer I/O de rede. Não há caminho que envie com
a chave desligada.

O fail-safe também está correto nas duas leituras, por motivos diferentes:
`send-customer-communication` usa `.single()` (linha 411) — ausência da linha
`app_settings id=1` vira erro e 500; `demurrage-dunning` usa `.maybeSingle()`
(linha 373) — ausência vira `null` e `Boolean(undefined) === false`. Os dois
degradam para "não enviar". O seed nasce `false`
(`002_business_logic_and_security.sql:31216`) e a coluna é
`DEFAULT false NOT NULL` (`001_initial_schema.sql:472`), como manda a ADR 0059.

A escrita é guardada no servidor por `set_communications_enabled`, que exige
papel `administrativo` e grava em `audit_logs` — conforme a ADR 0059 e coberto
por `comunicadosFundacaoMigration.test.ts:42-43`.

<a id="a7"></a>
### A7 — Notificação de bounce ao cliente escapa da chave global (Média)

`portal-email-webhook/index.ts:134` envia a notificação de bounce ao contato
alternativo do cliente via `sendPortalEmail`, que lê `RESEND_API_KEY`
incondicionalmente (`_shared/portalEmail.ts:28`). Com
`communications_enabled = false`, um contato de cliente recebe um e-mail real.

A ADR 0059 enumera as isenções da chave: "convite, reenvio, recuperação de
senha e alteração de email". Notificação de bounce não está na lista, e o
gatilho dela é justamente um Comunicado que quicou. Em ambiente de
desenvolvimento com a chave desligada — o cenário que a ADR 0059 existe para
proteger — um bounce de teste dispara e-mail a cliente real.

Não é uma falha de implementação da trava; é uma lacuna de escopo entre a ADR
0059 e um caminho de e-mail criado depois dela. A correção é uma decisão de
produto: ou a notificação de bounce entra na lista de isenções (e a ADR 0059
é emendada dizendo por quê), ou ela passa a respeitar a chave.

## Vetor 2 — Resiliência da régua de Demurrage

Cron horário confirmado: `0 * * * *`
(`007_cron_secrets_no_vault.sql:229`). Cadência padrão de 7 dias
(`app_settings.demurrage_dunning_interval_days`).

### Reenvio múltiplo no mesmo dia: protegido, com três camadas

1. **Claim pessimista.** `claim_demurrage_dunning_candidates` insere em
   `demurrage_dunning_claims (invoice_id, attempt_discriminator)` com
   `ON CONFLICT ... DO UPDATE ... WHERE released_at IS NOT NULL`, e só emite o
   candidato se `ROW_COUNT = 1`. Duas execuções simultâneas não pegam a mesma
   fatura. O `FOR UPDATE OF di SKIP LOCKED` reforça.
2. **Porta de cadência.** `attempt_discriminator = attempt_count + 1`, onde
   `attempt_count` conta claims **não liberados**. O claim de um envio
   bem-sucedido nunca é liberado (o handler só libera em `falha`/`pausado`),
   então a fatura só reaparece quando
   `now >= first_billed_at + intervalo × attempt_count`.
3. **Idempotência por destinatário.** `demurrage:{invoice}:{disc}:{email}` é
   `UNIQUE` em `customer_communication_attempts.idempotency_key`
   (`001_initial_schema.sql:4795`). Numa reclamação com o mesmo discriminador,
   `recordAttempt` recebe 23505, devolve a tentativa existente, e `sendEmail`
   corta antes do POST se já houver `provider_message_id`
   (`email.ts:74`). O header `Idempotency-Key` no Resend é a rede final.

A reaper de 30 minutos (`claim_...:3484-3495`) libera claims órfãos só quando
não existe comunicado `enviado`/`simulado` para aquele par — correta em
intenção, mas ver A4 e A8 sobre a fragilidade de usar `status` como sinal.

**Conclusão: não há reenvio duplicado ao mesmo destinatário no mesmo dia.** O
risco de volume é outro e está em A6.

<a id="a3"></a>
### A3 — Loop horário perpétuo e starvation do lote (Alta)

Os dois lados da elegibilidade discordam:

`claim_demurrage_dunning_candidates` (`002:3515-3521`) exige apenas que exista
um `customer_contacts` do cliente com e-mail válido e não suprimido. **Não
filtra `deactivated_at` e não olha `customer_contact_box_links`.**

`loadRecipients` (`demurrage-dunning/index.ts:116-160`) exige
`deactivated_at IS NULL` **e** vínculo com a caixa `financeiro` ou `demurrage`.

Consequência para um cliente cujos contatos ativos estão vinculados só a
`documentacao_operacao` — cenário comum, porque `ensure_customer_contact_email`
(ADR 0064 §6) adiciona **apenas** `documentacao_operacao` a contatos
auto-capturados que não sejam o primeiro principal:

1. A RPC reclama a fatura e insere o claim;
2. `loadRecipients` devolve zero contatos → `sendCandidate` retorna `pausado`
   (`index.ts:234`);
3. O handler libera o claim (`index.ts:396`);
4. `attempt_count` volta a zero, a porta de cadência
   (`now >= first_billed_at + intervalo × 0`) reabre;
5. Hora seguinte, tudo de novo. **Para sempre.**

Nenhum e-mail sai — não é um vetor de spam ao cliente. O dano é outro e é
pior: `ORDER BY di.id LIMIT 50`. Faturas-zumbi com `id` baixo ocupam vagas do
lote em toda execução. Passando de 50 zumbis, **a régua para de cobrar
faturas legítimas em silêncio**, sem erro, sem alerta, com HTTP 200 e
`paused: 50` no corpo da resposta que ninguém lê.

Correção recomendada: alinhar o `EXISTS` da RPC ao critério real de
`loadRecipients` (contato ativo **com vínculo em `financeiro` ou `demurrage`**).
Isso resolve o loop e o starvation de uma vez, no ponto compartilhado. Como
paliativo independente, abrir alerta interno quando `paused > 0` persiste para
a mesma fatura em ciclos consecutivos.

### Critérios de pausa: corretos, com um detalhe

`demurrage_dunning_candidate_sendable` (`002:5762`) revalida `status IN
('issued','overdue') AND paid_at IS NULL AND dispute_open = false`, e é chamado
**duas vezes**: antes do lote de contatos (`index.ts:232`) e **antes de cada
destinatário** (`index.ts:267`). Isso é bom — fecha a janela TOCTOU entre o
claim e o envio.

Disputa aberta, fatura paga e bounce ativo pausam corretamente. "Cliente sem
contato válido" pausa na Edge Function, mas não na RPC — é exatamente A3.

## Vetor 3 — Ciclo de vida das caixas (ADR 0064)

### Segregação no caminho normal: respeitada

`customer_communication_recipient_allowed` (`008:1318`) é a guarda de servidor.
Ela reprova contato desativado, e-mail nulo, e-mail malformado, suprimido por
`bounce_permanente` (compartilhado, ADR 0058) ou por `complaint` de Comunicado,
e — o ponto da ADR 0064 — exige vínculo explícito com a caixa alvo ou com
alguma caixa que mapeie o `kind`. `send-customer-communication:402` a invoca
antes de qualquer registro ou envio. A régua faz o equivalente em SQL
(`loadRecipients`, restrito a `financeiro`/`demurrage`).

Um comunicado financeiro **não** vaza para um contato puramente operacional
por este caminho.

<a id="a1"></a>
### A1 — Mas vaza pelo fallback de reparo (Alta)

`repair_customer_contact_box_fallbacks` (`008:1131`) tem duas ramificações
quando uma caixa fica sem destinatário elegível:

- religa o **contato principal ativo** (`008:1218-1231`) — é o que a ADR 0064 §7
  autoriza: *"vincula o contato principal ativo àquela caixa como fallback"*;
- se não houver principal elegível, religa **qualquer contato ativo**
  (`008:1242-1256`), com `LIMIT 1` **e sem `ORDER BY`**.

A segunda ramificação não está na ADR. E o efeito dela é concreto: um contato
cadastrado deliberadamente só em `documentacao_operacao` — um despachante, um
terminal, um operador de armazém, um terceiro que não é o cliente — passa a
receber **cobrança de Demurrage e CE/Taxas** do cliente. É vazamento de dado
financeiro para fora da relação comercial, disparado por um evento automático
(bounce permanente do principal), sem revisão humana e sem sinal na tela.

Agravante: sem `ORDER BY`, o contato escolhido é o que o planner devolver. O
mesmo cliente pode receber substitutos diferentes em execuções diferentes, o
que torna o comportamento não reproduzível em investigação.

O caminho de acionamento é real e curto:
`portal-email-webhook:378` chama a RPC para todo `customerId` afetado por
bounce permanente, **antes** da cascata de notificação.

Correção recomendada, em ordem de preferência:

1. Remover a ramificação de substituto para as caixas `financeiro` e
   `demurrage`. Ficar sem destinatário financeiro é um fato operacional que
   merece triagem humana — que já existe: o alerta `caixa_sem_destinatario`
   (`008:1268`). Manter o substituto só para `documentacao_operacao`, se a
   equipe julgar que cobertura operacional vale mais que precisão de
   roteamento.

   O próprio código já assume esse desfecho. O comentário de invariante em
   `008_portal_contact_boxes.sql:681-683` diz, sobre
   `_apply_customer_contact_configuration`: *"O repair() deliberadamente
   permite caixa bloqueada vazia; este nucleo nao pode contradize-lo."*
   Caixa vazia com alerta já é um estado aceito e desenhado. Remover a
   ramificação de substituto para as caixas financeiras não introduz um estado
   novo — apenas deixa de trocar um estado já previsto e visível (caixa vazia,
   alerta aberto) por um estado invisível e pior (cobrança endereçada a um
   terceiro).
2. Se a ramificação ficar, restringi-la a contatos que já tenham vínculo com
   **alguma** caixa da mesma família e dar-lhe `ORDER BY id` para ser
   determinística.

Em qualquer dos casos, a ADR 0064 §7 precisa ser emendada para descrever o
comportamento real — hoje ela descreve só metade da função.

### Loops de bounce: contidos

O quebra-loop está em `portal-email-webhook:344`:
`permanentBounce && portalAttempt?.kind !== BOUNCE_NOTIFICATION_KIND`. Se a
própria notificação de bounce quicar, a cascata não roda de novo.

A convergência do segundo salto também está garantida, por um caminho
diferente: quando A quica, A entra em `portal_suppressed_emails` **antes** da
cascata (`index.ts:294`); se depois B quicar, `isValidAlternative`
(`portalBounceCascade.ts:31-38`) exclui A por `portalSuppressedEmails`. O
conjunto de alternativas só encolhe. Não há ciclo.

`openNoAlternativeAlert` usa `upsert_alert_item` e `openAlertOnce` — sem
enxurrada de alertas repetidos.

**Não há loop infinito.** Este vetor está sólido.

## Vetor 4 — Auditoria e logs

### Toda tentativa gera registro: sim

`recordAttempt` é chamado por `sendEmail` (`email.ts:64`) **antes** de decidir
entre dry-run e POST, e antes de qualquer I/O com o provedor. Não existe envio
sem linha em `customer_communication_attempts`. A janela de crash entre
persistência e chamada HTTP está tratada e comentada em `email.ts:71-75`:
`aceito` só é terminal com `provider_message_id`.

<a id="a4"></a>
### A4 — Comunicado enviado gravado como `simulado` (Média-alta)

`create_customer_communication_atomic` insere com `status = 'simulado'`
(`002:4347`) — o mesmo valor que a ADR 0059 reserva para "registrado, nada
saiu". O estado inicial e o estado terminal simulado são indistinguíveis.

Em `demurrage-dunning/sendCandidate`, o `status` real só é gravado na linha
333, no fim da função. Dois caminhos saem antes dela **depois** de já ter
enviado e-mail:

- **Pausa no meio do laço** (`index.ts:267`): contato 1 recebe e-mail real,
  disputa é aberta ou a fatura é paga, contato 2 revalida e a função retorna
  `pausado`. O `update` da linha 333 nunca roda.
- **Exceção na revalidação** (mesma linha 267): a chamada está **fora** do
  `try` que começa na linha 270. Um erro transitório de rede na RPC propaga
  para o `catch` do handler (`index.ts:402`), que conta `failed` e libera o
  claim — sem tocar no `status`. Este é o gatilho provável, e não depende de
  nenhuma corrida improvável.

O registro fica `simulado`. Pior, é **permanente** no primeiro caso: com
`dispute_open = true` ou `paid_at` preenchido, a fatura nunca mais é reclamada,
então nada corrige a linha depois.

Isso contraria diretamente a ADR 0059: *"o histórico passa a conter comunicados
que nunca saíram; eles são marcados, e qualquer leitura precisa distinguir
enviado de simulado"*. A distinção existe no papel e falha no registro. Numa
régua de cobrança, "provamos que notificamos" é o produto — e o banco diz que
não notificamos.

Correção recomendada: separar o estado inicial do terminal. Um valor
`pendente` no `CHECK` de `customer_communications_status_check`, gravado pela
RPC, e a transição para `enviado`/`simulado`/`falha` num `finally`. Isso torna
a inconsistência visível (linhas presas em `pendente`) em vez de silenciosa, e
dá à reaper de 30 minutos um sinal honesto para trabalhar.

<a id="a5"></a>
### A5 — E-mail em claro ao lado do campo mascarado (Média)

`customer_communication_attempts` guarda `recipient_masked`
(`j***@e***.com`, via `maskEmail`) e, na coluna vizinha,
`idempotency_key = 'demurrage:{invoice}:{disc}:joao@empresa.com'` — o endereço
completo, em texto puro. A tabela tem `GRANT SELECT ... TO authenticated` com
policy `is_active_read_user()` (`002:24980,30643`): o mesmo público lê as duas
colunas.

O mascaramento não protege nada, e cobra caro: `maskEmail` não é injetivo.
`joao@empresa.com` e `jose@empresa.com` colapsam em `j***@e***.com`. Pela
coluna que deveria ser a trilha de auditoria, é impossível dizer qual dos dois
contatos recebeu a cobrança.

E a ADR 0064 §8 aponta exatamente para essa trilha como fonte de auditoria:
*"a trilha `customer_communications` + tentativas é a fonte de auditoria do que
foi enviado"*. Ela não consegue responder "para quem".

É preciso escolher um dos dois lados, não ficar nos dois:

- **Se a auditoria manda** (é o que a natureza de cobrança sugere): gravar
  `contact_id` na tentativa. Resolve a identificação sem expor endereço a mais
  do que já está exposto, e sobrevive à troca de e-mail do contato.
- **Se a minimização manda**: derivar a `idempotency_key` de um hash do
  endereço, não do endereço. Aí o mascaramento passa a valer alguma coisa —
  mas a trilha continua sem responder "para quem", e a ADR 0064 §8 precisa
  reconhecer isso.

A recomendação é a primeira: `contact_id` na tentativa, e a `idempotency_key`
derivada de `contact_id` em vez do endereço.

## Diagnóstico de risco: spam e envios duplicados

**Duplicidade ao mesmo destinatário: risco baixo.** Três camadas independentes
(claim, `idempotency_key` único, header `Idempotency-Key` do Resend), e o
corte antecipado em `email.ts:74` quando já há `provider_message_id`. Não
encontrei caminho que entregue o mesmo comunicado duas vezes ao mesmo
endereço.

<a id="a6"></a>
### A6 — Volume por cliente, sem teto (Média)

O que não existe é controle de **volume agregado**. A cadência é por fatura
(`di.id`), nunca por cliente. `docs/modules/demurrage.md:203` registra a
ausência de teto como decisão consciente ("sem teto") — o que torna isto um
risco aceito, não um defeito. Mas o risco merece ser dimensionado:

- Cliente com 12 faturas de Demurrage em aberto e 3 contatos na caixa
  `financeiro` recebe **36 e-mails na mesma execução horária**, todos do mesmo
  remetente `portal@`, todos sobre cobrança.
- O lote é de 50 faturas por ciclo, então o pico teórico por hora é
  50 × (contatos por cliente).
- Não há atraso entre destinatários nem entre candidatos: o laço de
  `demurrage-dunning:266` dispara em sequência, sem pausa.

Trinta e seis e-mails idênticos em estrutura, na mesma hora, do mesmo domínio
é um padrão que filtros anti-spam classificam mal. A ADR 0058 identifica esse
dano com precisão — degradar a reputação do domínio derruba junto os convites
do Portal — e o descreve como aquilo que "o teto da Régua de Cobrança existe
para evitar". **Esse teto não está implementado.**

Recomendação: um comunicado por cliente por ciclo, agregando as faturas
vencidas num único e-mail (o template já recebe lista de B/Ls). Alternativa
mais barata: teto de N comunicados de Demurrage por cliente por dia, com o
excedente adiado para o ciclo seguinte.

**Vetor de spam interno adicional:** A3 gera 50 claims/liberações por hora,
indefinidamente, sem custo de e-mail mas com custo de banco e ocupando o lote.

## Integridade do pipeline Resend → Webhook → Banco

O caminho de entrada está bem defendido: assinatura Svix verificada com
`tolerance: 300` (`portal-email-webhook:230`), e dedup por `svix-id` numa
linha `UNIQUE` em `portal_email_events` (`index.ts:236`). Assinatura inválida
para em 401 antes de tocar no banco.

<a id="a2"></a>
### A2 — Evento perdido para sempre pela ordem dedup → resolução (Alta)

A ordem das operações no handler é:

1. `INSERT` do `svix-id` em `portal_email_events` (linha 236) — a partir
   daqui, **qualquer retry do Resend com o mesmo `svix-id` recebe 200 e não
   reprocessa nada** (linha 240);
2. resolução da tentativa por `provider_message_id` (linhas 249-263);
3. `if (!portalAttempt && !communicationAttempt) return 200` (linha 265).

O passo 3 descarta o evento **em silêncio, com o `svix-id` já queimado**.

A janela é real. Em `sendEmail`, o `provider_message_id` só é gravado por
`updateAttempt` **depois** que o POST ao Resend retorna (`email.ts:103-110`).
O webhook de `email.bounced` — sobretudo bounce síncrono de domínio
inexistente — pode chegar antes desse commit, ainda mais quando a execução
está no meio de um laço de destinatários com backoff de até 13 segundos.
Quando isso acontece:

- o bounce nunca vira `portal_suppressed_emails`;
- o endereço morto **continua elegível** para a régua e para os comunicados;
- `repair_customer_contact_box_fallbacks` nunca é acionado para aquele cliente;
- o retry do Resend, que existe exatamente para isso, é neutralizado pelo
  dedup.

O sistema insiste num endereço que não existe, ciclo após ciclo — o dano de
reputação de domínio que a ADR 0058 nomeia.

Correção recomendada: **só marcar o `svix-id` como processado depois de
resolvê-lo.** Em ordem de robustez:

1. Persistir o evento como não processado, e a resolução marcar
   `processed_at`; devolver 500 quando a tentativa não for encontrada, para
   que o retry do Resend tenha efeito. O dedup passa a checar
   `processed_at IS NOT NULL`.
2. Mínimo viável: quando nenhuma tentativa for encontrada, **apagar a linha de
   dedup** e devolver 500, deixando o retry do Resend fazer o trabalho.

### Outras observações do pipeline

- Falhas de `update` em `portal_email_attempts` e
  `customer_communication_attempts` são apenas logadas (linhas 269, 280). O
  handler devolve 200. É deliberado — o comentário em 322-329 explica o
  raciocínio para os alertas — mas aqui o efeito é o mesmo de A2: o status da
  tentativa fica desatualizado sem sinal e sem retry.
- `customer_communications.status` não é revisto quando o webhook registra
  `bounce` na única tentativa: o comunicado permanece `enviado` embora nada
  tenha sido entregue. É coerente com o modelo (a verdade da entrega é da
  tentativa), mas quem lê o histórico pelo cabeçalho lê errado. Vale registrar
  a regra de leitura em `docs/modules/`.
- `recordPortalSuppression` trata a hierarquia corretamente: `bounce_permanente`
  faz upsert e escala uma linha de `complaint`; `complaint` nunca rebaixa um
  `bounce_permanente` existente (linhas 66-72). Está de acordo com a ADR 0058.

<a id="a8"></a>
### A8 — `status` dentro do índice de idempotência (Baixa, latente)

```sql
CREATE UNIQUE INDEX customer_communications_idempotency
  ON public.customer_communications
  (kind, customer_id, status, anchor_voyage_id, anchor_port,
   anchor_atracacao_id, anchor_invoice_id, dispatch_id, attempt_discriminator)
  NULLS NOT DISTINCT;
```

`status` é mutável e muda depois do envio. Uma chave de idempotência
construída sobre coluna mutável deixa de restringir assim que o valor muda:
nada no índice impede que coexistam uma linha `enviado` e uma `simulado` para
o mesmo par âncora/discriminador.

Hoje isso não produz duplicata, porque o `SELECT ... FOR UPDATE` dentro de
`create_customer_communication_atomic` (`002:4320-4339`) **não filtra por
status** e reencontra a linha antiga. Ou seja: a proteção efetiva está no
corpo da RPC, e o índice — que deveria ser o backstop — não cobre o caso que
importa. Qualquer futuro caminho de escrita que insira sem passar pela RPC
duplica sem violar restrição.

Correção recomendada: remover `status` da chave do índice.

<a id="a9"></a>
### A9 — Porta de opt-out lê tabela morta (Baixa)

`claim_demurrage_dunning_candidates` (`002:3521`) avalia
`COALESCE((SELECT ccp.enabled FROM customer_contact_preferences ccp WHERE
ccp.contact_id = cc.id AND ccp.nature = 'demurrage'), true)`.

A ADR 0064 §9 declara que nenhuma consulta de produção lê essa tabela, e a
migration `008_portal_contact_boxes.sql:202` derruba
`trg_seed_customer_contact_preferences`. Contatos criados depois de 008 não
têm linha ali, então o `COALESCE` devolve `true` sempre: **a cláusula é
código morto que sempre aprova.** Não é falha de segurança — falha para o lado
permissivo do que a ADR já decidiu — mas é uma armadilha de leitura, porque
aparenta ser um controle de opt-out que não controla nada. Some junto com a
correção de A3.

## Checklist de validação pré-disparo

Para usar antes de ligar `communications_enabled` em produção, e como roteiro
de regressão a cada mudança na esteira.

### Bloqueadores — não ligar a chave sem isto

- [ ] **A2 corrigido.** Um `email.bounced` cujo `provider_message_id` ainda não
      está no banco deve resultar em retry efetivo, não em 200 silencioso.
      Teste: enfileirar o webhook antes do commit da tentativa e conferir que
      o endereço acaba em `portal_suppressed_emails`.
- [ ] **A1 decidido e implementado.** Provar, com um cliente cujo principal
      quicou e cujo único contato restante está só em `documentacao_operacao`,
      que ele **não** passa a receber `cobranca_demurrage`.
- [ ] **A3 corrigido.** O `EXISTS` da RPC de claim reflete o critério real de
      `loadRecipients`. Verificar em duas execuções consecutivas que uma
      fatura sem contato em caixa elegível **não** é reclamada de novo.
- [ ] **A6 dimensionado.** Contar, sobre os dados reais de produção,
      `COUNT(*)` de faturas elegíveis agrupadas por cliente. Se algum cliente
      passar de 3, implementar a agregação por cliente antes de ligar.

### Verificações operacionais antes de cada disparo em massa

- [ ] `SELECT communications_enabled FROM app_settings WHERE id = 1` confere
      com a intenção, e a faixa da tela concorda com o banco.
- [ ] `RESEND_API_KEY`, `PORTAL_FROM_EMAIL`, `COMMUNICATIONS_REPLY_TO` e
      `RESEND_WEBHOOK_SECRET` provisionados. Sem `RESEND_WEBHOOK_SECRET`
      válido, todo bounce é descartado em 401 e nenhuma supressão é registrada
      — a esteira envia às cegas.
- [ ] Webhook do Resend apontando para `portal-email-webhook`, com
      `email.delivered`, `email.bounced` e `email.complained` inscritos.
      Confirmar com um evento de teste que chega linha em
      `portal_email_events`.
- [ ] SPF, DKIM e DMARC do domínio de `PORTAL_FROM_EMAIL` verificados no
      Resend. Os dois canais dividem o remetente (ADR 0058); reputação é única.
- [ ] Ensaio completo com a chave **desligada**: conferir que o histórico
      grava `simulado`, que a tentativa é registrada, e que nada aparece no
      painel do Resend.

### Conferência de destinatários, por disparo

- [ ] A prévia por caixa foi conferida por uma pessoa, e a contagem de
      destinatários bate com a expectativa.
- [ ] Nenhum destinatário da lista está em `portal_suppressed_emails`
      (`bounce_permanente`) ou `customer_communication_suppressions`.
- [ ] Para comunicado financeiro: cada destinatário tem vínculo **explícito**
      com `financeiro`, e não um vínculo criado por
      `repair_customer_contact_box_fallbacks`. Consultar
      `customer_contact_change_events` por `change_summary->>'action' =
      'bounce_fallback_repair'` no cliente antes de disparar.
- [ ] Alertas `caixa_sem_destinatario` e `cliente_sem_contato_principal`
      abertos foram triados. Cada um é um cliente que ou não vai receber, ou
      vai receber pelo endereço errado.

### Após o disparo

- [ ] Toda linha de `customer_communications` do lote tem status terminal
      coerente. Enquanto A4 não for corrigido, checar especificamente se
      existe `status = 'simulado'` com tentativa carregando
      `provider_message_id` — é a assinatura do registro falsificado:

      ```sql
      SELECT c.id, c.status, a.provider_message_id
      FROM customer_communications c
      JOIN customer_communication_attempts a ON a.communication_id = c.id
      WHERE c.status = 'simulado' AND a.provider_message_id IS NOT NULL;
      ```

- [ ] Contagem de tentativas do lote bate com a contagem de destinatários
      conferida na prévia.
- [ ] Após ~15 minutos, conferir que os eventos `delivered` do Resend viraram
      `status = 'entregue'`. Tentativas paradas em `aceito` com
      `provider_message_id` preenchido são candidatas ao sintoma de A2.
- [ ] `paused` e `releaseFailures` na resposta de `demurrage-dunning` estão em
      zero, ou têm explicação.

## Recomendação de prioridade

1. **A2** — perda de bounce é o achado com pior composição: silencioso,
   permanente, e ataca a reputação do domínio que os dois canais dividem.
2. **A1** — vazamento de cobrança para terceiro operacional. Baixo esforço de
   correção, alto custo se acontecer.
3. **A3** — hoje é desperdício; quando os zumbis passarem de 50, vira falha
   total e silenciosa da cobrança.
4. **A6** — decidir e implementar o teto **antes** de ligar a chave, não
   depois do primeiro cliente com carteira grande.
5. **A4 e A5** — integridade da trilha. Não afetam entrega, afetam a
   capacidade de provar o que foi entregue — que é o produto de uma régua de
   cobrança.
6. **A7, A8, A9** — higiene, junto com as correções acima.

## O que esta auditoria não cobriu

- Nenhum teste foi executado contra banco real; as conclusões vêm de leitura
  de código e migrations em `bdf2241`.
- Templates e identidade visual (`_shared/customerCommunicationTemplates.ts`,
  `portalEmailTemplates.ts`) não foram auditados.
- `alerts-detector` e `portal-daily-digest` ficaram fora do escopo: não usam a
  chave global nem o canal de Comunicado.
- `evaluate_and_dispatch_automatic_communications` (a RPC de candidatura do
  auto-runner) não foi auditada em profundidade; o auto-runner em si foi.
