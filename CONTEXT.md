# Contexto do Sistema

Glossário de domínio do Transhipping Desk. Este arquivo define linguagem de
negócio; arquitetura e detalhes técnicos pertencem a `docs/ARCHITECTURE.md` e
aos ADRs.

Verificado em 2026-06-24.

## Operação marítima

**Viagem**
Unidade principal da operação: um navio identificado por número de viagem e
acompanhado em suas escalas, agendas e cargas.

**Escala portuária**
Passagem de uma viagem por um porto ou terminal, com datas operacionais,
identificadores e vínculos documentais próprios.

**Omissao de Escala**
Evento operacional em que o armador nao realiza a escala prevista em um POD. A
carga afetada e descarregada em outro porto da mesma viagem para seguir em
transbordo ou ser convertida em COD. Nao calcula nem automatiza financeiro.

**Porto de Descarga**
Porto onde a carga de uma escala omitida e efetivamente descarregada. Pode ser
diferente do POD original do B/L.

**Transbordo**
Seguimento da carga em navio de terceiro apos omissao de escala. No sistema, o
navio/armador/viagem de transbordo sao referencia operacional leve por B/L, nao
uma nova Viagem.

**COD (Change of Destination)**
Alteracao operacional do destino final do B/L para o Porto de Descarga apos
omissao de escala. E uma excecao por B/L e mantem efeitos financeiros manuais.

**Rota da Viagem**
Sequência de portos de uma viagem: portos de carregamento (POL) com seus ETDs e
portos de descarga (POD) com seus ETA/ETB/ATA/ATD. É o dado que o sistema
operacional consome — manifestos e B/Ls referenciam esses mesmos portos.

**Programação de Navios (Chegadas e Saídas)**
Quadro de line-up exibido ao cliente no Portal, com a previsão de datas por porto
da rota. É uma **visão voltada ao cliente**, distinta do **Line-Up (TV)**, que é o
painel operacional derivado das viagens já cadastradas. A ADR 0021 decide unificar
esse cadastro ao da Viagem (a Programação passa a projetar a Viagem); enquanto não
implementada, os dois cadastros permanecem separados.

**Número de Escala do Mercante**
Identificador criado no sistema federal Mercante para uma escala do navio. Uma
viagem com múltiplos terminais pode ter mais de um número de escala.

**Vínculo de Manifestos à Escala**
Confirmação de que os manifestos foram vinculados à escala no Mercante. Não é
sinônimo de o Número de Escala existir.

**B/L (Bill of Lading / Conhecimento de Embarque)**
Documento de transporte que agrupa carga sob um consignatário. É a unidade
operacional usada para revisão, cobrança de taxas locais e vínculo com cliente.
Também é uma **fonte de ingestão co-primária** (ao lado do manifesto): o arquivo
do B/L pode criar um B/L inexistente — inclusive quando não há manifesto,
**dispensando-o** — e corrigir dados comerciais já gravados (com auditoria e
preview do diff), além de ser a única fonte de Frete & Despesas do BL e da data
de emissão do B/L. O documento do B/L é um **superconjunto do manifesto**: toda
informação presente no manifesto existe também no B/L; o inverso não vale
(ex.: frete e despesas só existem no B/L).

**Manifesto**
Arquivo do armador com dados comerciais dos B/Ls, consignatários, documentos,
pesos, cargas e containers. É uma **fonte de ingestão co-primária** dos dados
comerciais e financeiros da carga, **ao lado do B/L**. Quando presente, costuma
ser a primeira a chegar e criar os B/Ls; mas a operação pode prosseguir **só com
B/Ls, sem manifesto**. Nenhuma fonte é autoridade por decreto: a precedência é
temporal (quem cria primeiro) mais o gate de faturamento, e toda sobrescrita
entre fontes é precedida de preview do diff e auditada. O manifesto **não**
carrega frete; e nenhuma correção via B/L altera variáveis de faturamento.

**CNTR**
Abreviação de domínio para container.

**Carga Solta / Breakbulk (BB)**
Carga transportada sem container, representada por itens, peso e volume
vinculados ao B/L.

**RoRo**
Carga rolante, especialmente veículos importados e vinculados a B/L e, quando
aplicável, ao container físico.

