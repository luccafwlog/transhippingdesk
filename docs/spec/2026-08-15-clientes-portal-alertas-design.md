# Especificação funcional — Alertas, Clientes e Portal (Bloco #521)

**Status:** aprovada para planejamento técnico
**Issue:** [#521](https://github.com/luccafwlog/transhippingdesk/issues/521)
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)
**Data:** 2026-08-15

## 1. Objetivo

Definir como o sistema deve representar, exibir e encaminhar pendências
relacionadas a clientes, provisionamento do Portal, faturamento dependente do
Portal e disputas de Demurrage.

O desenho separa explicitamente:

- a pendência que exige ação;
- o evento normal que deve apenas ser preservado no histórico;
- a leitura individual de uma notificação;
- a resolução coletiva de uma pendência do departamento;
- o estado de uma Dispute e o responsável pela próxima resposta.

Esta especificação consolida as decisões registradas nos comentários da issue
#521. Ela descreve o comportamento funcional; não implementa ainda migrations,
RPCs, componentes ou o mecanismo transversal de envio de e-mails e
notificações do Portal.

## 2. Escopo das telas

| Superfície | Responsabilidade no bloco |
|---|---|
| `/clientes` | Lista de clientes, indicação de pendências próprias e resumo das pendências dos B/Ls vinculados. |
| `/clientes/:cnpj` | Ficha do cliente, painel contextual de pendências, histórico e acesso às correções. |
| `/clientes/portal` | Fila operacional de provisionamento, diagnóstico e ações auditadas. |
| `/demurrage` | Acompanhamento operacional das Disputes pelo departamento Equipamentos. |
| Portal do cliente — faturamento/Demurrage | Abertura de Dispute, consulta da conversa e recebimento de respostas. |
| `/alertas` e sino interno | Projeções transversais definidas na arquitetura geral de alertas. |

`/clientes/portal` não é uma segunda fonte de alertas. O alerta canônico é
projetado nessa fila, na lista de clientes, na ficha do cliente e nas
entidades afetadas.

### 2.1 Destinos canônicos de correção

Os links de alerta e notificação não são escolhidos por tela. Cada origem deve
abrir o ambiente onde a ação realmente acontece:

| Origem | Destino |
|---|---|
| Pendência geral de Cliente/Portal | `/clientes/portal?cliente={id}` |
| Bloqueio financeiro de B/L | `/manifestos/{blId}?tab=faturamento` |
| Falha técnica de emissão ou reprocessamento | `/manifestos/{blId}?tab=faturamento` |
| Invoice já criada | `/taxas-locais?invoice={invoiceId}` |
| Reconciliação de cliente | `/manifestos/{blId}?tab=detalhes` |
| Dispute de Demurrage interna | `/demurrage`, diretamente na conversa da Dispute |
| Dispute de Demurrage no Portal | `/portal/billing`, diretamente na conversa da Dispute |

Esses destinos pertencem a cada item de pendência. O alerta agregado da entidade
exibe todos os itens ativos e seus links de correção; ele não escolhe um único
destino nem cria uma cópia por tela.

## 3. Vocabulário e princípios

### 3.0 Integração obrigatória após as PRs #550 e #553

O Portal conserva fronteira própria de notificações. A PR #553 já implementou
uma Notificação do Portal para a Omissão e outra para o COD do B/L específico,
incluindo correções/reversões; complementos posteriores do registro global de
Transbordo atualizam o card sem criar nova entrega. Este bloco não pode
republicar esses eventos como Notificação Interna nem criar uma segunda
Notificação do Portal.

A escala omitida continua visível como `OMIT`, enquanto o motivo interno não é
exposto. Quando uma ação ou link precisar distinguir a operação dentro de um
porto com múltiplos terminais, deve carregar `terminal_id`/código de terminal;
porto sozinho não identifica ADR ou frente terminalizada. COD altera o destino
final e a Taxa Local, mas não reescreve o terminal da descarga física.

### 3.1 Pendência, evento e notificação

**Pendência** é uma condição que exige tratamento. Ela pode gerar alerta
persistente, notificação para o departamento responsável, exclamação vermelha
na entidade relacionada e ação direta para o ambiente onde a correção ocorre.

