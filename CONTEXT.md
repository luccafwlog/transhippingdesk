# Contexto do Sistema

Glossário de domínio do Transhipping Desk. Este arquivo define linguagem de
negócio; arquitetura e detalhes técnicos pertencem a `docs/ARCHITECTURE.md` e
aos ADRs.

Verificado em 2026-08-03.

## Operação marítima

**Viagem**
Unidade principal da operação: um navio identificado por número de viagem e
acompanhado em suas escalas, agendas e cargas.

**Viagem Cancelada**
Viagem que não será mais realizada pelo armador, embora tenha sido cadastrada
ou programada. O cancelamento preserva seus registros e vínculos para
rastreabilidade; não é conclusão nem exclusão.

**Alias de Nome de Navio**
Prefixo abreviado reconhecido como equivalente ao prefixo canônico do nome do
navio, sem alterar o nome exibido ou cadastrado. `ZYHY` equivale a
`ZHONG YUAN HAI YUN`; `CS` e `C.S.` equivalem a `COSCO SHIPPING`. A equivalência
é bidirecional, exige o alias como prefixo completo separado do restante do nome
e não dispensa a igualdade do número da viagem.

**Escala portuária**
Passagem de uma viagem por um porto brasileiro, identificada por
`(Viagem, porto)`, com datas operacionais, identificadores e vínculos
documentais próprios. Um porto, uma escala: a mesma escala pode descarregar
importação, embarcar exportação ou as duas coisas, e o sentido da operação não
a divide em registros diferentes. Portos estrangeiros da rota não são escalas —
permanecem como papel documental do B/L.

- **Distinto de:** POL e POD, que são papéis do conhecimento de embarque e da
  rota (`ETD do POL`, POD do B/L, POD omitido), não linhas do planejamento da
  Viagem.

**Exportação da Escala**
Declaração de que a escala terá embarque, com os dados próprios do sentido de
exportação: granito, containers vazios e movimentos previstos. É uma decisão
explícita do operador, não um estado derivado de haver número preenchido — uma
escala pode estar declarada como exportadora antes de qualquer quantidade ser
conhecida. Retirar a declaração é impossível enquanto houver carga de
exportação vinculada à escala (granito ou Embarque de Vazios); sem carga, a
retirada descarta os dados de planejamento.

**Próxima Escala**
Escala não omitida, com ETA informado e ainda sem ATA, que possui o menor ETA
entre as escalas pendentes da Viagem. Um ETA já vencido não retira a escala
dessa posição; ela permanece como Próxima Escala com a indicação “ETA vencido —
ATA pendente”.

**Linha do Tempo da Viagem**
Histórico operacional dos acontecimentos da Viagem, sem eventos financeiros.
Importações de B/L são consolidadas por rota, com quantidade, POL e POD; omissões
de escala informam o POD omitido, o Porto de Transbordo e o motivo quando houver.
Alterações editoriais de terminologia não são acontecimentos da Viagem e não
integram sua linha do tempo.

**Omissao de Escala**
Evento operacional em que o armador nao realiza a escala prevista em um POD. A
carga afetada e descarregada em outro porto da mesma viagem para seguir em
transbordo ou ser convertida em COD. Nao calcula nem automatiza financeiro.

**Porto de Transbordo**
Porto onde a carga de uma escala omitida é efetivamente descarregada para seguir
em transbordo ou receber COD. Pode ser diferente do POD original do B/L.

**Transbordo**
Seguimento da carga em navio de terceiro apos omissao de escala. Porto, navio,
armador, viagem, ETD e ETA de transbordo formam um registro global da omissao,
compartilhado pelos B/Ls afetados e complementado progressivamente conforme as
informacoes se tornam conhecidas. Esses dados sao referencia operacional leve,
nao uma nova Viagem; COD permanece uma excecao individual por B/L.

O ADR do Porto de Transbordo (Porto onde a carga foi efetivamente
descarregada) passa a contar essa carga, separada da carga de destino final
própria daquele porto — ver Porto de Transbordo e ADR.

O registro global e mantido na Viagem. Cada B/L afetado exibe os dados herdados
para consulta e conserva apenas sua acao individual de COD. Alteracoes do
registro global integram a Linha do Tempo da Viagem e o Historico dos B/Ls
afetados.
Cada complementacao e auditada pela RPC `update_voyage_omission`; a disposicao
`transshipment` ou `cod` continua no grao individual do B/L.

A disposicao individual (`transshipment`/`cod`) e operada na ficha do B/L; a
Viagem edita apenas o registro global e lista os B/Ls afetados para consulta.

No Portal, a omissao gera uma notificacao e o COD gera outra para o B/L
especifico. Os dados globais vigentes permanecem visiveis em Informacoes de
Transbordo; complementos posteriores atualizam esse card sem criar uma nova
notificacao a cada edicao.

**COD (Change of Destination)**
Alteracao operacional do destino final do B/L para o Porto de Transbordo apos
omissao de escala. E uma excecao por B/L e mantem efeitos financeiros manuais.
Nao reprecifica Taxas Locais: o fato gerador delas e a emissao do CE Mercante,
e a taxa devida continua sendo a do porto declarado no CE mesmo quando a carga
e retirada em outro porto.

