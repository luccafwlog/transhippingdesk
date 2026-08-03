# Escala unificada: POL e POD do mesmo porto são a mesma escala — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar o bloco 1 da ADR 0035 — a escala passa a ser `(viagem, porto brasileiro)`, unificando linha POL, linha POD e linha EXP, de modo que uma viagem criada exclusivamente para embarque tenha ADR, alerta e line-up como qualquer outra.

**Architecture:** Hoje há três representações do mesmo fato. `voyage_pod_schedule` (audit log) guarda o ciclo completo de datas do porto de descarga; `voyage_pol_schedule` (audit log) guarda `etd`/`atd`/`nº escala` do porto de carregamento; `voyage_export_schedules` (tabela, **uma por viagem**) guarda o lado de exportação com `eta`/`etb`. A Visão geral mostra as duas primeiras como linhas de POD e a terceira como uma linha EXP à parte; o ADR lê só a primeira. Este plano cria **uma projeção de escala** que unifica as três por `(viagem, porto)`, restrita a portos `BR*`, e converte os consumidores.

A escala **não** vira tabela — a ADR 0027 adiou isso e a 0035 mantém o adiamento. `voyage_pod_schedule` continua sendo o portador físico das datas operacionais da escala (agora de qualquer escala brasileira, seja ela POL, POD ou as duas), e `voyage_pol_schedule` permanece como o registro documental do POL, inclusive o ATD derivado do Laden on Board (ADR 0025). A unificação vive na leitura e na escrita da projeção.

**Tech Stack:** React 18 + TypeScript, TanStack React Query, Supabase (Postgres + RLS), Vitest + Testing Library (jsdom), Vite, ESLint.

---

## Leitura obrigatória antes de começar

Leia, nesta ordem:

1. [`../../CLAUDE.md`](../../CLAUDE.md) — mudança cirúrgica, contrato de documentação e gates de verificação.
2. [`../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md`](../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md) — a decisão que este plano executa (bloco 1).
3. [`../adr/0027-agency-departure-report-agregado-escala-snapshot.md`](../adr/0027-agency-departure-report-agregado-escala-snapshot.md) — por que a escala não é entidade de primeira classe.
4. [`../adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md`](../adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md) e [`../adr/0025-bl-fonte-documental-unica-container-atd-pol.md`](../adr/0025-bl-fonte-documental-unica-container-atd-pol.md) — quem mais escreve nas linhas de POL/POD.
5. [`../../CONTEXT.md`](../../CONTEXT.md) — verbetes *Viagem*, *Escala portuária*, *Próxima Escala*, *Estado da Escala*, *ETD do POL*, *ATD do POL*, *Programação de Navios*, *ADR*.
6. [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) — linhas de `/viagens`, `/viagens/:voyageId` e `/lineup`.

Glossário mínimo:

- **Escala** — `(viagem, porto brasileiro)`. Pode contemplar só importação, só exportação ou as duas.
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

**Guarda de arquivos:** `src/types/database.ts` e as migrations existentes são protegidos por `.claude/hooks/protect-files.sh`; regenerar tipos após a migration exige autorização explícita — pare e peça. **Nunca edite migration já criada** (ADR 0016). As migrations deste plano são `250` e `251`; se o plano `2026-07-31-adr-cobertura-fontes-forma.md` ainda não tiver sido executado, ajuste para os próximos números livres.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/250_voyage_export_schedules_por_escala.sql` | `voyage_export_schedules` por `(voyage_id, pol)` | Criar |
| `supabase/migrations/251_agency_report_pending_escala_unificada.sql` | Alerta pós-ATD sobre a escala unificada + novo baseline | Criar |
| `src/services/__tests__/escalaUnificadaMigration.test.ts` | Contrato SQL das migrations | Criar |
| `src/services/voyageRouteSchedules.ts` | Projeção das escalas | Modificar (projeção unificada + escrita) |
| `src/services/voyageExportSchedules.ts` | Linha EXP | Modificar (chave por porto) |
| `src/services/voyageSummaries.ts` | Portos, Próxima Escala, rail | Modificar (escalas no lugar de PODs) |
| `src/hooks/useViagemSchedulesAndStats.ts` | Carrega as projeções | Modificar |
| `src/components/voyages/VoyageCard.tsx` | Escalas da viagem e da aba do ADR | Modificar |
| `src/components/voyages/VoyageVisaoTab.tsx` | Tabela de escalas | Modificar (uma linha por escala) |
| `src/components/shared/VoyageScheduleModals.tsx` | Modais de escala e de exportação | Modificar |
| `src/services/lineup.ts` | Line-Up (TV) | Modificar |
| `docs/RASTREABILIDADE.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `CONTEXT.md`, `docs/plans/README.md` | Documentação viva | Modificar |

