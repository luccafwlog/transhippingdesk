# 2026-08-24 — Escala e Atracação: datas de berço por terminal

Origem: duas sessões de grilling — a primeira sobre o modal de edição da Viagem
e o modal de Escala, a segunda (mesma data) sobre o **layout do modal de Escala**
e sobre os **alertas por escala/terminal**. Decisões registradas na nota
editorial de 2026-08-24 da
[ADR 0035](../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md)
e da [ADR 0039](../adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md);
termos em [`CONTEXT.md`](../../CONTEXT.md) (**Atracação**, **Escala portuária**,
**Estado da Escala**, **ATB**, **ATD**, **ETD do POL**, **ATD do POL**).

## Problema

As datas da escala tinham dois donos e nenhuma regra. `mergeEscalaField`
preenchia `escala.etd` com o ETD documental do POL sempre que o lado POD
estivesse vazio — então o operador via uma data que não digitou, apagava, e ela
voltava. O modal da Escala coletava ATB/ATD globais **e** ATB/ATD por terminal
sem regra de precedência, e o ADR impresso lia os globais: dois terminais no
mesmo porto imprimiam datas idênticas.

## Modelo alvo

| Entidade | Datas próprias |
|---|---|
| **Escala** `(viagem, porto BR)` | ETA, ATA. Expõe **ATD derivado** = o da última Atracação, só quando todas têm ATD |
| **Atracação** `(escala, terminal)` | ETB, ATB, ETD, ATD, **Restow**. Uma por terminal, ordem **derivada** de `COALESCE(ATB, ETB)`, pode existir sem terminal (TBC, no máximo uma) |
| **ETD/ATD do POL** | documentais, sem vínculo com nenhuma das duas |

Estado da Escala: `Atracada` com alguma Atracação com ATB e sem ATD;
`Concluída` quando todas têm ATD; sem estado entre duas Atracações.

A Atracação **nasce da frente operacional**: atribuir terminal a uma frente cria
a Atracação, e nenhuma existe sem frente. Sua ordem nunca é digitada.

## Tasks

### T1 — Migration `341_atracacao_datas_por_terminal.sql`

Sobre `voyage_escala_terminal_state` (criada em `306_escala_multiplos_terminais.sql`):

- Adicionar `terminal_etb TIMESTAMPTZ` e `terminal_etd TIMESTAMPTZ` — as duas
  previsões que hoje não têm onde morar.
- **Sem coluna de ordem.** A sequência da Atracação é derivada de
  `COALESCE(ATB, ETB)`, com empate desfeito pelo código do terminal, numa única
  função compartilhada (T2). Coluna digitada envelheceria contra as próprias
  datas ao lado; derivada, ela só fica indefinida enquanto não há data nenhuma —
  momento em que também não há nada a ordenar.
- Tornar `terminal_id` NULLABLE (Atracação TBC). O `UNIQUE (voyage_id, port,
  terminal_id)` não basta: o Postgres trata cada NULL como distinto e permitiria
  várias TBC. Acrescentar índice único parcial `WHERE terminal_id IS NULL`. A FK
  composta `(terminal_id, port_id)` é MATCH SIMPLE e deixa de ser cobrada quando
  `terminal_id` é NULL — comportamento desejado, mas anotar em comentário.
- CHECKs: manter `terminal_atd >= terminal_atb`; acrescentar
  `terminal_etd >= terminal_etb`.
- Regenerar `src/types/database.ts` (arquivo protegido — ver
  `.claude/hooks/protect-files.sh`).

Sem backfill: a base ainda não carrega operação real — o que existe é massa de
teste, descartável. Mesma dispensa que o ponto 3 da nota de 2026-08-03 da
ADR 0035 aplicou. A decisão não se apoia em contagem de linhas num dia
específico; se a implementação começar depois de a operação entrar, esta
dispensa precisa ser reavaliada antes da T1.

**Check:** teste de constraint — duas Atracações TBC na mesma escala são
rejeitadas; `terminal_etd < terminal_etb` é rejeitado.

### T2 — Projeção (`src/services/voyageRouteSchedules.ts`)

- `VoyageEscalaSchedule` perde `etb`, `atb`, `etd` e `rtw` próprios; ganha a
  lista ordenada de Atracações e o `atd` derivado com completude.
