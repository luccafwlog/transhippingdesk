# Escala com múltiplos terminais e ADR por terminal

Status: **implementação pendente** — desenho concluído na sessão de grilling em
2026-08-18. Esta spec é o contrato de implementação; não descreve comportamento
já entregue.

Esta spec registra decisões de domínio já fechadas que **ainda não estão
implementadas**. Enquanto ela viver aqui, o `CONTEXT.md`, o
`docs/ARCHITECTURE.md` e o schema continuam descrevendo o comportamento atual
— identidade `(viagem, porto)`. O `CONTEXT.md` só será promovido depois que a
implementação, a migration, os testes e os gates de execução forem concluídos;
essa promoção acontecerá na mesma mudança que comprovar o modelo, junto com a
ADR de engenharia.

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

## Decisão 3 — terminal é registrado e escolhido no modal da escala

O terminal não é digitado livremente no ADR. Ele é um terminal portuário
registrado no Cadastro de Terminais, selecionado no modal da escala para cada
Frente de Operação. O ADR terminalizado recebe essa atribuição derivada; não
existe um segundo ato de escolher ou editar o terminal no cabeçalho do ADR.

A implementação deve resolver que a tabela `depots` **não tem porto** (colunas: `code`,
`name`, `tipo`, `free_time_*`, `active`). Um terminal cadastrado hoje não sabe a
que porto pertence, então nada impediria vincular um terminal de Santos a uma
escala de Vitória.

## Decisão 4 — a atribuição do operado ao terminal é manual e obrigatória no modal

Nenhum módulo de origem carrega terminal, e não haverá inferência. No modal da
escala, o usuário **aponta** a que terminal registrado cada Frente de Operação
pertence, e o preenchimento é **impeditivo** — sem ele a operação não segue.

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

## Decisão 5 — Line-Up, Painel e TV mantêm uma linha por sentido e terminal como coluna

Cada escala que opera ou declara um sentido produz exatamente uma linha daquele
sentido no Line-Up, no Painel e na TV; uma escala com os dois sentidos produz
uma linha de importação e uma de exportação. O terminal é uma coluna/atributo
da linha, nunca um novo eixo de agrupamento: vários terminais do mesmo sentido
aparecem na mesma célula, em ordem determinística. A ausência de terminal é
exibida como `TBC`, sem salvar o placeholder e sem criar ADR. Chegadas e Saídas
não é afetado.

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
Direto); passa a precisar conter **todo terminal onde qualquer navio atraca**.

Isso deixa em aberto **onde esse cadastro é mantido**. "Aba de terminal no
Painel", da nota original, acabou resolvida como a coluna de terminais do
Line-Up (Decisão 13) — não uma tela nova. A Decisão 14 adia a escolha de outra
superfície: por ora, o cadastro continua em `/embarquevazios/depots`, mesmo que
o consumidor principal passe a ser a atribuição de escala, não Vazios.

## Decisão 7 — a unidade atribuível é a Frente de Operação `(sentido, modalidade)`

**Frente de Operação** é o nome canônico. "Natureza da carga" não serve —
natureza já nomeia três conceitos; "movimento" também não — é FCL/LCL.

São seis, e elas **não** coincidem com as seis seções do ADR:
`carga_descarregada` contém duas, e `datas` não é carga. Vazio aparece nos dois
sentidos, então a modalidade sozinha não identifica: a chave é o par.

As quatro frentes de importação existem quando há dado operacional real:
container cheio, carga solta, vazio importado ou veículo. As duas frentes de
exportação existem quando a escala tem declaração explícita de exportação de
granito e/ou vazios, mesmo que ainda não haja linhas operacionais realizadas.
Assim, importação é baseada em dado e exportação é baseada em declaração; a
existência de uma frente de exportação não é inferida de quantidade preenchida.

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