---

## Task 1: A linha EXP passa a ser de uma escala, não da viagem

`voyage_export_schedules` é `UNIQUE (voyage_id)`: viagem que embarca em dois portos brasileiros não registra o segundo.

- [ ] Criar `250_voyage_export_schedules_por_escala.sql`: backfill de `pol` onde estiver nulo, na ordem — POL brasileiro da viagem em `voyage_pol_schedule`; senão `granite_manifests.loading_port` da viagem; senão `vazios_export_operations.embark_port`. Normalizar o valor para LOCODE no backfill.
- [ ] Linhas que sobrarem sem `pol` após o backfill: não apagar. Deixar registradas para revisão manual e reportar a contagem no corpo da migration (comentário + `RAISE NOTICE`).
- [ ] Trocar `UNIQUE (voyage_id)` por `UNIQUE (voyage_id, pol)` e tornar `pol` `NOT NULL` **apenas** se o backfill não deixar resíduo; havendo resíduo, manter nulo e abrir a restrição num passo posterior, documentado na própria migration.
- [ ] `voyageExportSchedules.ts`: `upsert` passa a usar `onConflict: 'voyage_id,pol'`; a leitura passa a devolver **uma coleção por viagem**, indexada por porto, no lugar de um registro único.
- [ ] Ajustar os consumidores da leitura (`useViagemSchedulesAndStats`, `Viagens.tsx`, `VoyageVisaoTab`, `lineup.ts`) para a coleção.

**Verificação:** `escalaUnificadaMigration.test.ts` conferindo a nova unicidade e a ordem do backfill; teste de serviço cobrindo duas linhas EXP na mesma viagem.

## Task 2: A projeção unificada de escalas

- [ ] Em `voyageRouteSchedules.ts`, criar a projeção de **escalas** da viagem: união dos portos de `voyage_pod_schedule`, `voyage_pol_schedule` e `voyage_export_schedules`, normalizados por `normalizePortCode` e **restritos a `BR*`**.
- [ ] Cada escala expõe `eta, etb, ata, atb, etd, atd, rtw, ceStatus, linked, escalaNumber, omitted, deleted` mais os marcadores do que ela opera (`temImportacao`, `temExportacao`, `temGranito`, `containersQty`, `movementsQty`).
- [ ] Precedência: a **linha de POD é canônica**; POL e EXP preenchem **apenas** campos vazios. Quando as duas trouxerem valores diferentes para o mesmo campo, expor a divergência (campo, valor do POD, valor da outra linha) para a UI avisar — nunca escolher em silêncio.
- [ ] Escrita: salvar datas operacionais de uma escala grava sempre no portador (`voyage_pod_schedule`) para aquele `(viagem, porto)`, inclusive quando a escala nasceu de uma linha POL. Comentar com `ponytail:` o teto (o `entity_type` continua chamando-se `pod` por compatibilidade de histórico) e o caminho de upgrade (promover a escala a tabela, como prevê a ADR 0027).
- [ ] `saveVoyagePolSchedule` continua existindo para o registro documental do POL — inclusive o ATD derivado do Laden on Board (`ladenOnBoardAtd.ts`), que **não** muda.
- [ ] Escala soft-deleted (`deleted`) continua fora da projeção.

**Verificação:** testes puros da projeção — só POD; só POL; POD+POL com colisão de `etd` (POD vence e a divergência é reportada); POL estrangeiro (fica fora); porto por extenso normalizado.

## Task 3: Os consumidores passam a ler escalas

