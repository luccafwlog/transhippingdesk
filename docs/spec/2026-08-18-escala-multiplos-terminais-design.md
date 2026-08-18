# Escala com múltiplos terminais e ADR por terminal

Status: **em desenho** — sessão de grilling aberta em 2026-08-18.

Esta spec registra decisões de domínio já fechadas que **ainda não estão
implementadas**. Enquanto ela viver aqui, o `CONTEXT.md`, o
`docs/ARCHITECTURE.md` e o schema continuam descrevendo o comportamento atual
— identidade `(viagem, porto)`. A atualização daqueles documentos acontece na
mesma mudança que implementar o modelo, junto com a ADR de engenharia e a
migration.

## Caso operacional que motiva a mudança

GREEN PECEM V.9, escala BRVIX:

1. Atraca no terminal **T.V.V** e descarrega os containers de importação.
2. Terminada a descarga, faz **shifting** para o terminal **PORTMAC**.
3. Na PORTMAC descarrega a carga solta e embarca **granito** e **containers
   vazios**.

Um porto, uma escala, dois terminais — e os escopos operados são **disjuntos**:
nada do que foi feito no TVV foi feito na PORTMAC. Hoje o sistema produz um
relatório só para os dois.

## Decisão 1 — a identidade do ADR passa a ser (viagem, porto, terminal)

Cada Terminal da Escala gera o seu próprio ADR, com as suas seis seções, os
seus três sign-offs departamentais e o seu fechamento próprios, declarando
apenas o que foi operado naquele terminal. O terminal deixa de ser rótulo do
cabeçalho e passa a ser parte da identidade.

Isso supersede:

- `CONTEXT.md`, verbete **ADR (Agency Departure Report)**: "A identidade do ADR
  é (viagem, porto): uma escala que opera em dois terminais mantém um único
  ADR, com o terminal como atributo do cabeçalho."
- ADR 0027, que ancorou o relatório em `(voyage_id, port)`.
- ADR 0035, que reafirmou a âncora `(viagem, porto brasileiro)` e decidiu que a
  escala gera **um** ADR nos três casos (só importação, só exportação, ambos).

O que **não** muda: a Escala continua sendo `(Viagem, porto)`, portos
estrangeiros continuam fora, e escala que só embarca continua gerando ADR com
os três sign-offs.

## Superfície afetada (levantada, não decidida)

| Onde | Estado atual |
|---|---|
| `supabase/migrations/213_agency_departure_reports.sql:18` | `UNIQUE (voyage_id, port)` |
| `agency_departure_reports.terminal` | texto livre, sem vínculo com o Cadastro de Terminais |
| RPC `set_agency_report_terminal(p_voyage_id, p_port, p_terminal)` | grava o rótulo do cabeçalho |
| `src/services/agencyDepartureReport.ts` | lê o relatório por `(voyage_id, port)` |
| `src/components/voyages/VoyageAgencyReportTab.tsx` | `<input>` de terminal no cabeçalho |
| `src/services/voyageRouteSchedules.ts` | `VoyageEscalaSchedule` não tem terminal |
| `docs/ARCHITECTURE.md` | documenta a âncora `(voyage_id, port)` |
| `CONTEXT.md` (Embarque de Vazios, Cadastro de Terminais) | repetem a identidade `(viagem, porto)` |

## Decisão 2 — a Escala planeja seus terminais; os ADRs derivam da lista

Uma escala pode ter mais de um terminal. A lista vive na **Escala**, não no ADR:
é ela que o Line-Up, o Painel e a TV leem. O ADR não inventa terminal — deriva.

## Decisão 3 — terminal é sempre um terminal cadastrado, nunca texto livre

O `agency_departure_reports.terminal` de texto livre acaba. O terminal passa a
referenciar o cadastro do sistema.

Pendência que isso abre: a tabela `depots` **não tem porto** (colunas: `code`,
`name`, `tipo`, `free_time_*`, `active`). Um terminal cadastrado hoje não sabe a
que porto pertence, então nada impediria vincular um terminal de Santos a uma
escala de Vitória.

## Decisão 4 — a atribuição do operado ao terminal é manual e obrigatória

Nenhum módulo de origem carrega terminal, e não haverá inferência. O usuário
**aponta** a que terminal cada parcela da operação pertence, e o preenchimento é
**impeditivo** — sem ele a operação não segue.

O grão da atribuição **não é a seção do ADR**. Verificado em
`src/components/voyages/AgencyReportDocument.tsx:583` e `:621`: "Carga solta" e
"Matriz de descarga" pertencem ambas à seção `carga_descarregada`, com o mesmo
dono e o mesmo sign-off. No caso GREEN PECEM os containers de importação foram
ao TVV e a carga solta à PORTMAC — dois terminais dentro de uma seção só. Uma
atribuição por seção não representaria o caso que motivou a mudança.