- **Related:** Taxas Locais, Omissao de Escala, Porto de Transbordo

**Visao Geral do B/L**
Informa a aba padrao da ficha do B/L que consolida viagem e escalas,
transbordo/COD, carga, cliente, Portal e financeiro, com os trilhos operacional
e financeiro e a proxima acao.

**Rota da Viagem**
Sequência de portos de uma viagem. Cada escala pode registrar o ciclo completo:
ETA/ATA para chegada, ETB/ATB para atracação e ETD/ATD para saída. É o dado que o sistema
operacional consome — B/Ls e demais documentos de carga referenciam esses
mesmos portos.

**ATB (Actual Time of Berthing)**
Data e hora efetivas em que a embarcação atracou na escala. É distinta de ATA,
que registra a chegada, e de ETB, que registra a previsão de atracação.

**ATD (Actual Time of Departure)**
Data e hora efetivas em que a embarcação saiu da escala. É distinta de ETD,
que permanece a previsão de saída.

**Estado da Escala**
Estado operacional derivado das datas reais, não um status manual independente.
Com ATB e sem ATD, a escala está `Atracada`; ao receber ATD, passa
automaticamente a `Concluída`. Vale para qualquer escala, inclusive a que só
embarca. A conclusão de uma escala não implica, sozinha, a conclusão da Viagem.

**ETD do POL**
Data estimada de saída da viagem no porto de carregamento. Permanece como a
previsão da rota mesmo quando uma saída efetiva é posteriormente conhecida. É
registro documental da rota, distinto do ETD da Escala, que é o dado
operacional editado pelo operador.

**ATD do POL**
Data efetiva de saída da viagem no porto de carregamento. Para carga de
container, a data `Laden on Board` informada pelo B/L é sua fonte documental.
Quando B/Ls da mesma Viagem e POL informam datas diferentes, a data mais antiga
é o ATD canônico do POL.
Não sobrescreve o ATD da Escala: são registros de naturezas diferentes — o
documental do conhecimento e o operacional da escala — e podem divergir sem que
o sistema arbitre.
Em superfícies sem coluna própria de ATD, substitui visualmente o ETD e é
destacada em verde, sem transformar conceitualmente ATD em ETD.

**Programação de Navios (Chegadas e Saídas)**
Quadro de line-up exibido ao cliente no Portal, com a previsão de datas por porto
da rota. É uma **visão voltada ao cliente**, distinta do **Line-Up (TV)**, que é o
painel operacional derivado das viagens já cadastradas. Conforme a ADR 0021,
não há cadastro próprio: cadastrar em Chegadas e Saídas cria ou anexa a própria
Viagem e as suas Escalas, e a Programação exibida no Portal é uma projeção das
viagens marcadas como visíveis — inclusive as escalas que só embarcam.

O Line-Up e o Painel **segregam os sentidos**: uma escala que descarrega e
embarca aparece em duas linhas, uma de importação e uma de exportação, com as
**mesmas datas da Escala** e diferindo apenas no conteúdo operado. Escala de
sentido único produz uma linha só. É granularidade de exibição, não um segundo
registro: o planejamento da Viagem continua mostrando uma linha por Escala.

**ADR (Agency Departure Report)**
Relatório de escala do navio: cada escala brasileira de uma viagem gera um ADR
(duas escalas brasileiras, dois ADRs), com ou sem importação; portos de origem
estrangeiros não geram ADR. Escala
que só embarca gera ADR como qualquer outra, e o fechamento exige os três
sign-offs departamentais mesmo quando um departamento não tem nada a declarar.
Documenta tudo que aconteceu na escala — datas confirmadas, carga descarregada
e carregada, embarque e descarga de vazios, granito, carga solta, veículos,
armazenagem e depot dos vazios, overtime e ocorrências. É a fonte confiável
usada pelo Financeiro para aprovar pagamentos de faturas.

Containers cheios são contados exclusivamente pelos B/Ls (fonte documental,
ADR 0025); o Baplie não determina mais essa contagem. Carga em transbordo
(de uma Omissão de Escala) conta no ADR do Porto de Transbordo onde foi
efetivamente descarregada, separada da carga de destino final desse mesmo
porto — ver Transbordo e Porto de Transbordo. Vazio do Baplie sem B/L conta
como natureza própria (`vazio`) na listagem de carga descarregada, distinta
da classificação cama/cover plate da seção de Vazios descarregados.

O ADR é uma **exibição consolidada** de dados construídos nos módulos de
origem, não uma redigitação: carga, veículos, vazios, depot e overtime nascem
nos seus módulos; apenas ocorrências e sign-offs nascem no próprio ADR. Existe
desde que a escala existe; suas pendências só alertam após o ATD da escala.

A identidade do ADR é (viagem, porto): uma escala que opera em dois terminais
mantém um único ADR, com o terminal como atributo do cabeçalho. O armador
exibido no cabeçalho deriva do navio da viagem.