- [ ] `voyageSummaries.ts`: `collectVoyagePorts`/`getProximaEscala`/`buildVoyageRailItems` passam a operar sobre escalas, não sobre PODs. Próxima Escala continua sendo a escala não omitida com menor ETA e sem ATA.
- [ ] `VoyageCard.tsx`: `podRows`/`activePods` viram escalas; a aba do ADR recebe a lista unificada. Some o fallback para `voyage.pod?.name`, que hoje entrega um porto estrangeiro a uma viagem sem B/Ls.
- [ ] `lineup.ts`: o Line-Up passa a derivar da mesma projeção, mantendo o comportamento atual para viagens só de importação.
- [ ] `useViagemSchedulesAndStats.ts`: carregar a projeção unificada por viagem, preservando as chaves de cache existentes ou registrando as novas em `queryKeys.ts`.
- [ ] Regressão obrigatória: nenhuma viagem só de importação pode mudar de Próxima Escala, estado ou line-up após a conversão.

**Verificação:** testes existentes de `voyageSummaries` e do line-up devem passar sem alteração de expectativa para viagens de importação; teste novo com viagem só de exportação passando a ter escala, Próxima Escala e item de line-up.

## Task 4: Uma linha por escala na Visão geral

- [ ] `VoyageVisaoTab.tsx`: a tabela passa a exibir **uma linha por escala**, com as datas da escala e marcadores do que ela opera (importação, exportação, granito, `N CNTRS`/`MOVES`). A linha EXP amarela separada deixa de existir.
- [ ] Ações da linha (editar escala, editar exportação, omitir, excluir planejamento) convivem na mesma linha, cada uma agindo sobre o seu registro.
- [ ] Divergência entre linha POD e linha POL/EXP (Task 2) aparece como aviso na linha, com os dois valores.
- [ ] `VoyageScheduleModals.tsx`: o modal de escala aceita `ata`/`atb` para qualquer escala brasileira e normaliza o porto por `normalizePortCode` antes de gravar.

**Verificação:** teste da Visão geral com uma escala que importa e exporta (uma linha, dois marcadores) e com uma viagem só de exportação (uma linha, sem marcador de importação).

## Task 5: O alerta pós-ATD enxerga a escala unificada

- [ ] Criar `251_agency_report_pending_escala_unificada.sql`: `detect_agency_report_pending` passa a considerar o ATD de `voyage_pod_schedule` **e** de `voyage_pol_schedule`, restrito a portos `BR*`, mantendo o agrupamento por departamento da migration 228.
- [ ] Novo corte temporal: escalas com ATD anterior ao deploy desta migration não geram pendência retroativa. O corte da 214 permanece para as escalas que já eram alcançadas.
- [ ] Não alterar o gate de sign-off nem o fechamento — só a origem do ATD.
- [ ] Cabeçalho da migration com intent, funções afetadas, consumidores (`src/services/alerts.ts`) e rollback.

**Verificação:** `escalaUnificadaMigration.test.ts` conferindo as duas fontes de ATD, o filtro `BR*` e o novo baseline.

## Task 6: Documentação viva

- [ ] `CONTEXT.md`: reescrever *Escala portuária* como `(viagem, porto brasileiro)` unificando POL e POD; ajustar *Próxima Escala*, *Estado da Escala* e o verbete *ADR* (uma escala brasileira, um ADR, com ou sem importação); preservar *ETD do POL* e *ATD do POL* como registro documental.
- [ ] `docs/ARCHITECTURE.md`: a projeção de escalas e seus consumidores.
- [ ] `docs/RASTREABILIDADE.md`: linhas de `/viagens`, `/viagens/:voyageId`, `/lineup` e `/alertas`; migrations `250` e `251`.
- [ ] `docs/adr/README.md`: relação da 0027 com a 0035 já registrada — conferir que continua correta após a entrega.
- [ ] `docs/CHANGELOG.md`: entrega registrada.
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de `docs/plans/README.md` **no mesmo change** que conclui a execução.

**Verificação:** `npm run docs:check`.

---

## Gates finais

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run docs:check`
- [ ] Conferir numa viagem real de cada tipo: só importação (nada muda), só exportação (ganha escala, ADR e alerta) e mista (uma linha, um ADR).