**Granito**
Fluxo especializado de importação e cobrança baseado em planilhas COSCO. É
integrado à revisão e ao faturamento, mas mantém regras e registros próprios.

## Baplie e reconciliação

**Baplie EDI**
Arquivo EDIFACT do plano de estiva. É a autoridade para a presença física de
containers, posição a bordo e flags operacionais.

**Staging Baplie**
Estado intermediário dos containers importados do Baplie antes da reconciliação
com o manifesto. Uma reimportação substitui o staging anterior da viagem.

**Conciliação Baplie × Manifesto**
Comparação, dentro da mesma viagem, entre a carga física do Baplie e os dados
comerciais do manifesto.

**Divergência de Existência**
Container presente numa fonte e ausente na outra. Exige visibilidade para o
operador, mas não altera silenciosamente dados comerciais.

**Divergência de Atributo**
Conflito em dado operacional, como status, IMO ou OOG. O operador escolhe qual
fonte prevalece quando a resolução não é automática.

**Estado de Conciliação da Viagem**
Resumo de prontidão dos dados:

- **Divergente:** há conflito ainda não resolvido;
- **Pendente:** falta fonte, CE ou etapa de conciliação;
- **Conciliada:** fontes e CEs necessários estão coerentes.

É um sinal operacional, não autorização financeira isolada.

**Flags Operacionais**
Características físicas da carga, como IMO, classe, número ONU, OOG e status
cheio/vazio. Não incluem consignatário, documento fiscal ou peso de cobrança.
O B/L declara carga perigosa no nível do conhecimento (DG Class e número ONU na
descrição da mercadoria), aplicando-se inicialmente a todos os containers do
B/L; o Baplie refina depois quais containers são de fato IMO.

**IMO**
Classificação de carga perigosa segundo a International Maritime Organization.

**OOG (Out of Gauge)**
Container com dimensões fora do padrão ISO.

## Mercante

**CE Mercante**
Conhecimento Eletrônico registrado por B/L no sistema Mercante. Sua ausência
pode bloquear a visibilidade de dados e documentos no Portal do Cliente. Seu
cadastro no sistema é o gatilho do cálculo automático de Taxas Locais do B/L
de container: nada é calculado nem faturado antes do CE Mercante existir.

**CE Master**
Conhecimento agrupador associado ao manifesto. É distinto dos CEs individuais
dos B/Ls.

**Frete & Despesas do BL**
Linhas da seção "Freight & Charges" do conhecimento de embarque (B/L): frete
marítimo (ex.: OCEAN FREIGHT) e despesas declaradas pelo armador (ex.: THD),
cada uma com valor, moeda e indicador prepaid/collect. É a **fonte do bloco de
frete do registro C5** do EDI Mercante — informação que o manifesto não traz.

- **Distinto de:** Taxas Locais. Frete & Despesas do BL é dado declarado pelo
  armador para o manifesto Mercante; Taxas Locais é a cobrança do desk ao
  cliente (Recebível Local / invoice). Os dois não se alimentam.

## Revisão e clientes

**Revisão Operacional**
Etapa humana para resolver cliente, CE, peso, inconsistências de cálculo e
outros dados que impedem o avanço seguro.

**Reconciliação de Cliente**
Vínculo confirmado entre o consignatário importado e o cadastro de Cliente.
Matching automático incerto deve permanecer pendente de decisão humana.

**Cliente**
Pessoa jurídica ou física responsável por cargas e cobranças no sistema.

**Email de Contato**
Canal de comunicação do cliente. Pode coincidir com o email técnico do Portal,
mas os conceitos não são equivalentes.

## Faturamento

**Taxas Locais**
Cobranças ligadas ao B/L, calculadas por tabelas, itens e eventuais regras
específicas do cliente. Para B/L de container, o cálculo automático é
disparado pelo cadastro do CE Mercante — nunca pelo import do manifesto ou do
B/L —, garantindo que todos os B/Ls da viagem já existam quando taxas de
container compartilhado são divididas.

**Recebível Local**
Saldo financeiro de taxas locais de um B/L. Pode ser ligado a invoice individual
ou consolidada e liquidado por um ou mais pagamentos.

**Invoice Individual**
Documento financeiro emitido para um único conjunto elegível de cobranças.