- **Related:** Seção do ADR, Resolução de Seção, Sign-off Departamental, Fechamento do ADR, Listagem do operado

- **Distinto de:** Architecture Decision Record (`docs/adr/`), que é documento
  de engenharia deste repositório. Em código e schema, usar sempre
  `agency_departure_report`, nunca `adr` solto.

**Seção do ADR**
Bloco temático do ADR com um departamento dono e um estado de resolução próprio.
São seis seções. A **Escala** — identidade do relatório (armador, navio/viagem,
porto, terminal) e datas confirmadas — abre o ADR sozinha, porque é o assunto do
relatório e não uma etapa dele. As outras cinco vêm na ordem do ciclo:
importação (carga descarregada, vazios descarregados, veículos) → exportação
(granito, embarque de vazios). O conteúdo derivado do sistema é
exibido, não redigitado; apenas a Observação e a resolução/sign-off nascem no
ADR. Divisão de donos:
- **Operações:** escala (identidade e datas confirmadas).
- **Documentação:** carga descarregada e vazios descarregados.
- **Equipamentos:** veículos, granito e embarque de vazios.

**Resolução de Seção**
Estado de uma seção quanto ao seu dono: Pendente → Confirmado ou Nada a declarar.
Ausência de dado não é conclusão: zero overtime sem resolução é seção Pendente,
não escala sem overtime. A primeira saída de Pendente é uma decisão que pede
confirmação explícita; alterar uma decisão já tomada — voltar a Pendente ou
trocar entre Confirmado e Nada a declarar — exige justificativa. Toda transição é
registrada em histórico (autor, momento, de→para e, quando aplicável,
justificativa).

**Listagem do operado**
Forma de exibição do ADR (aba e impresso) que lista apenas as combinações
(tipo × natureza, ou tipo × condição × local, conforme a seção) que
realmente ocorreram na escala, com o total no topo. Ausência de ocorrência
não vira linha zerada: uma seção sem nenhum dado mostra uma única linha
"Nada operado nesta escala" e continua exigindo Resolução de Seção
(Pendente/Confirmado/Nada a declarar) — ausência de dado não é conclusão.

**Sign-off Departamental**
Ato pelo qual um departamento assina, de uma vez, o conjunto das suas seções do
ADR, confirmando que refletem a realidade da escala. São três — Operações,
Documentação e Equipamentos — e o fechamento do ADR exige os três. Só é
habilitado quando todas as seções do departamento estão resolvidas (Confirmado
ou Nada a declarar); reabrir um sign-off já dado exige justificativa. Os alertas
de informação faltante, disparados após o ATD da escala, são por departamento
("Documentação pendente"), não por seção.

**Equipamentos**
Departamento responsável pelo embarque de vazios de exportação (VAZIOS EXP) e
pelos veículos. Vazios descarregados (importação) pertencem à Documentação.

**Overtime (de escala)**
Movimentação de vazios realizada fora do horário normal, cobrada pelo depot ou
pelo transportador. É declarada como uma **Linha de Serviço do Embarque**, igual
a qualquer outro serviço performado — não é acréscimo percentual derivado de
coluna importada nem de incidência configurada por serviço.
Alimenta o ADR; a conferência da fatura correspondente é do Financeiro.

**Embarque de Vazios (EXP)**
Registro operacional do embarque de containers vazios de exportação de uma
escala, criado do zero por Equipamentos no módulo VAZIOS EXP. Existe **um por
escala**, com a mesma identidade do ADR — (viagem, porto) —, e reúne duas partes
de naturezas distintas:

- a **Lista de Unidades Embarcadas** — o fato: quais containers foram
  embarcados, com suas datas; entra por planilha;
- as **Linhas de Serviço do Embarque** — o custo: quais serviços foram
  performados; entram manualmente.

O grão do módulo **deixou de ser o container**: uma linha de serviço não aponta
para containers específicos, e a lista de unidades não carrega preço. O único
ponto onde as duas partes se tocam é a armazenagem.

- **Related:** Unidade Embarcada, Linha de Serviço do Embarque, Operação de Pátio

**Unidade Embarcada**
Container vazio efetivamente embarcado na escala; item da Lista de Unidades
Embarcadas. Tem número, tipo, **local de origem** (sempre presente — um Depot ou
um Terminal Portuário do Cadastro de Terminais), condição, datas de entrada e
saída do depot e data de embarque. A lista é **completa**: inclui as unidades que
não geraram armazenagem — as de Terminal Portuário vêm sem datas de depot. É a
fonte da contagem de vazios embarcados e dos dias de armazenagem exibidos no ADR.

Unidade vinda de **Depot** tem obrigatoriamente as duas datas de gate; a única
unidade sem datas é a que veio de **Terminal Portuário**. Planilha que viole isso
não sobe: a divergência é apontada e a importação inteira é recusada.

**Linha de Serviço do Embarque**
Declaração de um serviço efetivamente performado na operação de vazios, lançada
manualmente pelo usuário. Cada linha tem serviço, tipo de container, quantidade,
valor unitário, local onde foi performado e — quando o serviço é transporte — a
rota percorrida (origem → destino). O mesmo serviço com tipos de container ou
rotas diferentes são **linhas diferentes**, porque o valor difere. O usuário
lança quantas linhas forem necessárias; o sistema não presume nenhuma.