**Evento normal** registra algo que aconteceu sem exigir intervenção. Ele não
gera alerta persistente, notificação interna de pendência ou exclamação. Deve
ser registrado no histórico/auditoria e, quando aplicável, conter link direto
para a entidade produzida.

**Notificação Interna** é uma entrega pessoal, uma linha por usuário ativo dos
papéis internos definidos para cada item de pendência. A audiência do alerta
agregado é a união dos departamentos dos itens ativos, mas não substitui o
destinatário individual. Ler uma notificação não resolve a pendência. A
resolução depende da correção da condição de origem.

### 3.2 Unidades canônicas

O alerta persistente é agregado por entidade: para cada par
`(entity_type, entity_id)` pode existir no máximo um alerta não resolvido,
independentemente do tipo da pendência. Cada condição ativa fica em um item de
pendência ligado ao alerta, com sua própria origem, departamento, destino,
estado e histórico.

- Cliente: um alerta agregado reúne pendências de Portal, abuso investigável e
  outras condições diretamente relacionadas ao cliente.
- B/L: um alerta agregado reúne bloqueio financeiro, revisão, falha técnica e
  demais pendências diretamente relacionadas ao B/L.
- Viagem: um alerta agregado reúne divergência Baplie, CE e outras pendências da
  viagem, inclusive quando pertencem a departamentos diferentes.
- Fatura de Demurrage: o alerta agregado reúne os itens da Dispute enquanto a
  próxima ação for interna.

Quando uma condição é resolvida, somente o item correspondente sai da visão
ativa. O alerta é fechado apenas quando não restar item que exija ação interna.
Se uma nova condição surgir depois, o mesmo alerta agregado é atualizado e
reaberto com a situação atual; itens resolvidos permanecem no histórico e não
voltam à mensagem ativa.

As telas não devem criar cópias independentes do mesmo problema. Todas as
projeções devem consultar a mesma fonte canônica.

### 3.3 Responsabilidade departamental

Obrigações do sistema nunca são atribuídas a uma pessoa individualmente. A
responsabilidade é departamental.

Todos os usuários internos podem consultar e executar as ações autorizadas,
independentemente do departamento. Cada item de pendência declara o
departamento responsável; o alerta agregado permanece global e a notificação
interna é entregue à união dos departamentos dos itens ainda ativos.

Toda ação deve preservar auditoria completa.

## 4. Regras do Portal do cliente

### 4.0 Cadastro, importação e reconciliação

Erros que impedem a criação ou importação não são pendências de uma entidade já
existente e, portanto, não geram alerta persistente:

- CNPJ inválido ou ilegível: erro no formulário/modal;
- cliente duplicado: rejeição ou aviso de duplicidade;
- cliente sem contatos, quando ainda não possui processo ativo: nenhum alerta.

Quando o cliente já existe e possui processo ativo, a ausência de e-mail
utilizável para o Portal gera pendência geral do cliente.

Na reconciliação de um B/L:

- CNPJ identificado e correspondente a cliente cadastrado resolve o vínculo
  automaticamente, sem alerta;
- CNPJ ausente, não encontrado ou divergente exige validação e mantém a
  pendência no B/L;
- correspondência apenas por nome ou fuzzy match é sugestão, nunca vínculo
  definitivo automático.

A reconciliação de cliente é uma pendência própria do B/L e **não é promovida**
ao alerta geral do cliente. Ela pode ser resumida na ficha do cliente e
notificada com destino à aba de detalhes/revisão do B/L, mas não cria uma
segunda unidade de alerta no cliente.

### 4.1 Cadastro antecipado

O cadastro ou a importação de um cliente pode ocorrer antes da existência de um
B/L. Nesse momento:

- a conta do Portal é criada em `Aguardando análise`;
- a ausência de processo ativo não gera alerta;
- o Portal continua sendo obrigatório para processos futuros;
- quando um B/L for vinculado, a pendência passa a ser avaliada e pode gerar
  alerta.

Não existe mais o estado ou decisão “Provisionamento não necessário”. Dados
históricos nessa condição devem migrar para `Aguardando análise`, com registro
de auditoria.

### 4.2 Estados visíveis da fila

A fila exibe estes estados operacionais:

- Aguardando análise;
- Convite a enviar;
- Convite enviado — aguardando ativação;
- Convite expirado;
- Falha no envio;
- Ativo;
- Suspenso.

