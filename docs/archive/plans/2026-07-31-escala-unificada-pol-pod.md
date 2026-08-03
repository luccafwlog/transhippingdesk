# Escala unificada: POL e POD do mesmo porto são a mesma escala — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar o bloco 1 da ADR 0035 e a sua nota editorial de 2026-08-03 — a
escala passa a ser `(viagem, porto brasileiro)`, unificando linha POL, linha POD e
linha EXP num **único registro com um único modal**, de modo que uma viagem criada
exclusivamente para embarque tenha ADR, alerta, line-up e Programação como
qualquer outra.

**Architecture:** Hoje há três representações do mesmo fato. `voyage_pod_schedule`
(audit log) guarda o ciclo completo de datas do porto de descarga;
`voyage_pol_schedule` (audit log) guarda `etd`/`atd`/`nº escala` do porto de
carregamento; `voyage_export_schedules` (tabela, **uma por viagem**) guarda o lado
de exportação com `eta`/`etb` próprios. A Visão geral mostra as duas primeiras como
linhas de POD e a terceira como uma linha EXP à parte, cada uma com o seu modal; o
ADR lê só a primeira. Este plano cria **uma projeção de escala** que unifica as três
por `(viagem, porto)`, restrita a portos `BR*`, e converte os consumidores.

A escala **não** vira tabela — a ADR 0027 adiou isso e a 0035 mantém o adiamento.
`voyage_pod_schedule` continua sendo o portador físico das datas operacionais da
escala (agora de qualquer escala brasileira, seja ela POL, POD ou as duas), e
`voyage_pol_schedule` permanece como o registro documental do POL, inclusive o ATD
derivado do Laden on Board (ADR 0025). A unificação vive na leitura e na escrita da
projeção.

**Base vazia.** Em 2026-08-03 a produção tinha 1 viagem, 1 linha de exportação (já
com `pol`), 0 linhas de POL e 5 eventos de POD. Não há legado a migrar: o backfill
em três níveis, a precedência POD-canônico, o aviso de divergência entre linhas e o
corte temporal do alerta **saíram do escopo**. Confira a contagem antes de começar;
se a base tiver crescido, pare e reabra a decisão.

**Tech Stack:** React 18 + TypeScript, TanStack React Query, Supabase (Postgres +
RLS), Vitest + Testing Library (jsdom), Vite, ESLint.

---

## Leitura obrigatória antes de começar

Leia, nesta ordem:

1. [`../../CLAUDE.md`](../../CLAUDE.md) — mudança cirúrgica, contrato de documentação e gates de verificação.
2. [`../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md`](../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md) — a decisão que este plano executa (bloco 1) **e a nota editorial de 2026-08-03**, que fixa o modal único, a assimetria Visão geral × Line-Up e a simplificação por base vazia.
3. [`../adr/0027-agency-departure-report-agregado-escala-snapshot.md`](../adr/0027-agency-departure-report-agregado-escala-snapshot.md) — por que a escala não é entidade de primeira classe.
4. [`../adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md`](../adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md) e [`../adr/0025-bl-fonte-documental-unica-container-atd-pol.md`](../adr/0025-bl-fonte-documental-unica-container-atd-pol.md) — quem mais escreve nas linhas de POL/POD.
5. [`../../CONTEXT.md`](../../CONTEXT.md) — verbetes *Viagem*, *Escala portuária*, *Exportação da Escala*, *Próxima Escala*, *Estado da Escala*, *ETD do POL*, *ATD do POL*, *Programação de Navios*, *ADR*.
6. [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) — linhas de `/viagens`, `/viagens/:voyageId` e `/lineup`.

Glossário mínimo:

- **Escala** — `(viagem, porto brasileiro)`. Pode contemplar só importação, só exportação ou as duas. Um porto, uma escala.
- **Linha POD / linha POL / linha EXP** — as três representações atuais, unificadas por este plano.
- **Portador das datas** — `voyage_pod_schedule`, que passa a guardar as datas operacionais de qualquer escala brasileira. O nome do `entity_type` **não** muda (evita migrar histórico de auditoria); a leitura é que passa a tratá-lo como escala.
- **ADR** — sem qualificação, o *Agency Departure Report*; com número, o registro de decisão.