Exceção única: a quantidade da linha de armazenagem é **preenchida a partir da
Lista de Unidades Embarcadas** (dias cobráveis daquele depot), não digitada. O
usuário pode sobrescrevê-la, e o sistema mantém o valor calculado visível ao
lado como referência.

A tela aponta as combinações (depot, condição) da Lista de Unidades que ainda
não têm linha de armazenagem lançada, com um atalho de um clique que já
preenche serviço, quantidade calculada e valor sugerido do Cadastro de
Terminais — o usuário ainda lança (um clique é um lançamento), o sistema só
para de fazê-lo procurar o que falta. Isso não presume a linha: sem cadastro de
armazenagem para aquela condição no depot, a tela não oferece o atalho e
aponta para o Cadastro de Terminais.

- **Distinto de:** Unidade Embarcada, que é fato operacional importado e não
  carrega preço.

**Cadastro de Terminais**
Registro dos locais com que a operação de vazios trabalha e dos **valores
sugeridos** de seus serviços. Cada local tem um **tipo**:

- **Depot** — local de armazenagem do vazio antes do embarque. Tem os dois Free
  Times de Storage e é o único tipo que gera armazenagem.
- **Terminal Portuário** — o próprio terminal da escala (ex.: TVV). Não tem free
  time e nunca gera armazenagem: a unidade que vem dele descarregou, ficou no
  local e está sendo reembarcada. Cobra serviços como qualquer outro local.

Não é a fonte do cálculo: ao lançar uma Linha de Serviço do Embarque, o usuário
escolhe o local e o serviço, e o sistema **sugere** o valor unitário registrado,
que ele pode sobrescrever naquela linha. O valor efetivo mora sempre na linha
lançada, e o cadastro não tem vigência — o valor sugerido vale até alguém trocá-lo.

A entidade nomeada é o **local**, não a "taxa": é distinta da Tabela de Taxas —
Granito, que é genuinamente uma tabela de tarifas.

- **Synonyms / avoid:** "Cadastro de Depot" (nome anterior, quando o cadastro só
  tinha depots), "Taxas de Vazios", "tabela de taxas de depot"
- **Distinto de:** o **porto** da escala (identidade `(viagem, porto)` do ADR,
  ex.: BRVIX). Um Terminal Portuário fica *dentro* de um porto. O terminal do
  cabeçalho do ADR continua sendo texto livre preenchido pelo setor responsável,
  sem vínculo com este cadastro.
- **Related:** Free Time de Storage, Embarque Direto, Linha de Serviço do
  Embarque, Natureza do Serviço, Tabela de Taxas — Granito

**Free Time de Storage**
Dias de armazenagem gratuita concedidos pelo depot ao container vazio antes do
início da cobrança. É atributo dos locais do tipo **Depot** e varia por depot **e
por condição da unidade**: um free time para o container totalmente vazio, outro
para o container com material do armador. A armazenagem cobrável de uma unidade
é `(saída do depot − entrada no depot + 1) − free time aplicável`, nunca
negativa — o +1 conta tanto o dia de entrada quanto o dia de saída como dias de
armazenagem. Distinto do Free Time de Demurrage, que se aplica à carga de
importação do cliente e não ao vazio no depot.

**Embarque Direto**
Unidade Embarcada cujo local de origem é um **Terminal Portuário**, não um
Depot: o container descarregou, permaneceu no terminal e está sendo reembarcado,
sem passar por depot. Vem sem datas de depot e não gera armazenagem. Não implica
ausência de custos: qualquer serviço performado sobre ele é declarado como Linha
de Serviço, como todos os demais.

**Hand-in / Hand-out**
Movimentos de gate do container vazio no depot: hand-in é a entrada, hand-out é
a saída, cada um com data por unidade embarcada. Os dias de armazenagem derivam
da diferença entre as duas datas (incluindo ambos os dias) menos o free time
aplicável; o ADR exibe o total de containers e de dias.

**Material do Armador**
Container vazio embarcado com material do armador em seu interior. Deriva da
Condição do Container Vazio, não de um campo independente.

**Condição do Container Vazio**
Estado do vazio no embarque, com dois valores: **totalmente vazio** ou **com
material do armador**. É atributo de cada Unidade Embarcada, define qual dos dois
free times do depot se aplica e separa as linhas de armazenagem — uma por
(depot, condição).

**Natureza do Serviço**
Comportamento de uma Linha de Serviço do Embarque, atributo do serviço no
Cadastro de Terminais. São três, e a natureza decide quais campos a linha exige:

- **`armazenagem`** — exige um local do tipo Depot e a condição; a quantidade (dias) é calculada a
  partir da Lista de Unidades Embarcadas; não tem percentual nem tipo de
  container; no máximo uma linha por (depot, condição).
- **`transporte`** — exige a rota, sendo o local da linha a origem e o destino o
  outro extremo.
- **`geral`** — exige apenas o local.

