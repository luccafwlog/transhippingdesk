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
pode bloquear a visibilidade de dados e documentos no Portal do Cliente.

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
específicas do cliente.

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
Valor informado na tela de login: CNPJ, CPF ou email.

**Email Técnico do Portal**
Email associado à conta e usado internamente pelo Supabase Auth. O cliente pode
entrar com documento sem precisar conhecer esse email.

**Sessão do Portal**
Sessão do Supabase Auth isolada da sessão do aplicativo interno no mesmo
navegador.

**Login do Portal**
Resolução do identificador para o email técnico, quando necessário, seguida da
autenticação por senha no Supabase Auth. Não utiliza senha própria em tabela nem
sessão por token legado.

**Dashboard do Portal**
Página inicial com resumo financeiro, indicadores operacionais, programação de
navios e alertas.

**Disputa de Demurrage**
Contestação do cliente sobre valores, dias ou condições de uma cobrança de
demurrage.

**Notificação In-App**
Mensagem exibida no Portal em resposta a eventos financeiros ou operacionais.