Eixos técnicos internos podem continuar existindo para suportar a máquina de
estados e a auditoria, mas não devem expor o estado removido nem criar uma
decisão funcional paralela.

### 4.3 Pendência geral do Portal

O cliente recebe um item de pendência geral dentro do alerta agregado da entidade
quando existir uma condição de Portal que exija intervenção, por exemplo:

- B/L ativo sem Portal ativo;
- B/L ativo sem e-mail de recuperação utilizável;
- convite expirado;
- falha no envio do convite;
- e-mail suprimido;
- cliente aguardando análise com processo ativo.

Razões simultâneas são agrupadas no mesmo alerta agregado do cliente, como itens
distintos com descrição detalhada. A entrada da fila permanece única para o
cliente.

Esses itens gerais são responsabilidade de Documentação. O alerta continua
visível globalmente, mas a notificação interna correspondente é direcionada aos
usuários ativos de Documentação.

Um convite dentro do prazo, sem B/L que dependa de faturamento, é somente um
estado normal da fila. Se houver B/L faturável bloqueado, a condição passa a
ser uma pendência financeira no B/L, com referência à pendência geral do
cliente quando aplicável.

### 4.4 Portal ativo e e-mail de recuperação

O faturamento só é liberado quando todos os critérios forem verdadeiros:

- existe conta de Portal;
- `active = true`;
- `account_situation = 'ativo'`;
- `auth_user_id` está presente;
- o e-mail de recuperação existe, tem formato válido e não está suprimido;
- não há bounce permanente ou complaint que invalide o endereço.

Uma falha temporária de entrega deve ser acompanhada, mas não bloqueia
imediatamente o faturamento.

A conta pode permanecer ativa mesmo com problema posterior no e-mail de
recuperação. Nesse caso, o cliente continua acessando o Portal, mas novos
faturamentos dos B/Ls afetados ficam bloqueados.

### 4.5 Correção do e-mail

A ficha do cliente e a fila do Portal usam a mesma operação interna auditada.

Uma ação explícita, como **“Usar este e-mail no Portal”**:

- valida o endereço;
- rejeita endereço suprimido;
- exige justificativa;
- grava o novo e-mail imediatamente;
- invalida convites ou confirmações anteriores quando necessário;
- registra a auditoria;
- reavalia a pendência e permite reprocessar B/Ls elegíveis.

Uma alteração comum no cadastro de contatos não sincroniza automaticamente o
Portal. O usuário precisa executar a ação explícita.

No fluxo iniciado pelo próprio cliente, o novo endereço só é promovido após a
confirmação pelo link enviado. Bounce permanente ou complaint posterior reabre
a pendência automaticamente.

## 5. Regras financeiras e projeções no B/L

### 5.1 Bloqueio obrigatório

A ausência de Portal ativo ou de e-mail de recuperação utilizável bloqueia o
faturamento obrigatoriamente. O bloqueio deve ser verificado tanto no fluxo de
preparação do B/L quanto no RPC final de emissão.

Uma emissão indevida por brecha técnica ou dado histórico é exceção e deve
gerar um item de pendência no alerta agregado do B/L, com referência à fatura
existente. Não deve existir um alerta financeiro genérico separado apenas
porque a fatura foi emitida. Em uma invoice consolidada, cada B/L afetado
recebe seu próprio item no alerta agregado do B/L, todos referenciando a mesma
invoice.

O bloqueio financeiro causado por Portal e a falha técnica no reprocessamento
notificam Documentação. Financeiro pode continuar atuando nos seus fluxos
próprios, especialmente consulta e reconciliação do extrato do Itaú, mas não é
destinatário de alertas ou notificações deste bloco para enviar o StratoPIX ou
tratar provisionamento do Portal.

Uma emissão indevida também pode ocorrer em dados históricos ou quando uma
invoice é inserida já com `status = 'issued'`. Essa exceção é crítica, é
detectada tanto na inserção quanto na transição para `issued`, e gera uma
pendência por B/L afetado com referência à invoice. A implementação deve
backfillar os registros históricos que ainda satisfazem essa condição; não pode
depender apenas de um `UPDATE OF status`.

### 5.2 Ativação dispara reprocessamento

Quando o Portal for ativado, o sistema deve reavaliar os B/Ls ativos e ainda
não faturados do cliente.