A lista de serviços é **aberta**: um serviço novo é cadastrado escolhendo sua
natureza, sem mudança de código. Os dez iniciais são armazenagem, transporte,
handling in, handling out, overtime handling, overtime transporte, bundle
composition, bundle organization, visual check e remoção.

A natureza define quais campos a linha exige e se a quantidade é digitada ou
calculada. O valor unitário do serviço já é o valor efetivo, inclusive quando o
serviço representa uma majoração ou overtime; a linha não recebe percentual.

- **Synonyms:** "forma de cobrança" (nome usado pela operação)
- **Distinto de:** Tipo de Cálculo da ADR 0032 (`fixo_por_container` /
  `storage_por_dias` / `quantidade`), que precificava automaticamente e foi
  aposentado pela ADR 0033.

**Valor da Linha**
O valor unitário gravado na Linha de Serviço do Embarque já é o valor efetivo
da cobrança. Serviços de overtime ou de majoração devem ser cadastrados com o
valor atualizado; a linha não oferece nem persiste percentual. O total é
`quantidade × valor unitário`.

**Operação de Pátio**
Subseção do ADR dentro de Embarque de vazios, que consolida o custo da operação
de vazios da escala: as Linhas de Serviço do Embarque com suas quantidades e
valores, e a armazenagem (containers e dias, com o custo junto). É exibição
derivada do Embarque de Vazios e alimenta a conferência das faturas pelo
Financeiro. **Não tem resolução própria** (ADR 0036): é uma das duas partes do
agregado Embarque de Vazios, ao lado de Containers embarcados — que exibe a
Lista de Unidades Embarcadas —, e as duas são cobertas pela resolução única da
seção. De 2026-07-21 a 2026-08-04 foi seção assinável separada (ADR 0029).

Serviços antes tratados como conceitos próprios (reorganização, bundle
composition, visual check, handling, transporte, overtime) não têm mais
existência separada no modelo: todos são Linhas de Serviço do Embarque.

**Natureza do Vazio Descarregado**
Classificação do container vazio descarregado: **cama** (base de estiva para
cargas OOG) ou **cover plate** (tampas para porões do navio).

**Restow**
Container descarregado e reembarcado por reestiva na mesma escala. A contagem
é registrada na edição da Escala (campo RTW).

**Local de Desova**
Local onde um container com veículo foi desovado. Atributo do container,
agregado por marca no ADR.

**Ocorrência da Escala**
Lançamento livre no diário da escala dentro do ADR: texto com autor,
departamento e data/hora, em lista append-only. Qualquer departamento registra,
marcado com o seu nome; a ocorrência pode, opcionalmente, referenciar uma seção
do ADR. Operações é dona do sign-off do diário. Cobre qualquer acontecimento
não estruturado da escala. Não possui taxonomia fixa.

**Fechamento do ADR**
Ato explícito que encerra o ADR quando os três departamentos assinaram (cada um
com todas as suas seções resolvidas). Congela um
snapshot dos dados derivados e próprios; é esse snapshot que o Financeiro
consulta para aprovar pagamentos — mudanças posteriores na origem não alteram o
relatório fechado. Reabrir exige justificativa auditada e novo fechamento. O
Financeiro não possui ato próprio de aprovação do ADR; o fechamento é o marco.
O ADR fechado é imprimível pelo navegador.

**Número de Escala do Mercante**
Identificador criado no sistema federal Mercante para uma escala do navio. Uma
viagem com múltiplos terminais pode ter mais de um número de escala.

**Vínculo de Manifestos à Escala**
Confirmação de que os manifestos foram vinculados à escala no Mercante. Não é
sinônimo de o Número de Escala existir.

**B/L (Bill of Lading / Conhecimento de Embarque)**
Documento de transporte que agrupa carga sob um consignatário. É a unidade
operacional usada para revisão, cobrança de taxas locais e vínculo com cliente.
O arquivo do B/L é a fonte documental de ingestão da carga de container: pode
criar um B/L inexistente e corrigir dados comerciais já gravados, além de ser a
fonte de Frete & Despesas do BL, da data de emissão e da data de embarque na
origem. A operação de container não depende da importação de Manifesto.

**Razão Social do Consignatário**
Nome empresarial curto exibido em tabelas e usado na reconciliação por nome. É
extraído até a natureza jurídica, incluindo combinações como `LTDA EPP`, e não
inclui endereço, telefone, CEP, cidade ou país. Quando nenhuma natureza jurídica
é reconhecida, corresponde à primeira linha não vazia do bloco do consignatário.
É distinta do bloco completo do consignatário, preservado para EDI e auditoria.

**Manifesto**
Documento que agrupa B/Ls de uma operação marítima. Para carga de container,
não é fonte de ingestão do sistema: os dados documentais entram pelos próprios
arquivos de B/L.

**CNTR**
Abreviação de domínio para container.

**Carga Solta / Breakbulk (BB)**
Carga transportada sem container, representada por itens, peso e volume
vinculados ao B/L.

**RoRo**
Carga rolante, especialmente veículos importados e vinculados a B/L e, quando
aplicável, ao container físico.