**Invoice Consolidada**
Documento que reúne recebíveis de múltiplos B/Ls do mesmo cliente.

**Ledger Local**
Histórico de recebíveis, vínculos com invoices, liquidações e eventos de ciclo
de vida usado para reconstruir saldos de taxas locais.

**Demurrage**
Cobrança pela sobreestadia de containers — tempo entre descarga e devolução ao
pátio, excedendo o free time contratado.

**Free Time**
Período após a descarga durante o qual o container pode ficar no pátio sem
cobrança. Definido por container type (grupo tarifário) ou por override por B/L.

- **Synonyms / avoid:** "taxa P1", "tarifa P1"
- **Related:** P1, P2

**P1 (Período 1)**
Primeira faixa tarifária após o free time. Taxa diária em USD aplicada aos dias
entre o fim do free time e o início de P2. Quando o free time override do B/L é
maior que o fim de P1 do grupo, P1 tem zero dias e a cobrança inicia direto em
P2.

- **Synonyms / avoid:** "taxa P1", "tarifa P1"
- **Related:** Free Time, P2

**P2 (Período 2)**
Segunda faixa tarifária, com taxa diária superior a P1. Aplicada a partir do dia
definido pelo grupo tarifário, independentemente do free time override do B/L.

- **Synonyms / avoid:** "taxa P2", "tarifa P2"
- **Related:** P1, Free Time

**Free Time Override**
Valor de free time específico de um B/L, sobrescrevendo o padrão do grupo
tarifário. Afeta apenas o início da cobrança (P1 começa em override+1), sem
deslocar as faixas P1/P2.

- **Related:** Free Time, P1, P2

**ROE (Taxa de Câmbio)**
Taxa de câmbio USD→BRL aplicada à invoice, calculada a partir da PTAX do BCB
com markup de 1,065. **Não é congelada na emissão**: enquanto a invoice não está
paga, o ROE é recalculado a cada nova PTAX divulgada pelo BCB (dias úteis). O
congelamento real do valor ocorre apenas no momento do pagamento, registrado de
forma imutável no histórico da invoice. As colunas que guardam o último valor
recalculado chamam-se `current_roe` e `current_total_brl`.

- **Related:** PTAX, Markup, Recálculo Diário

**Markup**
Fator multiplicativo (1,065) aplicado à PTAX para obter o ROE. É o **spread
fixo cobrado pelo armador**, não uma margem de proteção contra flutuação cambial
— a proteção cambial deixa de existir quando o valor passa a ser recalculado
diariamente.

- **Related:** ROE, PTAX

**Recálculo Diário**
Reavaliação do valor em BRL de toda invoice de Demurrage **não paga**, a cada
nova PTAX divulgada pelo BCB (dias úteis). Atualiza `current_roe`/
`current_total_brl` e grava uma entrada imutável no histórico. Encerra-se no
pagamento, quando o valor é congelado.

- **Related:** ROE, PTAX, Markup, Invoice de Demurrage

**Invoice de Demurrage**
Documento financeiro que cobra sobreestadia de containers. Cada item armazena a
composição completa do cálculo: free days, dias P1, taxa P1, dias P2, taxa P2,
subtotal. O cliente (portal) deve ver free time e valor por período para
garantir transparência. O admin vê o detalhe completo incluindo ROE e descontos.

Só pode ser emitida quando **todos os containers do B/L já foram devolvidos** —
não se fatura com container ainda fora, pois os dias de demurrage (e portanto o
`total_usd`) ainda estariam acumulando. Na emissão o **valor em USD fica fixo**
(dias travados); apenas o valor em BRL flutua com o Recálculo Diário até o
pagamento. O monitoramento de containers ainda fora (demurrage correndo) é
operacional, não gera fatura.

- **Related:** P1, P2, Free Time, ROE, Recálculo Diário

**Tarifa de Demurrage (Rate)**
Configurável por container type com vigência temporal. A resolução usa
precedência: override do B/L > tarifa do banco > fallback. A tarifa do banco é a
única fonte de verdade; não existe fallback estático. O `active` flag é o
mecanismo de desativação imediata; `valid_to` é para expiração agendada.

- **Related:** P1, P2, Free Time, Free Time Override

**Conciliação PIX**
Comparação entre transações recebidas e cobranças emitidas, priorizando TXID e
valor. Casos ambíguos exigem decisão humana.