Para cada B/L, verificar reconciliação, cálculo, CE Mercante, taxas, revisão,
Portal, e-mail de recuperação e demais bloqueios aplicáveis.

- B/L elegível: faturar automaticamente, individualmente, e disponibilizar a
  fatura no Portal.
- B/L com outro bloqueio: manter a pendência com a causa funcional específica.
- Falha técnica: manter item específico no alerta agregado do B/L, com ação de
  reprocessamento.
- Reprocessamento repetido: ser idempotente e não criar fatura ativa duplicada.

A ativação não deve ser desfeita por falha posterior na emissão.

### 5.3 Cliente com vários B/Ls

Um cliente pode possuir:

- um item geral de Portal no alerta agregado do cliente;
- alertas financeiros individuais nos B/Ls bloqueados;
- pendências incorporadas ao alerta de Revisão Manual de outros B/Ls;
- B/Ls cancelados ou encerrados sem novos alertas.

A ficha do cliente deve sempre resumir os B/Ls afetados e permitir navegar para
cada correção.

### 5.4 Consolidação e pagamento individual

Uma consolidação não precisa ser desfeita manualmente para que um B/L seja
pago individualmente.

Se a cobrança individual de um B/L for paga e reconciliada:

- o B/L é liquidado;
- a consolidação aberta que incluía esse B/L torna-se obsoleta
  automaticamente;
- o histórico registra a relação entre pagamento individual e consolidação;
- não há alerta, salvo se a atualização automática falhar.

Desfazer ou refazer uma consolidação é uma ação de reorganização voluntária da
cobrança, não uma etapa obrigatória para pagamento individual.

## 6. Regras da Dispute de Demurrage

### 6.1 Responsabilidade

Demurrage é tratado pelo departamento **Equipamentos**. A contestação deve
aparecer no acompanhamento interno de Demurrage, que é o ambiente operacional
principal para análise, resposta e encerramento.

O motivo, a sequência de mensagens, as mudanças de responsável e o resultado
da contestação também devem ser registrados na ficha do cliente e na ficha da
fatura, além do acompanhamento de Demurrage. Essas superfícies são projeções do
mesmo histórico, não registros independentes.

### 6.2 Estado da Dispute versus próxima resposta

Essas dimensões são independentes.

**Estado da Dispute:** Aberta, Resolvida ou Cancelada. Esses são os rótulos
funcionais; os literais persistidos permanecem `aberto`, `resolvido` e
`cancelado`, para preservar o CHECK e as Disputes históricas existentes.

**Responsável pela próxima resposta:** Cliente, Transhipping/Equipamentos ou
Ninguém.

Fluxo esperado:

1. Cliente abre a Dispute: aberta, aguardando resposta de Equipamentos.
2. Equipamentos responde ou solicita documentos: aberta, aguardando cliente.
3. Cliente responde ou envia documentos: aberta, aguardando Equipamentos.
4. Equipamentos conclui a análise: resolvida, sem resposta pendente.
5. A Dispute é cancelada formalmente: cancelada, sem resposta pendente.

O item de pendência interno deve existir quando a próxima ação for de
Equipamentos. Quando a próxima resposta for do cliente, a Dispute permanece
aberta e visível no acompanhamento, mas o item de Equipamentos é removido da
visão ativa e não gera nova cobrança interna. Se houver outra pendência ativa
na mesma entidade, ela permanece no alerta agregado com seu próprio
departamento.

### 6.3 Conversa e anexos

A Dispute deve ser uma conversa estruturada, não apenas um campo de observação.
Cada mensagem deve registrar autor e origem, data e hora, conteúdo, anexos
quando houver e relação com a mudança de responsável pela próxima resposta.

Anexos enviados por qualquer lado ficam vinculados à mensagem específica, com
nome, tipo, autoria, data e histórico de acesso. A sequência de mensagens e
anexos é preservada como histórico da negociação.

### 6.4 Reabertura

Uma Dispute resolvida permanece preservada. O cliente pode solicitar reabertura
e registrar nova manifestação ou documento, mas essa solicitação não altera
automaticamente o estado.

Somente Equipamentos pode efetivamente reabrir a Dispute. A reabertura registra
um novo evento, atribui a próxima resposta a Equipamentos e reativa a
pendência interna.

Se a nova manifestação representar uma contestação diferente, deve ser criada
uma nova Dispute vinculada à mesma fatura, sem sobrescrever a anterior.