**A atribuição é o único ato.** Não existe cadastro de "lista de terminais da
escala" separado dela: os terminais distintos que aparecem na atribuição **são**
os terminais da escala, e cada um faz nascer o seu ADR. Isso elimina por
construção dois estados inconsistentes — terminal declarado sem nada operado
nele (ADR vazio pedindo três sign-offs sobre nada) e carga atribuída a terminal
fora da lista — sem precisar de regra de validação para nenhum dos dois.

O custo aceito: não há como registrar um terminal *previsto* antes de existir
carga atribuível a ele.

## Decisão 6 — o terminal da escala sai do Cadastro de Terminais, com porto obrigatório

O conceito já existe e já tem nome: o `tipo = 'terminal_portuario'` do Cadastro
de Terminais é definido no `CONTEXT.md` como "o próprio terminal da escala
(ex.: TVV)". Não se cria entidade nova.

Duas mudanças no cadastro:

- **Porto obrigatório** para `terminal_portuario`; ausente para `depot`, que é
  pátio de vazio, atende região e não fica dentro de um porto. O seletor da
  escala passa a oferecer só os terminais do porto daquela escala. Sem isso, um
  erro de seleção não é cosmético: cria um ADR inteiro pendurado no porto
  errado.
- **Só `terminal_portuario` é selecionável** como terminal da escala. Depot
  nunca — é onde o vazio dorme, não onde o navio atraca.

Consequência aceita: o cadastro deixa de ser acessório do módulo de Vazios.
Hoje um `terminal_portuario` só está lá se algum vazio veio dele (Embarque
Direto); passa a precisar conter **todo terminal onde qualquer navio atraca**. É
o que justifica tirá-lo de `/embarquevazios/depots` — ver E2.

## Decisão 7 — a unidade atribuível é a Frente de Operação `(sentido, modalidade)`

**Frente de Operação** é o nome canônico. "Natureza da carga" não serve —
natureza já nomeia três conceitos; "movimento" também não — é FCL/LCL.

São seis, e elas **não** coincidem com as seis seções do ADR: `carga_descarregada`
contém duas, e `datas` não é carga. Vazio aparece nos dois sentidos, então a
modalidade sozinha não identifica: a chave é o par.

| Sentido | Modalidade | Seção do ADR | Fonte |
|---|---|---|---|
| Importação | Container cheio | `carga_descarregada` | `bls`, `cargo_mode = 'container'` |
| Importação | Carga solta | `carga_descarregada` | `bls`, `cargo_mode = 'carga_solta'` |
| Importação | Vazio | `vazios_descarregados` | Baplie / vazios importação |
| Importação | Veículo | `veiculos` | módulo RoRo |
| Exportação | Granito | `carga_carregada` | `granite_bls` |
| Exportação | Vazio | `vazios_embarcados` | `vazios_export_operations` |

No caso GREEN PECEM: containers → TVV; carga solta, granito e vazios embarcados
→ PORTMAC. Quatro atribuições, dois terminais, dois ADRs.

### Teto aceito: uma frente inteira vai para um terminal só

O shifting pode partir uma modalidade no meio — 200 containers no TVV, shifting,
50 na PORTMAC. O modelo não representa isso: a frente aponta um terminal só.
Quando acontecer, o registro vai na Observação da seção.

A alternativa recusada era atribuir no grão do documento (cada B/L, cada
veículo, cada unidade). Representa tudo, mas troca quatro cliques por centenas
de atribuições manuais impeditivas por escala — o oposto de simplificar.

O teto deve ser marcado com `ponytail:` no código conforme o `CLAUDE.md`,
nomeando a limitação (modalidade partida entre terminais) e o caminho de
upgrade (descer o grão para o documento). O grão só desce, nunca precisa subir:
a decisão não fecha essa porta.

## Decisão 8 — a atribuição é impeditiva no fechamento, e olha a escala inteira

A Frente de Operação **só existe quando tem dado**: escala sem veículo nenhum
não tem frente de veículos e não tem o que atribuir. Sem essa premissa, toda
escala nasceria com seis atribuições obrigatórias, cinco delas sobre nada — o
ADR vazio que a Decisão 4 eliminou, de volta em outra forma.

O bloqueio não pode morar na criação do ADR: como o ADR nasce da atribuição, a
frente não atribuída simplesmente não produz ADR nenhum e nada acusa. Também
não fica na entrada do dado — na importação documental o navio muitas vezes nem
chegou, e travar ali pararia o pipeline, que corre independente da operação
física.

**Nenhum ADR da escala fecha enquanto houver frente com dado e sem terminal.**
O bloqueio é da escala inteira, não do ADR isolado: fechar o ADR do TVV exige
que todas as frentes da escala estejam atribuídas, inclusive as que foram para
a PORTMAC. Enquanto a carga solta estiver sem terminal, ela ainda pode ser do
TVV — fechar o TVV nesse estado é assinar "completo" sobre escala com carga sem
dono. Mesma lógica que o `CONTEXT.md` já aplica às seções: "Ausência de dado não
é conclusão".