## Setup

```bash
npm ci
git checkout main && git pull --ff-only
git checkout -b feat/escala-unificada-pol-pod
```

Comandos de verificação:

```bash
npx vitest run <caminho-do-teste>
npm run lint
npm test
npm run build
npm run docs:check
```

**Guarda de arquivos:** `src/types/database.ts` e as migrations existentes são
protegidos por `.claude/hooks/protect-files.sh`; regenerar tipos após a migration
exige autorização explícita — pare e peça. **Nunca edite migration já criada**
(ADR 0016). A última migration é a `249`; as deste plano são `250` e `251`.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/250_voyage_export_schedules_por_escala.sql` | `voyage_export_schedules` por `(voyage_id, pol)` + toggle `tem_exportacao` | Criar |
| `supabase/migrations/251_agency_report_pending_escala_unificada.sql` | Alerta pós-ATD sobre a escala unificada | Criar |
| `src/services/__tests__/escalaUnificadaMigration.test.ts` | Contrato SQL das migrations | Criar |
| `src/services/voyageRouteSchedules.ts` | Projeção das escalas | Modificar (projeção unificada + escrita) |
| `src/services/voyageExportSchedules.ts` | Lado de exportação da escala | Modificar (chave por porto, sem datas próprias) |
| `src/services/voyageSummaries.ts` | Portos, Próxima Escala, rail | Modificar (escalas no lugar de PODs) |
| `src/hooks/useViagemSchedulesAndStats.ts` | Carrega as projeções | Modificar |
| `src/components/voyages/VoyageCard.tsx` | Escalas da viagem e da aba do ADR | Modificar |
| `src/components/voyages/VoyageVisaoTab.tsx` | Tabela de escalas | Modificar (uma linha por escala) |
| `src/components/shared/VoyageScheduleModals.tsx` | Modal único de escala | Modificar (unificar; remover o modal de exportação) |
| `src/services/lineup.ts` | Line-Up (TV) | Modificar (duas linhas por escala, datas da escala) |
| `docs/RASTREABILIDADE.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `docs/plans/README.md` | Documentação viva | Modificar |

---

## Task 1: A exportação passa a ser de uma escala, com toggle explícito

`voyage_export_schedules` é `UNIQUE (voyage_id)`: viagem que embarca em dois portos
brasileiros não registra o segundo. E o "terá exportação" hoje não existe — é
inferido de haver linha.

- [ ] Criar `250_voyage_export_schedules_por_escala.sql`: `pol` passa a `NOT NULL` e a unicidade passa a `UNIQUE (voyage_id, pol)`. Sem backfill (base vazia); o cabeçalho da migration registra a contagem verificada e o rollback.
- [ ] Na mesma migration, remover `eta` e `etb` da tabela: as datas passam a ser da escala (portador `voyage_pod_schedule`), não do sentido de exportação.
- [ ] Adicionar `tem_exportacao boolean NOT NULL DEFAULT true` — a existência da linha deixa de ser a declaração, e o toggle sobrevive a uma escala declarada exportadora sem quantidades conhecidas.
- [ ] `voyageExportSchedules.ts`: `upsert` com `onConflict: 'voyage_id,pol'`; a leitura devolve **uma coleção por viagem**, indexada por porto normalizado, no lugar de um registro único; `eta`/`etb` saem do tipo.
- [ ] Ajustar os consumidores da leitura (`useViagemSchedulesAndStats`, `Viagens.tsx`, `VoyageVisaoTab`, `lineup.ts`) para a coleção.

**Verificação:** `escalaUnificadaMigration.test.ts` conferindo a nova unicidade, a
ausência de `eta`/`etb` e o default do toggle; teste de serviço cobrindo duas
escalas exportadoras na mesma viagem.

## Task 2: A projeção unificada de escalas