Uma frente existente sem terminal aparece como `TBC` somente na apresentação.
`TBC` não é terminal, não é persistido e não cria ADR. Enquanto qualquer frente
estiver em `TBC`, todos os ADRs da escala permanecem impedidos de fechar.

Recusado o bloqueio no sign-off da seção: não cobre a frente órfã, que não está
em seção de ADR nenhum e portanto não tem sign-off para bloquear.

## Decisão 9 — ATA/ATD são globais; ATB/ATD/Restow são do terminal

A seção Escala do ADR impresso mostra hoje ATA, ATB, ATD e Restow
(`AgencyReportDocument.tsx:558-562`). ETA/ETB/ETD são planejamento e vivem na
Visão geral e no Line-Up.

Com dois ADRs lendo as datas da escala, o ADR do TVV imprimiria o ATB da PORTMAC
e, como ATD, o momento em que o navio zarpou **da PORTMAC** — um documento
assinado pelos três departamentos afirmando que o navio saiu do TVV numa hora em
que estava atracado em outro terminal. O Financeiro usa esse relatório para
aprovar pagamento.

As datas ficam consolidadas no nível em que o fato acontece:

| Dado | Campo e nível | Regra |
|---|---|---|
| ATA | `escala.ata`, global | o navio chega ao porto uma vez |
| ATD | `escala.atd`, global | o navio deixa o porto uma vez |
| ATB | `terminal_atb`, por terminal | o shifting pode criar uma segunda atracação |
| ATD | `terminal_atd`, por terminal | registra a desatracação daquele terminal |
| Restow | `terminal_rtw`, por terminal | é operação de berço e não pode ser duplicado entre ADRs |

Para cada terminal, `terminal_atd` é nulo ou satisfaz
`terminal_atd >= terminal_atb`; nunca pode ser anterior à atracação do mesmo
terminal. ATA e ATD globais não são duplicados em cada terminal.

Nada que hoje lê `escala.atd` quebra. As projeções terminalizadas passam a ler
as datas do terminal correspondente, preservando as datas globais da escala.

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

## Decisão 11 — cada ADR fecha por conta própria; reatribuir sobre ADR fechado exige reabrir

Fechamento é independente por terminal. No GREEN PECEM, o TVV termina sua
descarga e o navio segue — não faz sentido segurar o fechamento do TVV
esperando a PORTMAC terminar de embarcar granito dias depois. A trava da
Decisão 8 já garante o necessário: nenhum dos dois fecha enquanto houver frente
sem terminal na escala.

A aba ADR da viagem passa a listar uma entrada por `(escala, terminal)`, em vez
de uma por escala brasileira.

**Reatribuir uma frente cujo ADR já fechou exige reabrir aquele ADR primeiro.**
Se o TVV fechou com "Importação × Carga solta" atribuída por engano, e a
correção manda essa frente para a PORTMAC, o ADR do TVV precisa reabrir antes.
Reusa o mecanismo que já existe — `reopen_agency_departure_report`, que exige
justificativa e registra em histórico — em vez de criar um novo. Coerente com a
regra que o `CONTEXT.md` já aplica às seções: "alterar uma decisão já tomada...
exige justificativa".

Recusado deixar a reatribuição mudar o conteúdo de um ADR fechado
silenciosamente: um `closed_snapshot` assinado deixaria de bater com o que a
tela mostra, sem que ninguém percebesse — o mesmo relatório que o Financeiro usa
para aprovar pagamento.

O `closed_snapshot` de um ADR reaberto por reatribuição é regravado no novo
fechamento, como já acontece hoje para reabertura por qualquer outro motivo.

## Decisão 12 — o terminal entra no título da aba e no nome do PDF exportado

O cabeçalho impresso já mostra o campo Terminal
(`AgencyReportDocument.tsx:558-562`); com a Decisão 3 ele passa a vir do
cadastro em vez de texto livre, e já basta para diferenciar os dois ADRs *dentro*
do documento aberto.