### 6.5 Avisos da conversa

Uma nova mensagem deve avisar o próximo responsável e abrir diretamente a
conversa da Dispute.

- Mensagem do cliente: pendência e aviso para Equipamentos.
- Resposta de Equipamentos: aviso ao cliente no Portal.

A definição funcional desse comportamento pertence a este bloco. A
implementação dos canais de e-mail e notificações dentro do Portal pertence ao
bloco transversal de notificações.

### 6.6 Abuso de login investigável

O bloqueio automático comum por excesso de tentativas é apenas um evento de
segurança no histórico. Quando o volume ou padrão exigir investigação, deve ser
criado um item específico no alerta agregado do cliente, separado como razão da
pendência geral de Portal, mas sem criar uma segunda linha de alerta para o
mesmo cliente.
Esse alerta é crítico, é direcionado a Documentação e permanece aberto até que
o departamento registre a análise e a providência tomada. O fim automático da
janela de bloqueio não resolve o alerta. Repetições são deduplicadas enquanto
houver uma ocorrência pendente; depois de resolvido, uma nova ocorrência pode
abrir novo alerta.

## 7. Eventos normais que não são alertas

Os seguintes eventos devem ser preservados no histórico, mas não virar
pendências automaticamente:

- cliente cria uma fatura pelo Portal;
- cliente desfaz uma consolidação validamente;
- cliente paga individualmente um B/L e a consolidação é automaticamente
  obsoletada;
- bloqueio automático temporário de login;
- convite pendente ainda dentro da validade, quando não há B/L bloqueado.

Quando o evento envolver uma fatura, cliente ou B/L, o histórico deve oferecer
acesso direto à entidade correspondente.

## 8. Segurança, auditoria e visibilidade

- Todos os usuários internos podem consultar e executar ações autorizadas.
- A troca interna do e-mail de recuperação, a revogação e a dispensa, quando
  aplicáveis, exigem justificativa; as demais correções seguem o rastro
  obrigatório de autor e departamento congelado, conforme a política de escrita
  interna.
- O log deve registrar usuário, departamento/role, data/hora, cliente, conta,
  entidade, estado anterior, estado novo, e-mail/convite relacionado e origem.
- Eventos automáticos devem registrar uma justificativa descritiva.
- A leitura não resolve alerta nem Dispute.
- Não existe ação de reconhecimento: ler é pessoal e nunca muda os itens do
  alerta agregado.
- O alerta global continua visível para todos os departamentos.
- A notificação interna é direcionada à união dos departamentos responsáveis
  pelos itens ativos e possui leitura individual por usuário.
- A resolução de um item remove somente aquele item e o departamento que deixou
  de ter pendência; a resolução de todos os itens fecha o alerta agregado.
- Qualquer dispensa temporária definida pela fundação é metadado com motivo,
  autor e revisão futura; não resolve item, não fecha o alerta e não libera
  faturamento.

### 8.1 Gravidade e detecção dos alertas do bloco

O catálogo abaixo responde explicitamente aos critérios de gravidade e detecção
do épico #519. “Gatilho” inclui evento de domínio em RPC/Edge Function; quando
indicado, o cron é apenas a reconciliação periódica e não uma escalada por
tempo.

| Tipo de pendência | Gravidade | Detecção |
|---|---|---|
| `portal_pendencia_geral` | Normal | Gatilho nas mudanças de cliente, B/L, conta e e-mail; reconciliação de segurança a cada 15 minutos. |
| `portal_convite_expirado` | Normal | Cron a cada 15 minutos (`portal-mark-expired-invites`). |
| `portal_falha_envio` | Normal | Gatilho imediato no resultado da tentativa de envio; reconciliação da fila a cada 15 minutos. |
| `portal_email_suprimido` | Normal | Webhook assinado do provedor, imediatamente após bounce permanente ou complaint; reprocessamento idempotente do evento. |
| `portal_abuso_login` | Crítica | Gatilho imediato no fluxo de login quando o padrão atingir o limiar investigável; sem fechamento por expiração da janela. |
| `portal_excecao_critica_fatura` | Crítica | Trigger após `INSERT` de invoice já `issued` ou transição para `issued`, mais backfill explícito dos registros históricos. |