**Granito**
Carga de exportação: blocos de granito embarcados nas escalas brasileiras.
"Importação" no fluxo de Granito refere-se à ingestão das planilhas COSCO
(entrada de dados), não ao sentido da carga. É integrado à revisão e ao
faturamento, mas mantém regras e registros próprios.

## Baplie e reconciliação

**Baplie EDI**
Arquivo EDIFACT do plano de estiva. É a autoridade para a presença física de
containers, posição a bordo e flags operacionais. Essa autoridade física é
preservada, mas a **contagem** de containers cheios do ADR é documental (vem dos
B/Ls) — o Baplie não determina mais essa contagem; um container cheio do
Baplie sem B/L correspondente vira aviso de divergência, não conta como
carga.

**Staging Baplie**
Estado intermediário dos containers importados do Baplie antes da conciliação
com os B/Ls. Uma reimportação substitui o staging anterior da viagem.

**Conciliação Baplie × B/L**
Comparação, dentro da mesma viagem, entre a carga física do Baplie e os dados
documentais dos B/Ls.

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
Conhecimento agrupador por rota da viagem (POL/POD). Quando existe batch de
manifesto, vive no batch; em viagem só-B/L, é registrado por rota. É distinto
dos CEs individuais dos B/Ls e não entra no EDI.

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

**Ficha do Cliente**
Hub de consulta do Cliente em `/clientes/:cnpj`, organizado em abas (Visão
Geral, Cadastro & Contatos, Operacional, Financeiro, Histórico). Consolida a
visão de cadastro, operação e financeiro com deep links para agir nas telas
onde cada fluxo já existe; não duplica fluxos de ação. As únicas operações
executadas na própria ficha são a edição auditada do cadastro, a gestão de
contatos e o provisionamento embutido do Portal.

**Saldo Pendente do Cliente**
Soma do saldo das invoices locais emitidas e ainda não pagas — incluindo as
vencidas e as parcialmente pagas, pelo saldo restante — e das invoices de
Demurrage não pagas do Cliente, exibida com a decomposição entre as duas
origens. É leitura
consolidada para a Ficha do Cliente, não um novo conceito contábil: cada
origem mantém seu ciclo de vida próprio.

## Faturamento

**Taxas Locais**
Cobranças ligadas ao B/L, calculadas por tabelas, itens e eventuais regras
específicas do cliente.

O cálculo tem **duas fases**:

- **Provisória** — importar o B/L calcula as taxas com o que ele tem naquele
  momento. Serve para conferência: o operador extrai planilha e valida. Nada é
  emitido nem publicado. O import recalcula também os B/Ls **irmãos** — os que
  dividem container e ainda não têm fatura —, para que o rateio provisório fique
  certo mesmo quando o segundo B/L entra numa importação posterior.
- **Confirmada** — cadastrar o CE Mercante recalcula, fecha e só então emite a
  fatura e publica. É o cálculo do CE que produz o valor cobrado, quando todos
  os B/Ls da viagem já existem e o rateio de container compartilhado está certo.

O **fato gerador é a emissão do CE Mercante**, não a chegada da carga. Emitido o
CE, a taxa local é devida pelo porto declarado nele, e nada que aconteça depois
com o navio a altera: Omissão de Escala, Transbordo e COD são irrelevantes para
taxa local. No transbordo a carga chega ao POD original de qualquer forma; no
COD o cliente retira em outro porto por conveniência própria, e a taxa continua
sendo a do porto do CE — o desvio físico é ônus operacional do armador, não
reprecificação para o cliente.

Por isso a fatura de taxas locais é emitida dias antes da atracação: o cliente
precisa dela paga para retirar a carga, e não há fato posterior capaz de mudar
o valor.

B/Ls que dividem um mesmo container **recebem o CE no mesmo momento**. É essa
regra operacional — não uma trava de software — que garante o rateio correto de
taxa de container compartilhado.

- **Related:** Fato Gerador, Omissao de Escala, COD, Data de Referência da Tarifa

**Tabela de Taxas Locais**
Cadastro que define quais taxas locais existem e quanto custam, por POD e por
modo de carga, com vigência temporal. É a fonte de verdade dos valores padrão —
o sistema não tem preço embutido em código. Tem a mesma natureza da Tarifa de
Demurrage: condições cadastradas e valores correspondentes.

- **Synonyms / avoid:** "tabela de preços", "tarifa local"
- **Related:** Item de Taxa, Condição de Cliente, Tarifa de Demurrage

**Item de Taxa**
Linha da Tabela de Taxas Locais: a taxa em si, com o valor unitário e a regra
que determina sobre o que ela incide (o B/L inteiro, cada container, a tonelada
da carga solta). Divide-se em dois tipos que **não** se misturam:

- **Item automático** — aplicado pelo sistema a todo B/L elegível, sem
  intervenção.
- **Item manual** — existe no cadastro mas nunca é aplicado sozinho; depende de
  o usuário decidir lançá-lo naquele processo.

- **Related:** Tabela de Taxas Locais, Lançamento Manual