- `mergeEscalaField` deixa de fundir `etd` e `atd`; `VoyageEscalaDivergence`
  perde esses dois campos e mantém `escalaNumber`. **É esta mudança que encerra a
  queixa que abriu a revisão** — o ETD que reaparecia na escala vem do portador
  POL, gravado tanto pelo modal da Viagem (T4) quanto por Chegadas e Saídas, e só
  a remoção da fusão o impede de voltar.
- Uma função única de ordenação das Atracações — `COALESCE(atb, etb)`, empate
  pelo código do terminal — consumida pela projeção, pelo modal (T3) e pelo
  Line-Up (T5). Hoje `orderTerminalIds` e `projectLineUpTerminals` repetem a
  heurística cada uma do seu jeito.
- Remover `getVoyageUnifiedAtd` — perdeu o consumidor quando o relógio do ADR foi
  para o terminal (T6).
- `computeVoyageStatusFromPods` passa a ler o ATD derivado da Escala.

**Check:** teste do cenário GREEN CHASE — TVV (ETB/ATB 26/08, ETD 28/08, ATD
29/08) e Portmac (ETB 28/08, ATB 29/08, ETD 01/09, ATD 02/09) projetam
`escala.atd = 02/09`; retirando o ATD do TVV, `escala.atd` fica nulo e a Viagem
não conclui.

### T3 — Modal da Escala (`src/components/shared/VoyageScheduleModals.tsx`)

O modal passa a ter **duas metades declaradas** — a Escala e as Atracações — em
vez de seis blocos alternando de grão. Ordem nova:

| # | Bloco | Campos | Grão |
|---|---|---|---|
| 1 | Identidade | Porto, Nº Escala (Mercante) | Escala |
| 2 | Chegada ao porto | ETA, ATA + **ATD derivado, só leitura** | Escala |
| 3 | Operação da escala | importação / exportação → granito / vazios → CNTR, Movimentos, Portos de descarga | Escala |
| 4 | Documentação | BLs e CEs, Vinculada | Escala |
| 5 | Frentes e Atracações | frente → terminal; por terminal: ETB, ATB, ETD, ATD, Restow | Atracação |
| 6 | Justificativa | conforme a regra abaixo | — |