Os tipos da tabela são chaves de itens de pendência, não linhas independentes
de `alerts`. Nenhum alerta se torna crítico apenas por envelhecer.

## 9. Critérios de aceite funcionais

- **521-AC-01:** cliente sem processo ativo pode permanecer em `Aguardando
  análise` sem alerta persistente.
- **521-AC-02:** cliente com B/L ativo sem Portal ou e-mail utilizável gera um
  item no único alerta agregado do cliente.
- **521-AC-03:** convite expirado ou falha de envio atualiza o item
  correspondente no alerta agregado sem duplicá-lo.
- **521-AC-04:** `Provisionamento não necessário` não aparece em estados,
  filtros ou ações.
- **521-AC-05:** `/clientes` exibe pendência própria e resumo dos B/Ls
  afetados.
- **521-AC-06:** a ficha do cliente exibe pendências próprias e dos B/Ls
  vinculados, com links de correção.
- **521-AC-07:** todos os usuários internos conseguem consultar e agir na fila,
  com auditoria.
- **521-AC-08:** o faturamento é bloqueado no gate final sem Portal ativo e
  e-mail de recuperação utilizável.
- **521-AC-09:** ativar o Portal reprocessa B/Ls ativos não faturados de forma
  idempotente.
- **521-AC-10:** B/L bloqueado por falha de emissão mantém item específico no
  alerta agregado e ação de reprocessamento.
- **521-AC-11:** pagamento individual de B/L obsoleta automaticamente a
  consolidação relacionada, sem alerta normal.
- **521-AC-12:** criação de fatura e desconsolidação válida são eventos de
  histórico com acesso direto às entidades.
- **521-AC-13:** bloqueio temporário normal de login não gera item; padrão que
  exigir investigação gera item crítico no alerta agregado do cliente, para
  Documentação, que permanece até análise e tratamento; a expiração da janela
  não o fecha.
- **521-AC-14:** Dispute de Demurrage gera item para Equipamentos quando a
  próxima ação for interna e aparece no acompanhamento interno de Demurrage.
- **521-AC-15:** Dispute separa estado do caso e responsável pela próxima
  resposta.
- **521-AC-16:** conversa de Dispute preserva mensagens e anexos por autor e
  data.
- **521-AC-17:** mensagem do cliente direciona a pendência para Equipamentos;
  resposta interna direciona aviso ao cliente.
- **521-AC-18:** cliente pode solicitar reabertura, mas somente Equipamentos
  pode reabrir efetivamente.
- **521-AC-19:** uma nova Dispute não sobrescreve uma contestação anterior.
- **521-AC-20:** canais concretos de e-mail e notificação do Portal são tratados
  no bloco transversal, sem duplicar esta regra.
- **521-AC-21:** invoice inserida já como `issued`, ou alterada para `issued`,
  sem Portal/e-mail utilizável gera o item da exceção crítica no alerta
  agregado do B/L, e os registros históricos equivalentes são encontrados pelo
  backfill.
- **521-AC-22:** uma entidade com várias pendências mantém um único alerta
  agregado; cada item pode ser resolvido separadamente, atualizando a lista
  ativa, os departamentos e os destinos sem apagar o histórico.
- **521-AC-23:** Omissão, COD, reversão e complementação de Transbordo reutilizam
  os produtores da PR #553: uma entrega por evento contratual, nenhum aviso a
  cada edição do card e nenhum vazamento do motivo interno.
- **521-AC-24:** destinos terminalizados carregam terminal; COD não troca o
  terminal físico usado por Transbordo/ADR.

## 10. Fora de escopo e dependências

Este documento não define ainda:

- o desenho técnico definitivo dos itens do alerta agregado, das notificações
  individuais ou da migração dos estados técnicos atuais;
- o mecanismo de envio de e-mails ao cliente;
- a implementação visual completa das notificações dentro do Portal;
- limites, extensões e política detalhada de armazenamento de anexos;
- a implementação do faturamento automático e do gate final;
- a implementação da conversa de Dispute.

O gate de reconciliação deve preservar os dois estados válidos já existentes:
`matched_document` (vínculo automático por documento) e `reconciled` (vínculo
confirmado manualmente). Somente os demais estados permanecem pendentes.

Esses itens serão detalhados no plano técnico e, quando compartilhados por
outros módulos, no bloco transversal correspondente.