## Histórico e auditoria

**Histórico (do B/L)**
Linha do tempo completa dos acontecimentos de um B/L: alterações manuais de
campos, mudanças em containers, cálculo e revisão de taxas, e emissão e
pagamento de faturas. É o termo guarda-chuva que abrange a Auditoria — não um
sinônimo dela.

**Auditoria**
Subconjunto do Histórico: as alterações deliberadas registradas com
justificativa (quem mudou o quê, de qual valor para qual, e por quê). Toda
auditoria é um evento do Histórico; nem todo evento do Histórico é uma auditoria
— eventos gerados pelo sistema (ex.: emissão de fatura) não têm justificativa.

## Portal do Cliente

**Portal do Cliente**
Interface externa onde o cliente consulta painel, faturas, B/Ls, containers,
notificações, disputas e perfil.

**Conta de Portal**
Vínculo entre um Cliente e um usuário do Supabase Auth. Um cliente possui no
máximo uma conta ativa provisionada internamente.

**Identificador de Login do Portal**
Valor informado na tela de login: somente o CNPJ da empresa, com ou sem máscara.
CPF e email não são identificadores de login do Portal.

**Email Técnico do Portal**
Identidade interna, aleatória e invisível usada pelo Portal para vincular o CNPJ
à autenticação. Não é email de recuperação, não é informado ao cliente e não é
aceito como identificador de login.

**Email de Recuperação do Portal**
Endereço usado para convites e recuperação de acesso. É separado da identidade
de login, pode ser compartilhado por mais de um CNPJ e pode ser alterado sob as
regras de segurança do Portal. A confirmação da troca — seja pelo cliente
(Portal → Perfil) ou de forma assistida por Documentação/Administrativo —
encerra as sessões existentes, no mesmo racional da troca de senha.

**Email candidato para o Portal**
Endereço encontrado em um contato existente do Cliente e apresentado para
análise manual. A finalidade indica o papel cadastrado (geral, financeiro ou
operacional) e a origem indica de qual cadastro o endereço veio; candidato não é
sinônimo de email autorizado nem é selecionado automaticamente.

**Seção Portal do Cliente da Ficha**
Seção específica da ficha completa do Cliente para exibir e operar o
provisionamento. Identifica o Email de Recuperação do Portal, deixando explícito
quando ele foi escolhido entre candidatos ou informado manualmente, além da
situação da conta, convite, alertas e histórico operacional.

**Convite do Portal**
Autorização temporária enviada ao email de recuperação para que a pessoa
autorizada defina a senha da Conta de Portal. É de uso único, expira em 48 horas
e não torna a conta ativa antes da definição da senha. Abrir o link apenas exibe
a tela de ativação; o token só é consumido quando o cliente envia uma senha
válida e a ativação conclui com sucesso.

Na tela de ativação, a empresa é identificada pelo nome e por um CNPJ
parcialmente mascarado, preservando os dois primeiros dígitos, a filial e os
dígitos verificadores (ex.: `12.***.***/0001-90`).

Após a ativação, o cliente vê a confirmação e é redirecionado ao login; não há
entrada automática na sessão do Portal.

**Token de Convite do Portal**
Valor aleatório, opaco e de uso único enviado no link do convite. Não contém
CNPJ ou email, e somente seu hash é persistido. A validação verifica finalidade,
vencimento e uso anterior antes do consumo atômico.

**Teste de replay de token**
Teste de segurança do piloto que tenta reutilizar um token consumido, expirado,
invalidado por reenvio ou inválido. O segundo uso deve falhar sem revelar
informações; qualquer replay aceito bloqueia a aprovação do piloto.

**Segredos privilegiados do Portal**
`service_role` do Supabase e chave da Resend ficam somente em Edge Functions ou
outros segredos do backend. Nunca são enviados ao navegador, gravados em logs ou
auditoria, nem usados pelo frontend para contornar RLS e permissões.

**Teste anti-enumeração e abuso**
Gate do piloto que verifica resposta genérica para CNPJ inexistente ou senha
incorreta, bloqueio após cinco falhas em quinze minutos por quinze minutos,
recuperação sem confirmação de existência e alerta ao Administrativo em abuso
recorrente.

