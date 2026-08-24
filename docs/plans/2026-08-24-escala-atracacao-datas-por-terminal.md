# 2026-08-24 — Escala e Atracação: datas de berço por terminal

Origem: sessão de grilling sobre o modal de edição da Viagem e o modal de
Escala. Decisões registradas na nota editorial de 2026-08-24 da
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
| **Atracação** `(escala, terminal)` | ETB, ATB, ETD, ATD, restow. Uma por terminal, ordem explícita, pode existir sem terminal (TBC, no máximo uma) |
| **ETD/ATD do POL** | documentais, sem vínculo com nenhuma das duas |

Estado da Escala: `Atracada` com alguma Atracação com ATB e sem ATD;
`Concluída` quando todas têm ATD; sem estado entre duas Atracações.

## Tasks

### T1 — Migration `341_atracacao_datas_por_terminal.sql`

Sobre `voyage_escala_terminal_state` (criada em `306_escala_multiplos_terminais.sql`):

- Adicionar `terminal_etb TIMESTAMPTZ` e `terminal_etd TIMESTAMPTZ` — as duas
  previsões que hoje não têm onde morar.
- Adicionar `sequencia INTEGER NOT NULL` com a ordem da Atracação na Escala. Sem
  ela a ordem cai em `ATB`, e sem ATB lançado cai no código do terminal em ordem
  alfabética — Portmac antes de TVV.
- Tornar `terminal_id` NULLABLE (Atracação TBC). O `UNIQUE (voyage_id, port,
  terminal_id)` não basta: o Postgres trata cada NULL como distinto e permitiria
  várias TBC. Acrescentar índice único parcial `WHERE terminal_id IS NULL`. A FK
  composta `(terminal_id, port_id)` é MATCH SIMPLE e deixa de ser cobrada quando
  `terminal_id` é NULL — comportamento desejado, mas anotar em comentário.
- CHECKs: manter `terminal_atd >= terminal_atb`; acrescentar
  `terminal_etd >= terminal_etb`.
- Regenerar `src/types/database.ts` (arquivo protegido — ver
  `.claude/hooks/protect-files.sh`).

Sem backfill: em 24/08/2026 a produção tinha 1 viagem, 2 escalas, zero eventos de
ETB/ATB/ATA/ATD e um único ETD, resolvido à mão. Mesma dispensa que o ponto 3 da
nota de 2026-08-03 da ADR 0035 aplicou.

**Check:** teste de constraint — duas Atracações TBC na mesma escala são
rejeitadas; `terminal_etd < terminal_etb` é rejeitado.

### T2 — Projeção (`src/services/voyageRouteSchedules.ts`)

- `VoyageEscalaSchedule` perde `etb`, `atb`, `etd` próprios; ganha a lista
  ordenada de Atracações e o `atd` derivado com completude.
- `mergeEscalaField` deixa de fundir `etd` e `atd`; `VoyageEscalaDivergence`
  perde esses dois campos e mantém `escalaNumber`.
- Remover `getVoyageUnifiedAtd` — perdeu o consumidor quando o relógio do ADR foi
  para o terminal (T6).
- `computeVoyageStatusFromPods` passa a ler o ATD derivado da Escala.

**Check:** teste do cenário GREEN CHASE — TVV (ETB/ATB 26/08, ETD 28/08, ATD
29/08) e Portmac (ETB 28/08, ATB 29/08, ETD 01/09, ATD 02/09) projetam
`escala.atd = 02/09`; retirando o ATD do TVV, `escala.atd` fica nulo e a Viagem
não conclui.

### T3 — Modal da Escala (`src/components/shared/VoyageScheduleModals.tsx`)

- ETA/ATA no topo, como datas da Escala.
- ETB/ATB/ETD/ATD **por Atracação**, no editor de terminais; remover o par
  global ATB/ATD que hoje duplica o do terminal.
- Remover a trava de `saveVoyagePodSchedule` que rejeita ETA/ATA/ETB/ATB quando
  `tem_importacao = false`: o navio que só embarca também chega e atraca.
- Escala nova nasce com `temImportacao = true` (`VoyageVisaoTab.tsx:133` usa
  `?? false` hoje, e digitar ETA numa escala nova falha).

**Check:** teste do modal — escala só de exportação aceita ETA e ATB; escala nova
com ETA salva sem erro.

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
exportação.

**Check:** teste do form — salvar a viagem não altera nenhuma data de escala.

### T5 — Line-Up, Painel e TV (`src/services/lineup.ts`, `LineUpTable.tsx`)

Grão **mantido**: uma linha por `(escala, sentido)`, conforme o ponto 2 da nota
de 2026-08-03 da ADR 0035.

- ETA/ATA da Escala (inalterado).
- **ETB/ATB da primeira Atracação que hospeda uma frente daquele sentido** — hoje
  as duas linhas mostram o mesmo ETB da escala, e a de exportação exibe o ETB de
  um terminal que não é o dela.
- `projectLineUpTerminals` ordena pela `sequencia` da Atracação, não por ATB com
  fallback alfabético.
- `deriveEscalaState` passa a receber as Atracações.

**Check:** teste de projeção — importação no TVV e exportação na Portmac produzem
ETB 26/08 e 28/08 nas respectivas linhas.

### T6 — ADR (`agencyDepartureReport.ts`, `AgencyReportDocument.tsx`, `VoyageAgencyReportTab.tsx`)

- O impresso passa a usar ATB/ATD **da Atracação daquele terminal**; ATA continua
  vindo da Escala.
- T0 do Prazo de Conclusão = ATD daquela Atracação (nota de 2026-08-24 da ADR
  0039).

**Check:** teste — dois ADRs do mesmo porto imprimem ATB/ATD distintos e prazos
distintos (TVV vence 03/09, Portmac 07/09, contando 3 dias úteis).

### T7 — Alertas (migration, sobre `326_voyage_operation_alerts.sql`)

O reconciliador já itera por terminal, mas compara contra o ETD da **escala**
(`v_etd`, linha 528). Passa a comparar contra o ETD da própria Atracação, agora
que a coluna existe (T1).

**Check:** teste SQL — terminal atracado sem ATD com ETD vencido só alerta o seu
próprio terminal.

### T8 — Visão geral (`VoyageVisaoTab.tsx`)

- Colunas ETB/ATB/ETD/ATD saem da linha da escala; a linha mostra ETA, ATA e o
  ATD derivado.
- As Atracações aparecem sob a escala, com as suas datas e o terminal (ou TBC).

**Check:** teste de render — escala com duas Atracações lista as duas em ordem.

### T9 — Documentação

- `docs/RASTREABILIDADE.md`: rotas/componentes/serviços tocados por T2–T8.
- `docs/ARCHITECTURE.md`: a Atracação na descrição do módulo de Viagens.
- `docs/CHANGELOG.md`: a entrega.
- Ao concluir: mover este plano para `docs/archive/plans/` e remover a linha de
  `docs/plans/README.md`, conforme `docs/CONVENCOES.md`.

## Ordem

T1 destrava T2, T6 e T7. T3–T5 e T8 dependem de T2. T4 é independente e pode ir
primeiro, por ser o menor e por encerrar sozinho três dos achados.

## Fora de escopo

- Reatracação no mesmo terminal na mesma Escala (shifting, ou retorno ao TVV
  depois da Portmac). O `UNIQUE (voyage_id, port, terminal_id)` permanece; a
  promoção da Atracação a `(viagem, porto, sequência)` fica como evolução, e o
  nome do conceito já nasce preparado para ela.
- Promover a Escala a tabela própria (`port_calls`), adiada desde a ADR 0027.