- [ ] Em `voyageRouteSchedules.ts`, criar a projeção de **escalas** da viagem: união dos portos de `voyage_pod_schedule`, `voyage_pol_schedule` e `voyage_export_schedules`, normalizados por `normalizePortCode` e **restritos a `BR*`**.
- [ ] Cada escala expõe `eta, etb, ata, atb, etd, atd, rtw, ceStatus, linked, escalaNumber, omitted, deleted` mais os marcadores do que ela opera (`temImportacao`, `temExportacao`, `temGranito`, `containersQty`, `movementsQty`).
- [ ] Um valor por campo por escala. Não há precedência entre linhas nem aviso de divergência: as datas operacionais têm um único escritor, o modal da escala.
- [ ] Escrita: salvar datas de uma escala grava sempre no portador (`voyage_pod_schedule`) para aquele `(viagem, porto)`, inclusive quando a escala nasceu de uma linha POL ou de uma exportação. Comentar com `ponytail:` o teto (o `entity_type` continua chamando-se `pod` por compatibilidade de histórico) e o caminho de upgrade (promover a escala a tabela, como prevê a ADR 0027).
- [ ] `saveVoyagePolSchedule` continua existindo para o registro documental do POL — inclusive o ATD derivado do Laden on Board (`ladenOnBoardAtd.ts`), que **não** muda e **não** sobrescreve o ATD da escala.
- [ ] Escala soft-deleted (`deleted`) continua fora da projeção.

**Verificação:** testes puros da projeção — só POD; só POL; só exportação; POD+POL
no mesmo porto (uma escala, um valor por campo); POL estrangeiro (fica fora); porto
por extenso normalizado; ATD documental do POL divergente do ATD da escala (a
escala prevalece na projeção e o registro do POL permanece intacto).

## Task 3: Os consumidores passam a ler escalas

- [ ] `voyageSummaries.ts`: `collectVoyagePorts`/`getProximaEscala`/`buildVoyageRailItems` passam a operar sobre escalas, não sobre PODs. Próxima Escala continua sendo a escala não omitida com menor ETA e sem ATA.
- [ ] `VoyageCard.tsx`: `podRows`/`activePods` viram escalas; a aba do ADR recebe a lista unificada. Some o fallback para `voyage.pod?.name`, que hoje entrega um porto estrangeiro a uma viagem sem B/Ls.
- [ ] `lineup.ts`: o Line-Up passa a derivar da mesma projeção **mantendo a segregação de sentidos** — uma escala que descarrega e embarca gera **duas** linhas (`rowType: 'import' | 'export'`) com as **mesmas datas da escala**; escala de sentido único gera **uma**. A linha de exportação deixa de ter `eta`/`etb` próprios e passa a existir por escala, não por viagem.
- [ ] A Programação de Navios do Portal passa a exibir também a escala que só embarca.
- [ ] `useViagemSchedulesAndStats.ts`: carregar a projeção unificada por viagem, preservando as chaves de cache existentes ou registrando as novas em `queryKeys.ts`.
- [ ] Regressão obrigatória: nenhuma viagem só de importação pode mudar de Próxima Escala, estado ou line-up após a conversão.

**Verificação:** testes existentes de `voyageSummaries` e do line-up devem passar
sem alteração de expectativa para viagens de importação; teste novo com viagem só
de exportação passando a ter escala, Próxima Escala e item de line-up; teste de
escala mista rendendo duas linhas de line-up com datas idênticas.

## Task 4: Uma linha por escala na Visão geral e um modal só

