# Especificação funcional — B/L, Revisão Manual e Documentação (Bloco #520)

**Status:** aprovada para planejamento técnico
**Issue:** [#520](https://github.com/luccafwlog/transhippingdesk/issues/520)
**Épico:** [#519](https://github.com/luccafwlog/transhippingdesk/issues/519)
**Data:** 2026-08-15

## 1. Objetivo

Definir quando as importações, a Revisão Manual, os B/Ls, containers, cargas
soltas e veículos representam pendências que exigem tratamento, sem confundir
erro transitório de importação com uma entidade persistida que precisa de ação.

Esta especificação também define como uma pendência deve ser projetada na ficha
do B/L, nas listas, na fila de revisão, no sino e na tela global de Alertas.
Ela depende da arquitetura transversal de alertas e das regras compartilhadas
de leitura individual e resolução coletiva.

## 2. Escopo das telas

| Superfície | Responsabilidade no bloco |
|---|---|
| `/manifestos` | Lista de B/Ls, importação em lote e indicação de pendências. |
| `/manifestos/:blId` | Ficha do B/L, painel contextual e correções diretas quando possível. |
| `/revisao` | Fila operacional orientada a grupos de clientes com onboarding transacional em lote para `bls` e tratamento de `granite_bls`, exibindo B/Ls individuais apenas como exceções operacionais ou conflitos documentais. |
| `/containers` | Projeção de pendências originadas em B/L, viagem ou Demurrage, sem duplicação. |
| `/carga-solta` | Importação e projeção de pendências dos B/Ls de carga solta. |
| `/veiculos` | Importação com validação antes da persistência; sem pendência própria de vínculo inválido. |
| `/alertas` e sino interno | Projeções transversais do alerta canônico. |

`/revisao` é uma fila de trabalho e não uma segunda fonte de alertas. A mesma
pendência pode ser tratada diretamente na ficha do B/L ou no módulo responsável
por sua origem. Na interface `/revisao`, o trabalho é orientado a grupos de
cliente (`ReviewGroup`), permitindo resolver CNPJ, razão social e e-mail para
todos os B/Ls do grupo em uma operação transacional única, mantendo o drawer
individual do B/L focado em correções operacionais.

Neste bloco, B/L inclui registros de `bls` e `granite_bls`. Existe um único
alerta agregado por entidade, identificado por `(entity_type, entity_id)`. O
`type` deixa de separar alertas: ele identifica o item de pendência dentro do
agregado. A origem `bl` ou `granite_bl` deve compor a identidade canônica do B/L
quando os identificadores das tabelas puderem coincidir, sem criar dois alertas
para a mesma entidade canônica. A tabela
`public.bls` é a fonte comum tanto para B/L de contêiner
(`cargo_mode = 'container'`) quanto para B/L de carga solta
(`cargo_mode = 'carga_solta'`),
que usa os campos próprios de volumes/peso e não exige `bl_containers`. Os B/Ls
de `bls` usam os motivos canônicos do gate; os registros de `granite_bls` usam
a condição vigente `client_id IS NULL`.

## 3. Princípios

### 3.0 Integração obrigatória após as PRs #550, #553 e #569

O agregado deste bloco continua no B/L; terminal não entra na identidade da
Revisão Manual. Porém, qualquer destino que abra ADR/frente operacional deve
preservar terminal (e `report_id` quando disponível), pois porto sozinho não
identifica mais a operação.

A tela `/revisao` opera prioritariamente por Grupo de Cliente (PR #569), com
onboarding transacional (`complete_review_customer_group`), segregação de
CNPJs conflitantes e exibição de evidências documentais (`consignee_block` e
`cargo_description`). O drawer individual não duplica a criação de cliente.

Omissão, Transbordo e COD não são novos motivos genéricos de Revisão Manual.
Omissão/COD já publicam as Notificações do Portal da PR #553; complemento do
registro global de Transbordo apenas atualiza o card. COD exige justificativa e
pode criar Ajuste de COD no fluxo próprio, sem reabrir revisão de cliente, CE,
peso ou cálculo. A escala omitida deixa de ser elegível aos detectores por POD,
mas permanece visível como `OMIT`; COD não muda o CE Mercante nem o terminal da
descarga física.

### 3.1 Erro de importação versus pendência persistente

Erro de importação é um resultado da operação de entrada de dados. Ele deve
ser mostrado no modal da própria importação e pode ser preservado no histórico
técnico, mas não cria alerta persistente, notificação ou exclamação.

Pendência persistente existe quando o B/L ou outra entidade foi criada e não
pode avançar no fluxo sem tratamento.

Em importações em lote, linhas válidas continuam sendo processadas mesmo que
outras linhas falhem.

### 3.2 Alerta agregado único por B/L

Todo B/L (`bls` ou `granite_bls`) que entra em Revisão Manual possui uma
pendência bloqueadora dentro do único alerta agregado da entidade e gera:

- um item de revisão no alerta agregado do B/L;
- notificação para Documentação;
- exclamação vermelha nas listas e projeções do B/L.

Se houver vários motivos, cada motivo é um item de pendência resolvível
individualmente no mesmo alerta agregado. A mensagem lista somente os itens
ainda pendentes; outras pendências do mesmo B/L, inclusive de outro bloco,
entram no mesmo agregado.

Correção parcial atualiza os itens existentes sem duplicar o agregado. Quando
todos os itens do B/L forem resolvidos:

- o B/L sai da fila de revisão;
- o alerta agregado é fechado;
- a pendência deixa de ser exibida como ativa;
- a exclamação desaparece.

O fechamento desse alerta derivado é feito pela recomputação da origem. Enquanto
houver qualquer item pendente, o fechamento manual é bloqueado. Não existe ação de
reconhecer: ler continua sendo individual e não resolve. A ação coletiva de
triagem é uma dispensa temporária, que apenas tira o alerta da fila prioritária,
exige motivo e data futura de revisão e nunca libera o gate. Assim, `/alertas`
não pode esconder uma pendência bloqueadora sem preservar sua revisão futura.

Abrir a revisão, a ficha ou a notificação não resolve o problema.

### 3.3 Ficha contextual

O topo da ficha do B/L exibe painel persistente, visível em todas as abas, com:

- descrição detalhada da pendência;
- motivo e impacto no fluxo;
- departamento responsável;
- ambiente correto da correção;
- ação direta quando disponível;
- estado atual e histórico relevante.

Uma pendência corrigível na ficha deve oferecer a ação ali mesmo. Uma pendência
de outra origem deve encaminhar ao módulo correto, sem fingir que a correção
ocorre na ficha do B/L.

## 4. Importação de B/Ls e carga solta

### 4.1 Importação em lote de B/Ls

O modal deve identificar por linha:

- B/L processado com sucesso;
- B/L rejeitado;
- informação não reconhecida;
- motivo técnico ou de validação.

B/Ls válidos continuam o processamento. Falhas ficam no resultado da operação e
no histórico técnico já existente em `import_errors`, associado ao
`import_batches` da operação, mas não geram alerta persistente,
notificação ou marcador visual.

Se um B/L válido entrar posteriormente em Revisão Manual, aplica-se a regra do
alerta único por B/L.

### 4.2 Importação de carga solta

A importação de carga solta segue a mesma separação:

- erro da importação: modal e histórico técnico;
- B/L persistido que entra em Revisão Manual: alerta único por B/L,
  notificação para Documentação e exclamação persistente.

## 5. Motivos da Revisão Manual

Para B/Ls de `bls`, o gate canônico de revisão documental expõe os motivos
operacionais que exigem intervenção humana documental:

- cliente não vinculado;
- cliente sem e-mail cadastrado/utilizável;
- Conta de Portal não pronta;
- peso de carga solta ausente (`bb_weight_ton`).

A prontidão do Portal atua como gate server-side para avanço e emissão do
faturamento (conforme a ADR 0054) e também produz o item crítico
`review_portal_not_ready` enquanto o B/L estiver em Revisão Manual. A condição é
recomputada quando a conta do cliente muda; a ativação resolve somente esse item
e não altera os demais motivos independentes do mesmo B/L.

Para `granite_bls`, a condição vigente da fila é `client_id IS NULL`; ela é a
fonte do motivo de revisão do Granito. O vínculo de cliente não resolvido é
tratado no mesmo alerta único, sem duplicar a unidade por causa da tabela de
origem. A implementação deve recomputar essa condição após
`save_granite_bl_review` e fechar o alerta quando `client_id` deixar de ser
nulo; não deve inventar motivos de Portal ou de peso.

A inclusão de e-mails extraídos na importação é realizada de forma idempotente
pela função `ensure_customer_contact_email` (migration `322`), reavaliando o
gate imediatamente sem abrir revisões desnecessárias.

Quando a reconciliação identificar corretamente o cliente por documento, o
vínculo é resolvido automaticamente. Correspondência somente por nome ou fuzzy
match é sugestão e exige validação.

## 6. Correção direta e correção em outro módulo

### 6.1 Cliente no B/L e no Grupo

Na fila `/revisao`, a decisão e o onboarding de cliente são operados no nível
do Grupo de Cliente (`ReviewCustomerOnboarding`), permitindo criar cliente,
cadastrar e-mail e vincular todos os B/Ls daquele CNPJ/identidade documental numa
transação única (`complete_review_customer_group`).

Na ficha do B/L (`/manifestos/:blId`), o usuário pode vincular ou iniciar o
cadastro diretamente se necessário, seguindo a mesma integridade documental
(CNPJ válido e e-mail).

No `ReviewDrawer`, o cadastro/busca de cliente foi removido para preservar a
consistência do grupo; o drawer exibe a identidade do cliente em modo leitura
(com `allowCustomerLink` restrito a Granito e CNPJs divergentes) e foca
exclusivamente nas correções operacionais do B/L individual (`shipper`,
`consignee`, `pol`, `pod`, `total_weight_kg`, `total_cbm`, `notes`).

### 6.2 Baplie EDI

Se um container associado a um B/L não estiver no Baplie EDI, a inconsistência
é da viagem inteira, porque o Baplie representa o documento da viagem.

- a viagem recebe o alerta canônico;
- não se cria alerta independente para cada B/L ou container;
- B/Ls e containers afetados exibem o contexto e o caminho para o módulo Baplie;
- a correção ocorre no Baplie/viagem;
- a projeção desaparece quando a inconsistência da viagem for corrigida.

Essa regra será implementada no bloco operacional de viagens, mas deve ser
respeitada nas projeções deste bloco.

## 7. Containers

`/containers` pode exibir pendências cujo domínio canônico seja B/L ou viagem,
além do Indicador Operacional de Demurrage, mas não deve criar cópia do alerta.

- Container descarregado dentro do free time e ainda não devolvido: sem alerta.
- Container fora do free time e não devolvido: permanece no indicador operacional
  de Demurrage (por container), sem virar Alerta ou Notificação Interna.
- Pendência de cliente, Baplie ou Revisão: exibir contexto e link, mantendo o
  alerta na entidade canônica.

## 8. Veículos

A importação deve validar chassi, B/L, viagem, container, tipo e lacre antes de
persistir o veículo.

Se não houver container válido, o cadastro do veículo é rejeitado. Como a
entidade não é criada, não existe pendência persistente de vínculo a ser
alertada.

Falhas posteriores de faturamento, Portal ou revisão pertencem aos respectivos
domínios e não ao cadastro de veículos.

## 9. Visibilidade, notificação e auditoria

- A tela global `/alertas` exibe o alerta canônico para todos os departamentos.
- O sino encaminha a notificação para Documentação nos casos de Revisão Manual.
- A leitura é individual por usuário e não resolve a pendência.
- Não há estado nem ação de reconhecimento. A dispensa é coletiva, temporária,
  exige motivo e data futura de revisão e apenas retira o alerta da fila
  prioritária; não resolve a origem nem libera faturamento.
- Alertas derivados do gate de revisão só podem ser fechados automaticamente
  pela resolução da condição de origem; a UI e o servidor bloqueiam fechamento
  manual enquanto houver motivo pendente.
- Todos os usuários internos podem consultar e executar ações autorizadas, com
  logs completos.
- As correções deste bloco não exigem justificativa textual obrigatória: o rastro
  obrigatório registra autor e departamento congelado, e a RPC pode preencher
  `Revisão manual` como justificativa opcional. Regras específicas existentes
  que exigirem justificativa continuam prevalecendo.
- O log registra usuário, departamento/role, data/hora, entidade, estado
  anterior, estado novo, origem, ação e justificativa.

## 10. Critérios de aceite funcionais

- **520-AC-01:** importação em lote mostra falhas por linha no modal e continua
  processando linhas válidas.
- **520-AC-02:** falha de importação não cria alerta, notificação ou exclamação.
- **520-AC-03:** todo B/L de `bls` ou `granite_bls` que entra em Revisão Manual
  possui um item persistente no alerta agregado identificado por
  `(entity_type, entity_id)` e notificação para Documentação.
- **520-AC-04:** múltiplos motivos de um B/L permanecem no mesmo agregado como
  itens de pendência independentes.
- **520-AC-05:** correção parcial atualiza os itens e a mensagem sem duplicar o
  alerta da entidade.
- **520-AC-06:** resolver todos os motivos remove o B/L da fila, fecha o
  alerta e remove a exclamação.
- **520-AC-07:** abrir a ficha ou a notificação não resolve a pendência; não há
  reconhecimento; e a dispensa exige motivo e data futura sem ocultar a origem.
- **520-AC-08:** ficha do B/L exibe painel contextual no topo em todas as abas.
- **520-AC-09:** correção possível na ficha pode ser executada diretamente ali.
- **520-AC-10:** pendência de outro domínio encaminha para o módulo correto.
- **520-AC-11:** carga solta segue as mesmas regras de importação e revisão.
- **520-AC-12:** `/containers` projeta alertas de B/L/viagem e o indicador de
  Demurrage sem duplicar alertas nem transformar o indicador em alerta.
- **520-AC-13:** container dentro do free time sem devolução não gera alerta; o
  vencido permanece apenas como Indicador Operacional.
- **520-AC-14:** veículo sem container válido não é persistido e não gera alerta.
- **520-AC-15:** divergência de Baplie gera alerta por viagem, nunca por B/L ou
  container.
- **520-AC-16:** todos os usuários internos veem e podem tratar as pendências,
  com auditoria.
- **520-AC-17:** o alerta de revisão é crítico e sua abertura ocorre no servidor
  nas mutações autoritativas, com recomputação idempotente de segurança a cada
  15 minutos, sem depender de tela e sem duplicar registros.
- **520-AC-18:** toda dispensa de alerta exige data futura de revisão; se a
  condição persistir, o alerta retorna à fila prioritária, e se tiver sido
  resolvida o fechamento é automático.
- **520-AC-19:** Omissão, Transbordo, COD e Ajuste de COD não criam motivo
  genérico de Revisão Manual nem produtor duplicado de Notificação do Portal.
- **520-AC-20:** links terminalizados carregam terminal/`report_id`; a identidade
  do alerta de revisão continua sendo o B/L.

## 11. Fora de escopo e dependências

Este documento não implementa nem redefine:

- a fundação técnica de alertas e notificações;
- os canais de e-mail e o sino transversal;
- a implementação do alerta de Baplie, que pertence ao bloco de viagens;
- a implementação de faturamento, Portal e Demurrage;
- a política de arquivamento de importações além do registro técnico já existente
  em `import_errors`.

Esses pontos devem ser consumidos por contratos comuns e pelos blocos #521,
#522 e #523. Para a detecção D−5 de CE Mercante do bloco de viagens, a unidade
de B/L é exclusivamente `public.bls`: entram B/Ls de contêiner e carga solta
com POD; `granite_bls` fica fora desse detector.