**Teste de recuperação assistida e troca de email**
Gate do piloto que verifica senha atual, confirmação do novo endereço, manutenção
do email antigo até a confirmação, validação manual com justificativa e auditoria
quando a equipe intervém, e ausência de acesso do operador à senha final. Falhas
devem deixar o cadastro inalterado e chamadas não autorizadas devem ser negadas.

**Teste de logs e auditoria do Portal**
Gate do piloto que inspeciona logs de aplicação, navegador, rede e auditoria para
confirmar que senha, token bruto, `service_role`, chave da Resend e email completo
não sejam expostos. Qualquer vazamento bloqueia a aprovação do piloto.

**Evidência de testes do Portal**
Registro dos testes automatizados e manuais executados antes do piloto, com data,
versão, ambiente e resultado. O piloto só começa sem falhas críticas pendentes.

**Governança do piloto do Portal**
O Administrativo possui a aprovação final para iniciar e encerrar o piloto.
Documentação executa o provisionamento cotidiano dos clientes selecionados.

**Lista de clientes-piloto do Portal**
Relação de aproximadamente dez clientes representativos, preparada pela
Documentação e aprovada pelo Administrativo. Prioriza atividade real, email
validável e diversidade de casos; clientes sem email não recebem disparo real
e permanecem somente na fila operacional.

**Atendimento do piloto do Portal**
Documentação é o primeiro nível de atendimento e acompanha convites, ativações,
expirações e pendências. Administrativo trata exceções, incidentes de segurança
e decisões de encerramento do piloto.

**Critério de saída do piloto do Portal**
O piloto só termina quando cada cliente selecionado está Ativo ou possui a
exceção formal Provisionamento não necessário no momento, sem incidentes
críticos pendentes e com autorização final do Administrativo para avançar.

**Métricas do piloto do Portal**
O acompanhamento diário registra clientes selecionados, convites enviados e
entregues, ativações, expirações, bounces, tempo até ativação e pendências de
atendimento.

**Janela do piloto do Portal**
Não há prazo fixo. O piloto permanece aberto com acompanhamento diário até
cumprir o critério de saída; enquanto houver cliente pendente, não há avanço
para a abertura geral.

**Checklist de prontidão do piloto do Portal**
Antes do primeiro convite real, o Administrativo aprova domínio/DNS verificado,
Resend e webhooks configurados, backfill concluído, Console e alertas
operacionais, lista de clientes aprovada e canal de suporte monitorado.

**Sequência de GO LIVE do Portal**
Deploy sem disparos reais; pré-voo e backfill dos 309 Clientes; configuração e
verificação de domínio, Resend e webhooks; ativação de alertas e suporte; piloto;
aprovação final do Administrativo; abertura geral. Convites reais só ocorrem
depois das quatro primeiras etapas técnicas e operacionais.

**Gate de upgrade do Portal**
Antes da abertura geral, o Administrativo revisa métricas do piloto, cotas,
necessidade de backups e previsão de emails e decide formalmente se o ambiente
deve migrar para Supabase Pro e/ou Resend Pro.

**Rollback escalonado do Portal**
Em incidente operacional, novos convites são pausados sem apagar histórico.
Em incidente de segurança, sessões são revogadas e contas afetadas podem ser
suspensas. A retomada depende de decisão do Administrativo.

**Abertura geral gradual do Portal**
A aprovação do GO LIVE não dispara convites em massa. Cada Cliente permanece em
Aguardando análise até revisão individual da Documentação ou do Administrativo,
que seleciona o Email de Recuperação e envia o convite manualmente.

**Monitoramento pós-abertura do Portal**
Após a abertura geral, Documentação acompanha a fila e as métricas diariamente.
Alertas críticos continuam imediatos para o Administrativo, que pode pausar
convites ou executar o rollback escalonado quando necessário.

**Remetente transacional do Portal**
Identidade usada nos emails de convite, reenvio, recuperação e alteração de
email: `Transhipping — Portal do Cliente <portal@dominio-proprio>` (a marca
vem primeiro para sobreviver ao truncamento do nome do remetente em clientes
de email), com `Reply-To` em `suporte@dominio-proprio`. O domínio próprio
precisa estar verificado e com DNS configurado antes de envios a clientes
reais.