O motivo para ir além do cabeçalho é operacional, não estético: dois PDFs
salvos com o mesmo nome de arquivo (`ADR - GREEN PECEM V.9 - BRVIX.pdf` para os
dois) numa mesma pasta de e-mail é erro de usuário esperando para acontecer —
alguém anexa o errado numa cobrança sem abrir para conferir. O nome do arquivo
precisa diferenciar antes de abrir.

O título da aba e o nome do PDF exportado passam a incluir o terminal:
`ADR - GREEN PECEM V.9 - BRVIX - TVV.pdf`.

## Decisão 13 — a coluna de terminal é derivada por sentido

A Decisão 5 fixa a cardinalidade das linhas. A coluna de terminais lista, na
mesma linha daquele sentido, os terminais das Frentes de Operação atribuídas a
ele. A escala que opera nos dois sentidos continua com duas linhas, não com uma
linha por terminal ou por `(escala, terminal, sentido)`. A implementação usa
`src/components/lineup/LineUpTable.tsx:57-73`.

A coluna lista os terminais das Frentes de Operação **daquele sentido**, coerente
com o resto da linha — que já só exibe dado do próprio sentido (VIN só aparece
na linha de importação, granito só na de exportação). No GREEN PECEM: a linha de
Importação mostra "TVV, PORTMAC"; a de Exportação mostra "PORTMAC".

Recusadas as alternativas que criavam um segundo eixo de linhas — uma linha por
`(escala, terminal)` ou por `(escala, terminal, sentido)` — por reabrirem uma
partição que a ADR 0035 já resolveu, sem necessidade.

## Decisão 14 — o cadastro fica em `/embarquevazios/depots` por ora

Adiado, não descartado. Migrar a tela é refactor de UI puro, sem risco de
modelo: `depot` e `terminal_portuario` continuam a mesma tabela, só muda onde
ela é editada. Resolver agora só adicionaria escopo a uma decisão que já é
grande — identidade do ADR, atribuição, datas, Line-Up.

O custo aceito: Operações, que passa a ser quem mais usa esse cadastro para
atribuir Frentes de Operação, entra por um módulo que não é o seu
(`/embarquevazios/depots`) até que a tela mude de lugar, se mudar. Vira item de
UI separado, decidido depois.

## Decisão 15 — migração compatível, sem reset nem backfill destrutivo

A migration deve ser compatível com os registros existentes. ADRs legados
continuam preservados e legíveis sob a identidade `(viagem, porto)`, inclusive
seus sign-offs, ocorrências, snapshots e histórico; a coluna textual legada não
é apagada nem reinterpretada automaticamente. ADRs novos usam a identidade
`(viagem, porto, terminal)` e o terminal registrado atribuído pelas frentes.

Não haverá reset da base, limpeza ampla, exclusão/recriação de registros ou
backfill destrutivo. A transição deve adicionar o modelo terminalizado sem
perder dados históricos e sem escolher terminal automaticamente para um ADR
legado.

## Estado das decisões e dependências

Não há pendência de domínio para esta spec. Todas as decisões estão fechadas:

A3 (Decisão 6), B1 (Decisão 7), B2 (Decisão 8), C1 (Decisão 9), D1
(Decisão 10), D3 — fechamento (Decisão 11), D3.1 — impresso (Decisão 12), E1 —
Line-Up (Decisões 5 e 13), E2 — cadastro adiado (Decisão 14), F1 — migração
compatível (Decisão 15).

Alertas, issue #519 e issue #524 são dependências posteriores e estão fora do
escopo do comportamento deste plano. Não há, nesta mudança, contrato de alerta
por terminal, prazo departamental ou alteração do catálogo de notificações. A
revisão dessas dependências só ocorre depois que o núcleo terminalizado estiver
implementado e validado contra o modelo real.

O próximo passo é a ADR de engenharia e a execução do plano em
`docs/plans/`; o `CONTEXT.md` só será atualizado após os gates definidos para
essa execução.