Recusado o bloqueio no sign-off da seção: não cobre a frente órfã, que não está
em seção de ADR nenhum e portanto não tem sign-off para bloquear.

## Decisão 9 — chegada e partida são da escala; atracação, desatracação e restow são do terminal

A seção Escala do ADR impresso mostra hoje ATA, ATB, ATD e Restow
(`AgencyReportDocument.tsx:558-562`). ETA/ETB/ETD são planejamento e vivem na
Visão geral e no Line-Up.

Com dois ADRs lendo as datas da escala, o ADR do TVV imprimiria o ATB da PORTMAC
e, como ATD, o momento em que o navio zarpou **da PORTMAC** — um documento
assinado pelos três departamentos afirmando que o navio saiu do TVV numa hora em
que estava atracado em outro terminal. O Financeiro usa esse relatório para
aprovar pagamento.

Cada data passa a morar no nível em que o fato acontece:

| Dado | Nível | Razão |
|---|---|---|
| ATA | Escala | o navio chega ao porto uma vez |
| Atracação (ATB) | Terminal | o shifting cria uma segunda |
| Desatracação | Terminal | **campo novo**; não existe hoje |
| ATD | Escala | o navio deixa o porto uma vez |
| Restow (`rtw`) | Terminal | é operação de berço; na escala, os dois ADRs imprimiriam o mesmo número e a soma dobraria |

Nada que hoje lê `escala.atd` quebra. O Line-Up continua exibindo um ATB da
escala: o do primeiro terminal na ordem de atracação.

Recusada a inversão completa (todas as datas no terminal, escala derivando):
a escala existe antes de qualquer terminal, porque a atribuição vem depois, e
escala sem terminal ficaria sem data nenhuma.

## Decisão 10 — o Embarque de Vazios continua um por escala

"Exportação × Vazio" é **uma** Frente de Operação, e pelo teto da Decisão 7 uma
frente aponta um terminal só. Logo os vazios embarcados de uma escala vão todos
para o mesmo terminal por construção: o Embarque de Vazios não precisa se partir.
Ele passa a saber a que terminal pertence lendo a frente.

O `CONTEXT.md` precisa trocar "mesma identidade do ADR — (viagem, porto)" por uma
referência à frente, já que a identidade do ADR mudou embaixo dele.

### Embarque Direto deixa de afirmar permanência

O glossário define Embarque Direto como a unidade cuja origem é um Terminal
Portuário — "o container descarregou, **permaneceu no terminal** e está sendo
reembarcado". Antes desta mudança a afirmação era verdadeira por construção: um
porto, um terminal. Agora um vazio pode descarregar no TVV e embarcar na
PORTMAC, e o caminhão entre os dois desmente a permanência.

Cai a frase. Embarque Direto passa a significar apenas "origem é Terminal
Portuário, não Depot". O custo do transporte entre terminais já é representável:
a Linha de Serviço de transporte tem rota origem → destino e o cadastro aceita
terminal portuário nas duas pontas.

Recusado criar um caso próprio para a transferência entre terminais: não
corrigiria nada que já não seja lançável, e o glossário é explícito em não
presumir lançamento ("o sistema não presume nenhuma").

## Decisão 5 — cada terminal gera uma linha no Line-Up, no Painel e na TV

Chegadas e Saídas não é afetado.

## Questões em aberto

Ordenadas por dependência.

| # | Bloco | Questão |
|---|---|---|
| A3 | Modelo | Terminal cadastrado precisa saber seu porto? Quem é selecionável? |
| B2 | Atribuição | O que exatamente o "impeditivo" bloqueia |
| C1 | Datas | Quais datas são da escala e quais são de cada terminal |
| D1 | ADR | Embarque de Vazios: um por escala ou um por terminal |
| D3 | ADR | Fechamento e impresso |
| E1 | Superfícies | Terminal × sentido: quantas linhas no Line-Up |
| E2 | Superfícies | Aba de terminal no Painel — escopo |
| F1 | Transição | Os `terminal` de texto livre já gravados, e a migration |

Prazo departamental e alertas estão fora do escopo desta spec: correm em
trabalho paralelo.

### Colisão de terminologia a resolver em B1

O vocabulário livre é escasso. Já estão tomados:

- **Natureza** — três conceitos: Natureza do Serviço (armazenagem/transporte/
  geral), a natureza da matriz de descarga (tipo × natureza) e a `natureza` do
  vazio de importação (cama/cover plate).
- **Movimento** — FCL/LCL (`CONTEXT.md:784`).

Livre e já usado no sentido certo: **modalidade**, na nota editorial da ADR 0035
("Granito é modalidade de carga da exportação... A coluna 'Opera' diz sentido,
não modalidade").