**Condição de Cliente**
Valor negociado com um Cliente específico para um Item de Taxa específico,
substituindo o valor padrão da tabela enquanto estiver vigente. É condição
comercial, não desconto pontual: aplica-se sozinha a todos os processos daquele
Cliente no período.

**Não pode haver duas Condições vigentes** para o mesmo Cliente e o mesmo Item
de Taxa. Sobreposição é erro de cadastro, não agendamento: são dois acordos
conflitantes para o mesmo período. Trocar uma condição exige fechar a vigência
da anterior. Por isso não existe — e não deve existir — critério de desempate.

Difere da Tarifa de Demurrage nesse ponto: aquela é lista de preço pública, onde
agendar uma vigência por cima da anterior é operação normal e a mais recente
vence. Condição de Cliente é acordo negociado, e conflito precisa aparecer.

- **Synonyms / avoid:** "desconto", "override de cliente"
- **Related:** Item de Taxa, Cliente, Tarifa de Demurrage

**Data de Referência da Tarifa**

Data que determina qual Tabela de Taxas Locais e qual Condição de Cliente valem
para um B/L: a **ETA da escala do POD**. Ancorar na escala garante que todos os
B/Ls do mesmo navio, no mesmo porto, sejam cobrados pela mesma tarifa — a taxa
local é cobrança de chegada, e "mesmo navio, preços diferentes" não é defensável
perante o cliente.

Não é a ATA: o CE Mercante — que dispara o cálculo — é cadastrado dias antes da
atracação, então a fatura já foi emitida quando a ATA passa a existir. Não é
a data de importação do B/L, que é fato administrativo e não comercial.

Difere deliberadamente do Demurrage, que resolve a tarifa pela vigência do dia
do cálculo: demurrage é cobrança por container e por dia, intrinsecamente
individual, então não produz a comparação "mesmo navio, preços diferentes".

- **Related:** Tabela de Taxas Locais, Condição de Cliente, Escala

**Movimento (FCL/LCL)**
Declaração do armador, presente no próprio B/L, sobre como a carga foi estufada
na origem e como é entregue no destino. É a fonte de verdade sobre um B/L ser
FCL ou LCL.

Aparece em **duas notações equivalentes**, e o B/L pode trazer qualquer uma das
duas — na prática `FCL`/`LCL` é a mais comum:

| Notação | Equivale a |
|---|---|
| `CY` (*Container Yard*) | `FCL` — container cheio |
| `CFS` (*Container Freight Station*) | `LCL` — consolidação/desconsolidação |

São **dois lados**: origem e destino. O B/L declara o par, e os mistos existem
(`FCL/LCL`, `LCL/FCL`). Para Taxa Local vale o **lado do destino** — taxa local
é cobrança de chegada, e o que define se há o que cobrar é quem executa a
movimentação no porto de destino. Num B/L `FCL/LCL` o armador entrega o
container na CFS e o cliente retira sua parte de lá: a movimentação de destino
não é do armador, logo não há taxa local dele. Num `LCL/FCL` é o inverso — há
taxa local.

A justificativa histórica da isenção ("taxas pagas na origem") é explicação
comercial, não critério: usar o lado da origem inverteria os dois casos mistos.

O operador pode sobrescrever a leitura do documento na ficha do B/L quando ele
vier errado ou vazio, e a correção fica registrada no Histórico.

Quando não há nem documento nem override, o sistema **cobra normalmente**. A
isenção exige LCL declarado; ausência não isenta. O modo de falha é cobrar de
quem talvez não devesse — visível e contestável — em vez de isentar quem devia
pagar, que não deixa rastro. A correção acontece na fase provisória do cálculo,
antes de qualquer fatura existir.

- **Synonyms / avoid:** "tipo de carregamento"
- **Related:** Isenção de Taxas Locais, Taxas Locais

**Isenção de Taxas Locais**

Dispensa de cobrança de taxas locais para carga de veículos **em LCL**, cujas
taxas foram pagas na origem. Depende de duas condições, não de uma: haver
veículo no B/L **e** o Movimento indicar LCL. Veículo em FCL paga normalmente, e
veículo sem Movimento declarado também — a isenção exige prova positiva.

A isenção é consequência de dado operacional (o cadastro de veículos), então
precisa ser conferível: as isenções aplicadas devem ser visíveis em tela, não
apenas inferíveis do valor zero.

- **Related:** Movimento (FCL/LCL), Taxas Locais

**Taxa Local em Dólar**

Item de Taxa cadastrado em USD — como a Booking Cancelation Fee. Converte-se em
BRL **na emissão da fatura**, pelo ROE vigente naquele momento, e o valor
convertido é congelado junto com o resto da fatura.

Difere do Demurrage, que recalcula o BRL a cada PTAX até o pagamento: ali a
dívida está correndo, aqui o valor já é devido por inteiro desde o CE. Aplicar
Recálculo Diário a uma taxa local criaria dois comportamentos para o mesmo
documento conforme a moeda do item.

- **Related:** ROE, Recálculo Diário, Item de Taxa

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