**Email de Convite do Portal**
Mensagem transacional sem senha, token legível ou dados financeiros. Identifica
a empresa e o CNPJ parcialmente mascarado, informa a validade de 48 horas e
orienta o destinatário a criar a própria senha ou avisar a Transhipping se não
for a pessoa autorizada.

**Email de Reenvio do Portal**
Mensagem que identifica um novo link, avisa que os anteriores foram invalidados
e reinicia a validade em 48 horas. Não expõe motivo interno, operador ou
histórico de tentativas.

**Email de Recuperação de Senha do Portal**
Mensagem com link de uso único, válido por uma hora, identificando a empresa e
o CNPJ parcialmente mascarado. Não contém senha ou token legível; a troca de
senha encerra as sessões anteriores.

**Tentativa de entrega transacional do Portal**
Registro de uma tentativa de email com chave de idempotência, eventos de envio,
entrega, bounce ou complaint e retries apenas para falhas transitórias. Após
três tentativas transitórias sem sucesso, a situação vira Falha no envio e
exige reenvio manual.

**Email suprimido do Portal**
Endereço marcado como indisponível após bounce permanente ou complaint. Não
recebe novos retries ou reenvios até a equipe informar/validar outro endereço;
o histórico permanece para auditoria e todos os CNPJs relacionados são
alertados.

**Template transacional do Portal**
Cada mensagem possui versão HTML responsiva e texto puro equivalente, sem pixel
de abertura ou rastreamento de clique.

**Webhook de entrega do Portal**
Evento do Resend aceito somente com assinatura válida e dentro da janela de
tempo. O ID do evento é deduplicado; persistem apenas metadados de entrega e o
histórico é atualizado de forma idempotente.

**Teste de assinatura e replay de webhook**
Gate do piloto que envia webhook com assinatura inválida, fora da janela de
tempo e repetido. Todos devem ser rejeitados sem alterar entrega, bounce ou
complaint; qualquer aceitação indevida bloqueia a aprovação do piloto.

**Alerta interno do Portal**
Pendência exibida somente no Console e na central `/alertas` para a equipe
interna. Alertas críticos também geram email imediato para usuários ativos de
Documentação e Administrativo; o resumo diário é enviado às 08:00 quando há
pendências ou atividade relevante. Financeiro consulta no sistema e Operações
não recebe pendências do Portal.

**Visualização global interna**
Capacidade do perfil Financeiro de abrir todas as telas e consultar todos os
registros, sem autorização para alterar dados. A única escrita do Financeiro é
a conciliação de pagamentos.

**Escopo de Operações**
Perfil com ações completas em Viagens e leitura operacional de B/Ls, containers,
veículos e manifestos vinculados. Não pode subir, editar ou excluir B/Ls, nem
alterar Clientes, Portal ou Financeiro.

**Escopo de Documentação**
Perfil com todas as ações de negócio, incluindo Clientes, Portal, B/Ls, Viagens,
Faturamento, taxas, invoices e alertas, exceto conciliação de pagamentos. Não
administra usuários internos, perfis ou permissões.

**Usuário interno atual**
No escopo atual existe apenas `lucca.juliatti@fwlog.com.br`, com papel
Administrativo. Os demais papéis ficam disponíveis para novos cadastros; uma
identidade Auth sem perfil ativo não possui acesso interno.

**Administrador ativo mínimo**
O sistema deve manter pelo menos um Administrador ativo. Não é permitido
desativar ou rebaixar o último Administrador, e alterações de perfil/status
exigem confirmação, motivo e auditoria.

**Dupla proteção RBAC**
A interface usa `can(permission)` para orientar e ocultar ações, mas a
autoridade real está em RLS, RPCs e Edge Functions, que devem rejeitar chamadas
indevidas feitas diretamente à API.

**Teste de isolamento por CNPJ**
Gate de segurança do piloto que tenta acessar e alterar, por chamadas diretas à
API, dados de outro Cliente/CNPJ. A interface ocultar a ação não é suficiente:
RLS, RPCs e Edge Functions devem negar o acesso; qualquer falha bloqueia a
aprovação do piloto.

**Desacoplamento financeiro do Portal**
Email de Recuperação e Conta de Portal não são pré-requisitos para revisão ou
faturamento. A ausência de qualquer um gera pendência operacional no Console,
na ficha e em `/alertas`, sem bloquear o gate financeiro.