- [ ] `VoyageVisaoTab.tsx`: a tabela passa a exibir **uma linha por escala**, com as datas da escala e marcadores do que ela opera (importação, exportação, granito, `N CNTRS`/`MOVES`). A linha EXP amarela separada deixa de existir. Ordenação por ETA, com ETA nulo por último em ordem de criação.
- [ ] Cabeçalho: um único botão **"Adicionar escala"**. "Adicionar exportação" some.
- [ ] Ações da linha: editar escala, omitir, excluir. **Omitir fica desabilitada quando a escala não tem importação**, com o motivo no tooltip — omissão é conceito de importação (ADR 0022).
- [ ] `VoyageScheduleModals.tsx`: `AddPodToVoyageModal` e `PodScheduleModal` viram um **modal de Escala** (criar e editar), e `ExportScheduleModal` é **removido**. O modal tem: porto, o ciclo completo de datas, RESTOW, BLs e CEs, VINCULADA, Nº Escala (Mercante) — todos **um por escala** — e uma seção **Exportação** atrás de um toggle, com granito (checkbox interno), CNTR (vazios exp.) e movimentos.
- [ ] Porto: combobox com `BRVIX, BRSSA, BRPEC, BRSUA, BRSSZ, BRIGI, BRNVT` nessa ordem, normalizado por `normalizePortCode`, recusando porto fora de `BR*` com mensagem explícita. A lista é sugestão de exibição, não ordem de escalas.
- [ ] Toggle de exportação: persistido em `tem_exportacao`. Desligar é **bloqueado** enquanto houver granito no porto da escala (`granite_bls`/manifesto) ou Embarque de Vazios registrado para ela; sem carga vinculada, pede confirmação e descarta o planejamento digitado (CNTR/movimentos/granito).

**Verificação:** teste da Visão geral com uma escala que importa e exporta (uma
linha, dois marcadores) e com uma viagem só de exportação (uma linha, sem marcador
de importação); teste do modal cobrindo o bloqueio do toggle com carga vinculada, a
confirmação sem carga e a recusa de porto estrangeiro.

## Task 5: O alerta pós-ATD enxerga a escala unificada

- [ ] Criar `251_agency_report_pending_escala_unificada.sql`: `detect_agency_report_pending` passa a considerar o ATD de `voyage_pod_schedule` **e** de `voyage_pol_schedule`, restrito a portos `BR*`, mantendo o agrupamento por departamento da migration 228.
- [ ] Sem novo corte temporal — não há escala histórica de exportação a proteger (base vazia). O corte da 214 permanece intocado.
- [ ] Não alterar o gate de sign-off nem o fechamento — só a origem do ATD.
- [ ] Cabeçalho da migration com intent, funções afetadas, consumidores (`src/services/alerts.ts`) e rollback.

**Verificação:** `escalaUnificadaMigration.test.ts` conferindo as duas fontes de ATD
e o filtro `BR*`.

## Task 6: Documentação viva

- [ ] `CONTEXT.md`: **já atualizado em 2026-08-03** (verbetes *Escala portuária*, *Exportação da Escala*, *Próxima Escala*, *Estado da Escala*, *ETD/ATD do POL*, *ADR*, *Restow*, *Programação de Navios*). Conferir que a entrega bate com o texto; corrigir o texto se a implementação divergir.
- [ ] `docs/ARCHITECTURE.md`: a projeção de escalas e seus consumidores.
- [ ] `docs/RASTREABILIDADE.md`: linhas de `/viagens`, `/viagens/:voyageId`, `/lineup` e `/alertas`; migrations `250` e `251`.
- [ ] `docs/adr/README.md`: conferir que a relação 0027 ↔ 0035 continua correta após a entrega.
- [ ] `docs/CHANGELOG.md`: entrega registrada.
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de `docs/plans/README.md` **no mesmo change** que conclui a execução.

**Verificação:** `npm run docs:check`.

---

## Gates finais

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run docs:check`
- [ ] Conferir numa viagem real de cada tipo: só importação (nada muda), só exportação (ganha escala, ADR, alerta, line-up e Programação) e mista (uma linha na Visão geral, duas no Line-Up, um ADR).

---

## Nota de execução — 2026-08-03

Executado em duas ondas. A primeira entregou a projeção unificada, os
consumidores e as migrations `250`/`251` seguindo a versão anterior deste plano
(com backfill e precedência POD-canônico). A segunda aplicou a nota editorial da
ADR 0035: modal único com toggle de exportação, migration `252` (`pol NOT NULL`,
remoção de `eta`/`etb`, entrada de `tem_exportacao`), combobox dos sete portos
com recusa de porto estrangeiro e a linha de POL deixando de declarar exportação.

O backfill da `250` permaneceu no histórico por já ter sido revisado, embora a
base não tivesse resíduo a migrar; a `252` é quem fecha o contrato.