No cabeçalho interno, a referência cambial é a composição explícita PTAX Venda
× 1,065 = ROE, acompanhada da data efetiva da cotação. O Portal não exibe essa composição:
na aba Demurrage informa apenas o ROE vigente e sua data de atualização; cada
invoice paga preserva o ROE que foi congelado no pagamento.

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

## Alertas e notificações

**Alerta**
Pendência operacional registrada automaticamente pelo sistema e compartilhada
por toda a equipe interna. Existe uma única vez, tem ciclo de vida próprio
(aberto → reconhecido → fechado) e é tratada uma única vez: quando alguém
reconhece ou fecha, o estado passa a valer para todos. Responde "o que ainda
precisa ser feito".

**Notificação Interna**
Aviso pessoal entregue a um usuário interno sobre um Evento Notificável, com
estado de leitura próprio de cada destinatário. Responde "o que aconteceu e eu
preciso saber". Não é sinônimo de Alerta: um Alerta origina Notificações
Internas para vários destinatários, e há Notificações Internas que não nascem
de Alerta.

**Cópia Congelada**
Invariante da Notificação Interna: ela descreve o Evento Notificável como ele
ocorreu, não o estado atual da entidade envolvida. Reconhecer ou fechar o
Alerta não apaga nem altera as Notificações Internas já entregues — o registro
de que o usuário foi avisado permanece.

**Evento Notificável**
Acontecimento do sistema que origina Notificações Internas. Abrange os
acontecimentos que já registram Alerta e um conjunto explícito de
acontecimentos que interessam ao usuário sem constituir pendência a tratar.

**Regra de Destinatários**
Declaração, por tipo de Evento Notificável, de quais papéis internos recebem a
Notificação Interna. É a única fonte da audiência: quem produz o evento não
decide quem é avisado.

**Eco de Tratamento**
Notificação Interna emitida aos demais destinatários quando alguém reconhece ou
fecha um Alerta. Existe para impedir que duas pessoas trabalhem a mesma
pendência sem saber.

**Leitura e Reconhecimento**
Ações distintas e sem acoplamento. Ler é pessoal, vale apenas para quem leu e
não altera o Alerta. Reconhecer é ato da equipe sobre o Alerta e vale para
todos.

**Indicador Operacional**
Contagem derivada de uma consulta ao estado atual, como containers com
demurrage vencido ou B/Ls de granito sem cálculo. Não é Alerta nem Notificação
Interna: não tem instante de ocorrência nem estado de leitura, e por isso não
entra na entrega pessoal.

## Portal do Cliente

**Portal do Cliente**
Interface externa onde o cliente consulta painel, faturas, B/Ls, containers,
notificações, disputas e perfil.

**Provisionamento do Portal**
Processo interno de analisar o Cliente, validar o Email de Recuperação do Portal,
autorizar e enviar o Convite do Portal e acompanhar a ativação da Conta de
Portal. Autorizar ou enviar o convite não torna o Cliente provisionado; o
provisionamento só se conclui quando a Conta de Portal fica Ativa após a pessoa
autorizada definir a senha.

**Provisionamento autorizado**
Decisão auditada de Documentação ou Administrativo que confirma o Email de
Recuperação do Portal e inicia o envio do Convite do Portal na mesma operação.
Pode coexistir com Ativação pendente, Convite expirado ou Falha no envio, pois a
decisão da equipe e a situação da conta são dimensões diferentes.

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

**Ativação pendente**
Situação em que o envio do Convite do Portal foi aceito e existe um token válido,
mas a pessoa autorizada ainda não concluiu a ativação definindo a senha. Não
significa necessariamente que o email foi entregue ou aberto; entrega,
bounce/rejeição e ativação são acompanhados separadamente. No armazenamento,
essa situação mantém o código técnico `convite_pendente`.

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

**Escopo de Equipamentos**
Perfil com ações completas em Vazios de Exportação (VAZIOS EXP) e Veículos,
além do Sign-off Departamental das suas seções do ADR (veículos e embarque de
vazios). Leitura no restante do sistema. Não altera Clientes,
Portal ou Financeiro.

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

O lado do frontend que lê essa recusa é `classifyDbError` em
`src/lib/errors.ts`: uma tabela de códigos Postgres/PostgREST para `kind` e
mensagem em português. É o único lugar do app que decide o que o operador vê
quando o banco nega, sem deixar `details` ou `hint` chegarem à tela.

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
enviado ou entregue continua como Ativação pendente; expiração, bounce e
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

**Notificação In-App do Portal**
Mensagem exibida ao cliente no Portal em resposta a eventos financeiros ou
operacionais. Destina-se ao cliente e não à equipe interna; o aviso pessoal
equivalente do sistema interno é a Notificação Interna, com destinatário,
audiência e ciclo próprios.

**Provisionamento do Portal (pré-piloto)**
O acesso operacional entra pelo cabeçalho de Clientes e mantém `/clientes/portal` como console dedicado. O console usa expansão inline, filtro Todos, deep links `?cliente={id}` e exportação XLSX. Candidatos são apenas sugestões e nunca alteram automaticamente o Email de Recuperação.