Quando uma fatura é emitida sem Email de Recuperação ou sem Portal ativo, a
pendência é crítica, permanece aberta e entra no resumo diário interno, mas a
emissão da fatura não é bloqueada.

A exceção crítica da fatura fica vinculada àquela fatura e encerra-se quando ela
deixa de estar aberta, por exemplo após pagamento, cancelamento, substituição ou
obsolescência. Isso não encerra automaticamente a pendência geral do Cliente
sem Portal ativo.

A pendência geral só é encerrada quando a Conta de Portal fica ativa após o
cliente definir a senha ou quando a equipe registra a exceção formal
Provisionamento não necessário no momento, sempre com justificativa. Convite
enviado ou entregue continua como Aguardando ativação; expiração, bounce e
complaint permanecem críticos.

O encerramento automático de uma exceção crítica não envia email unitário de
resolução. O Console e `/alertas` são atualizados, e o encerramento entra como
atividade no próximo resumo diário das 08:00.

O alerta crítico de fatura é disparado uma única vez na transição da fatura para
Emitida, com deduplicação por fatura e evento. Alterações posteriores na mesma
fatura não repetem o email; uma nova fatura do mesmo Cliente gera novo evento.

**Exceção crítica da fatura**
Alerta vinculado a uma fatura emitida enquanto faltava Email de Recuperação ou
Conta de Portal ativa. Permanece aberto enquanto a fatura estiver aberta e é
encerrado quando ela é paga, cancelada, substituída ou se torna obsoleta, sem
resolver a prontidão geral do Cliente.

**Pendência geral de prontidão do Portal**
Indica que o Cliente continua sem Conta de Portal ativa, independentemente do
estado de uma fatura específica. Persiste até a ativação da Conta de Portal ou
o registro justificado de Provisionamento não necessário no momento.

**Área administrativa**
Rota e menu `/admin` são exclusivos do perfil Administrativo, incluindo
Usuários, logs, métricas e todas as subabas. Nenhum outro perfil visualiza sua
entrada.

**Aguardando análise**
Estado do Cliente que ainda não foi aprovado pela equipe para receber convite.
Os 309 Clientes da base inicial entram nesse estado. Nenhum envio ocorre
automaticamente; Documentação ou Administrativo deve revisar o Cliente, indicar
ou informar o Email de Recuperação e executar o convite individualmente.

**Backfill inicial do Portal**
Operação que cria o registro de Portal para cada um dos 309 Clientes em
Aguardando análise, sem selecionar emails candidatos, criar Conta de Portal,
criar identidade Auth ou disparar qualquer email. A contagem de identidades Auth
é revalidada imediatamente antes da execução; o inventário histórico não é uma
premissa operacional. Antes da escrita, um pré-voo somente leitura apresenta os
totais encontrados de Clientes, registros de Portal, vínculos Auth e emails
selecionados; divergência cancela a execução até confirmação do Administrador.

**Convite pendente**
Estado em que um convite foi enviado e ainda pode ser usado. A Conta de Portal
continua inativa até o cliente concluir a ativação.

**Convite expirado**
Estado de um convite cujo prazo terminou sem ativação. Exige alerta para a
Documentação e ação manual para novo envio.

**Conta de Portal ativa**
Estado em que o cliente já definiu sua senha e pode autenticar com o CNPJ.

**Provisionamento não necessário no momento**
Exceção registrada pela equipe para um Cliente que não precisa de acesso agora.
Novo processo ou cobrança devolve o Cliente para Aguardando análise.

**Sessão do Portal**
Sessão do Supabase Auth isolada da sessão do aplicativo interno no mesmo
navegador.

**Login do Portal**
Autenticação por CNPJ e senha. O CNPJ é normalizado antes da resolução e a
identidade interna é tratada fora da interface do cliente. Não utiliza senha
própria em tabela nem sessão por token legado.

**Dashboard do Portal**
Página inicial com resumo financeiro, indicadores operacionais, programação de
navios e alertas.

**Disputa de Demurrage**
Contestação do cliente sobre valores, dias ou condições de uma cobrança de
demurrage.

**Notificação In-App**
Mensagem exibida no Portal em resposta a eventos financeiros ou operacionais.