- **O ATD derivado aparece em só leitura no bloco 2**, com a origem escrita
  ("derivado da última Atracação — Portmac") ou o que falta ("aguardando o ATD do
  TVV"). Sem isso o operador procura o campo ATD da Escala e não encontra.
- **O bloco 3 fica acima do 5.** Hoje o toggle de exportação está abaixo das
  frentes de exportação que ele cria: atribui-se terminal a uma frente que só
  passa a existir depois de rolar a tela e marcar a caixa.
- **Dentro da Parte A a ordem é por frequência de edição**, não por hierarquia:
  quem abre este modal abre para mexer em data, não para redeclarar o tipo de
  operação.
- Remover o par global ATB/ATD e o campo **RESTOW** da escala; os três passam a
  ser por Atracação.
- Remover a trava de `saveVoyagePodSchedule` que rejeita ETA/ATA/ETB/ATB quando
  `tem_importacao = false`: o navio que só embarca também chega e atraca. A trava
  também derruba a gravação em lote de Chegadas e Saídas (T9).
- Escala nova nasce com `temImportacao = true` (`VoyageVisaoTab.tsx:133` usa
  `?? false` hoje, e digitar ETA numa escala nova falha).
- Corrigir a copy "Nenhum terminal atribuído. As datas globais ATA/ATD permanecem
  acima." — deixa de ser verdade.

**Justificativa: previsão nunca pede, realizado pede.** Alterar ETA/ETB/ETD não
exige justificativa — previsão mudar é a natureza dela, e exigi-la no campo mais
volátil do modal treina a equipe a preencher "ajuste". Alterar um **realizado já
registrado** (ATA/ATB/ATD) exige, porque é afirmar que o fato antes registrado
estava errado. Preencher um realizado vazio não pede; trocar o valor pede;
**esvaziá-lo pede** — apagar um fato é a correção mais forte. Frentes e terminal
continuam pedindo, como hoje. É a mesma lógica do bloqueio por ADR fechado: os
dois protegem afirmações, com pesos diferentes.

**Criação passa a usar a mesma RPC.** Hoje o `useEffect` de `Viagens.tsx:114`
retorna cedo quando o porto é nulo, então escala nova nunca carrega estado
terminalizado e **sempre** cai no caminho legado — que, depois da divisão, grava
campos que deixaram de existir. O formulário de criação continua enxuto (só a
Parte A: na criação a Atracação genuinamente não existe, porque ela nasce da
frente, que nasce da declaração que está sendo feita naquele instante), mas a
gravação vai por `save_escala_terminal_state` com listas vazias e
`expectedRevision = 0`. A RPC já foi escrita para isso: trava a viagem em vez da
escala *"mesmo quando ela ainda não tem state próprio"* (`306`, linha 617), cria
a linha em `ports` quando o LOCODE é novo (linha 629) e assume `revision = 0` sem
estado anterior (linha 651). Isso elimina de quebra a gravação em duas chamadas
sem transação comum ao criar uma escala que já nasce com granito.

**Check:** teste do modal — escala só de exportação aceita ETA e ATB; escala nova
com ETA salva por uma única chamada de RPC; alterar ETA não pede justificativa e
alterar uma ATA já preenchida pede.

### T4 — Modal da Viagem (`VoyageCreateModal.tsx`, `voyageForm.ts`, `voyages.ts`)

- Remover as seções "Portos de carregamento (POL)" e "Portos de descarga para o
  Line-Up", e com elas `loadPortEtds`/`dischargePortEtas` do form,
  `syncLoadPortEtds`/`syncDischargePortEtas` do serviço, e o
  `temImportacao = true` implícito que esse sync reinjetava a cada save.
- A âncora do 1º Porto Brasileiro permanece; a validação do `superRefine` passa a
  ler as Escalas persistidas da viagem, e o toggle nasce **desabilitado na
  criação** com a explicação de que é preciso ao menos uma escala.

Isto encerra três achados da revisão: o modal que não devolvia o que mostrava, o
placeholder `Ex.: SANTOS` que gravava porto por nome (nunca virava escala, pois a
projeção exige `^BR[A-Z0-9]{3}$`), e a ressurreição de importação em escala só de
exportação. **Não encerra a queixa que abriu a revisão** — o ETD que reaparecia é
fundido pela projeção e também chega por Chegadas e Saídas; quem o encerra é a T2.

Chegadas e Saídas não é afetada: `createOrAttachVoyageFromSchedule` já chama
`createVoyage` com `loadPortEtds: []` e `dischargePortEtas: []`.

**Check:** teste do form — salvar a viagem não altera nenhuma data de escala.

### T5 — Line-Up, Painel e TV (`src/services/lineup.ts`, `LineUpTable.tsx`)

Grão **mantido**: uma linha por `(escala, sentido)`, conforme o ponto 2 da nota
de 2026-08-03 da ADR 0035.

- ETA/ATA da Escala (inalterado).
- **ETB/ATB da primeira Atracação que hospeda uma frente daquele sentido** — hoje
  as duas linhas mostram o mesmo ETB da escala, e a de exportação exibe o ETB de
  um terminal que não é o dela.
- `projectLineUpTerminals` ordena pela função compartilhada da T2, não pela sua
  própria heurística.
- `deriveEscalaState` passa a receber as Atracações.

**Check:** teste de projeção — importação no TVV e exportação na Portmac produzem
ETB 26/08 e 28/08 nas respectivas linhas.

### T6 — ADR (`agencyDepartureReport.ts`, `AgencyReportDocument.tsx`, `VoyageAgencyReportTab.tsx`)

- O impresso passa a usar ATB/ATD **e Restow da Atracação daquele terminal**; ATA
  continua vindo da Escala. `AgencyReportDocument.tsx:577` imprime ATD e Restow
  na mesma célula, lendo os dois da escala: corrigir só o ATD deixaria o
  documento internamente incoerente, e ele circula até o Financeiro.
- T0 do Prazo de Conclusão = ATD daquela Atracação (nota de 2026-08-24 da ADR
  0039).

**Check:** teste — dois ADRs do mesmo porto imprimem ATB/ATD distintos e prazos
distintos (TVV vence 03/09, Portmac 07/09, contando 3 dias úteis).

### T7 — Alertas de datas (migration, sobre `326_voyage_operation_alerts.sql`)

O reconciliador já itera por terminal, mas compara contra as datas da **escala**
nos **dois** ramos, não só num: a linha 518 compara o ETB da escala e a 528 o
ETD. Com um ETB só, o alerta "ATB pendente" dispara em todos os terminais ao
mesmo tempo. Ambos passam a ler a própria Atracação, agora que as colunas
existem (T1).

`voyage_schedule_date_pending` perde dois dos seus três degraus, porque cobram
campos que a Escala deixa de possuir. A escada nova:

| Alerta | Degraus |
|---|---|
| `voyage_schedule_date_pending` (Escala) | ETA vencido sem ATA; **chegou e nenhuma Atracação tem ETB** |
| `voyage_terminal_date_pending` (Atracação) | ETB vencido sem ATB; ATB sem ETD; ETD vencido sem ATD |

O degrau de ausência fica na Escala de propósito: ele não afirma nada sobre
terminal nenhum, afirma que o conjunto está vazio — predicado do porto. Sem ele,
o intervalo entre a chegada do navio e a definição do terminal ficaria em
silêncio, que é justamente quando a operação precisa ser cobrada.

**TBC:** uma Atracação sem terminal **conta** para o degrau de ausência (há
plano, falta escolher onde) e **não gera** alerta próprio (não há terminal a
cobrar). Isso também resolve um defeito que a T1 introduziria: os laços das
linhas 462 e 514 montam `v_term_entity_id` concatenando `terminal_id::text`, e
com `terminal_id` nulo a concatenação zera a string inteira — `resolve_alert_item`
passaria a ser chamado com entidade nula. O destino `?escala=..&terminal=<uuid>`
tem o mesmo problema.

**Fechar os órfãos:** itens abertos hoje com milestone `etb`/`etd` na entidade
`voyage_pod_schedule` não têm mais quem os reconcilie. A migration fecha-os
explicitamente, com motivo registrado.

**Check:** teste SQL — terminal atracado sem ATD com ETD vencido só alerta o seu
próprio terminal; escala com ATA e duas Atracações TBC gera o alerta de ausência
e nenhum alerta por terminal.

### T8 — Alertas do ADR (migration, sobre `323`, `271` e `251`)

**Fonte do T0.** `reconcile_agency_report_alerts` já tem entidade por terminal
(`agency_report_alert_entity_key`), mas calcula `v_atd := COALESCE(v_pod_atd,
v_pol_atd)` da escala (`323`, linha 402) e deriva o `deadline_date` daí (linha
458) — dois ADRs do mesmo porto vencem no mesmo dia. Passa a ler o ATD da
Atracação daquele relatório. O comentário da linha 383 diz hoje que *"terminal-local
dates are operational detail and must not change the ADR deadline source"*: essa
frase é exatamente o que a nota de 2026-08-24 da ADR 0039 inverteu, e precisa ser
reescrita junto.

**O fallback do POL sai.** O ATD do POL é documental e não tem vínculo com escala
nem terminal; um prazo de relatório operacional é precisamente um vínculo com a
operação. Some `v_pol_atd` e some a metade da elegibilidade que o lê (linhas
432-435). Sem Atracação com ATD não há prazo — regra que a ADR 0039 já tem
escrita, então a ausência já está tratada. Decorrências:

- A linha `voyage_pol_schedule_atd` de `agency_report_pending_baselines`
  **permanece na tabela** e deixa de ser lida: é registro de uma vigência que
  existiu, e a ADR 0039 trata vigência como coisa que não retroage.
- O instante de vigência da pendência continua sendo `2026-07-19`.

**Um produtor só, com relógio de parede.** `agency_report_deadline_missed` tem
hoje dois produtores vivos em grãos diferentes: `detect_agency_report_deadline_missed()`
(`271`) varre por `(viagem, porto, departamento)` e faz `INSERT` direto em
`alerts`; a fundação da `323` reconcilia por `(viagem, porto, terminal)` com
`alert_items` por departamento. Os dois estão no runner unificado (`332`, linhas
43-44), junto de `detect_agency_report_pending()`, que tem o mesmo defeito. Hoje
isso duplica; depois da mudança, contradiz.

As duas funções legadas **param de inserir alertas** e passam a apenas iterar os
ADRs abertos chamando `reconcile_agency_report_alerts`. Uma definição da regra,
mantendo a varredura — que é indispensável, porque **prazo vence por relógio, não
por evento de auditoria**: se o T0 foi lançado na terça e o prazo vence na
sexta, não existe evento na sexta para a trigger reagir. Os alertas legados
abertos são fechados na mesma migration, com motivo registrado.

**Check:** teste SQL — dois ADRs do mesmo porto, com ATD de Atracação em 29/08 e
02/09, recebem prazos distintos; escala cujo único ATD está no POL não gera
prazo; a varredura não cria nenhum alerta fora da fundação.

### T9 — Chegadas e Saídas (`voyageFromSchedule.ts`)

A maioria das escalas nasce aqui, por `createOrAttachVoyageFromSchedule`. A troca
de informações entre as duas telas **já está no grão certo**: a view da migration
`277` monta POL → `etd` + `atd` e POD → `eta` + `ata`, e nenhuma data de berço
aparece em Chegadas e Saídas. A divisão Escala/Atracação é invisível para ela.

- As chamadas de `saveVoyagePodSchedule` (linha 157 e, em `cancelClearedLanes`,
  linha 103) repassam `etb`, `atd` e `rtw` só para não perdê-los; os três saem do
  payload. Mecânico, sem perda de comportamento.
- **`podHasOperationalAnchor` (linha 69) é a quebra destrutiva do plano.** Ela
  decide se limpar uma célula na planilha apenas zera a ETA ou **apaga a escala**
  (`deleteVoyagePodSchedule`), e testa `current?.linked || current?.ata ||
  current?.atd`. O `atd` deixa de existir na Escala. A âncora passa a ser
  **`revision > 0`**: qualquer escala que já passou pela RPC — porque alguém
  atribuiu terminal, lançou data de berço, declarou exportação ou corrigiu um
  realizado — está protegida.

  O teste de hoje protege datas, e o que a divisão criou não é só data:
  `deleteVoyagePodSchedule` grava um evento `deleted` no POD e vai embora,
  deixando estado terminalizado e declaração de exportação órfãos na base.
  `revision > 0` é a marca de que houve trabalho humano pela porta transacional.
  O pior caso da regra nova é uma escala que sobrevive e se remove em dois
  cliques na tela de Viagens; o pior caso da regra velha é perder trabalho de
  operação ao limpar uma célula de planilha.

**Check:** teste — escala com Atracação e sem ATA sobrevive ao esvaziamento da
lane; escala nunca editada continua sendo apagada.

### T10 — Visão geral (`VoyageVisaoTab.tsx`)

- Colunas ETB/ATB/ETD/ATD saem da linha da escala; a linha mostra ETA, ATA e o
  ATD derivado.
- As Atracações aparecem sob a escala, com as suas datas e o terminal (ou TBC).

**Check:** teste de render — escala com duas Atracações lista as duas em ordem.

### T11 — Documentação

- `docs/RASTREABILIDADE.md`: rotas/componentes/serviços tocados por T2–T10.
- `docs/ARCHITECTURE.md`: a Atracação na descrição do módulo de Viagens.
- `docs/CHANGELOG.md`: a entrega.
- Ao concluir: mover este plano para `docs/archive/plans/` e remover a linha de
  `docs/plans/README.md`, conforme `docs/CONVENCOES.md`.

## Ordem

T1 destrava T2, T6, T7 e T8. T3–T5, T9 e T10 dependem de T2. T4 é independente.

**Comece pela T2**, não pela T4: é a T2 que encerra a queixa que originou a
revisão (o ETD que reaparecia na escala e não podia ser alterado). A T4 continua
sendo a menor e encerra três achados, mas nenhum deles é o relatado.

A T9 é a única com risco destrutivo — se a T2 for entregue sem ela, uma escala
pode ser apagada ao se limpar uma célula em Chegadas e Saídas. **T9 vai junto
com a T2, no mesmo lote.**

## Fora de escopo

- Reatracação no mesmo terminal na mesma Escala (shifting, ou retorno ao TVV
  depois da Portmac). O `UNIQUE (voyage_id, port, terminal_id)` permanece; a
  promoção da Atracação a `(viagem, porto, sequência)` fica como evolução, e o
  nome do conceito já nasce preparado para ela.
- Promover a Escala a tabela própria (`port_calls`), adiada desde a ADR 0027.
