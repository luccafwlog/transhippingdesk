# Viagens

> **Status:** ativo · **Atualizado:** 2026-06-18 · **Rotas:** `/viagens`, `/viagens/:voyageId`

## Propósito

Centro operacional da **Viagem** (navio em uma escala/voyage): planejamento de escalas (POL/POD), métricas de importação/exportação por porto, dados do Sistema Mercante (Número de Escala, CE Master), estado de conciliação Baplie↔manifesto e linha do tempo de eventos. É o ponto de convergência de quase todos os módulos: consome `import_batches`, schedules, B/Ls e conciliação.

Adota layout **master-detail** com rota dedicada por viagem (ver [ADR 0012](../adr/0012-viagens-master-detail-rota-dedicada.md)): um **rail** à esquerda lista/filtra as viagens; o **detalhe** abre em `/viagens/:voyageId`, deep-linkável a partir de Painel, Alertas e Financeiro.

## Como funciona

A página carrega a lista de voyages, agrega schedules e estatísticas por viagem (`useViagemSchedulesAndStats`) e, ao selecionar uma, mostra o detalhe (`VoyageCard`) em abas: Visão geral, Importação, Exportação, Escalas & Manifestos. Timeline e conciliação são carregadas sob demanda por viagem.

Particularidade arquitetural: **schedules POL/POD não têm tabela própria** — o estado é reconstruído de `audit_logs` (padrão insert-only). Cada alteração de ETD/ETA/CE/escala/linked vira uma linha de auditoria; a leitura (`listVoyagePodSchedules`/`listVoyagePolSchedules`) reduz os logs ao valor mais recente por campo por `entity_id` (formato `voyageId::portCode`). Já as **export schedules** têm tabela dedicada (`voyage_export_schedules`, upsert por `voyage_id`).

| Hook | Query key | Fonte |
| --- | --- | --- |
| `useViagemSchedulesAndStats` | (vários) | `voyagesWithUnpaidBls`, POL/POD via audit_logs, export schedules |
| `useVoyageTimeline` | `['voyage-timeline', voyageId]` | `audit_logs`, `baplie_reconciliation_resolutions`, `baplie_containers` |
| `useVoyageReconciliation` | `['baplie-reconciliation', voyageId]` | `reconcileBaplieWithManifest` (por voyage) |

## Componentes e arquivos

| Camada | Arquivo | Responsabilidade |
| --- | --- | --- |
| Página | `src/pages/Viagens.tsx` | Master-detail; rail + detalhe via `:voyageId`; modais de viagem, POD/POL e export schedules |
| Helpers | `src/pages/viagensHelpers.ts` | Funções puras: `VoyageRailItem`, estado de conciliação, timeline derivada, métricas por POD/POL |
| Service | `src/services/voyages.ts` | CRUD de `voyages`; `getOrCreateCarrier`/`getOrCreateVessel`; `voyagesWithUnpaidBls`; audit |
| Service | `src/services/voyageForm.ts` | Schema/validação (Zod) do formulário de viagem; default carrier CSSC |
| Service | `src/services/voyageRouteSchedules.ts` | POL/POD via audit_logs: `saveVoyagePol/PodSchedule`, `list*`, `delete*`, sync no import |
| Service | `src/services/voyageExportSchedules.ts` | CRUD de `voyage_export_schedules` (upsert por `voyage_id`) |
| Service | `src/services/voyageTimeline.ts` | `fetchVoyageTimelineSources` (audit_logs, resolutions, baplie imports, nomes de atores) |
| Hook | `src/hooks/useVoyageTimeline.ts` | React Query da timeline (stale 60s) |
| Hook | `src/hooks/useViagemSchedulesAndStats.ts` | Agrega POL/POD/export + B/Ls não pagos |
| Hook | `src/hooks/useVoyageReconciliation.ts` | Conciliação Baplie por voyage (stale 60s) |
| Componente | `src/components/voyages/VoyageCard.tsx` | Detalhe em abas; edição de POD/POL/export schedules |
| Componente | `src/components/voyages/VoyageRail.tsx` | Rail: lista compacta, rota POL→POD, contadores, dot de estado |
| Componente | `src/components/voyages/VoyageFilters.tsx` | Busca, período, status, filtro de conciliação |
| Migration | `supabase/migrations/001_schema.sql` | `voyages`, `vessels`, `carriers`, `ports`, `audit_logs` |
| Migration | `supabase/migrations/20260521000000_voyage_export_schedules.sql` (+ `_ces_linked`, `_pol`) | `voyage_export_schedules` |
| Migration | `supabase/migrations/046_voyage_schedule_snapshot_trigger.sql`, `052_fix_voyage_snapshot_null_new_value.sql` | Snapshot/trigger de schedule |
| Migration | `supabase/migrations/20260616120000_import_batches_ce_master.sql` | `import_batches.ce_master` (CE Master) |

## Regras de negócio

### POL / POD e export schedules

- **POL (Port of Loading):** porto de origem/embarque. Para exportação, gravado em `voyage_export_schedules.pol`; para origem do manifesto, sincronizado de `import_batches` para o schedule POL (`voyage_pol_schedule`, campos `etd`, `escalaNumber`).
- **POD (Port of Discharge):** porto(s) de descarga. Vários PODs por viagem → várias linhas `voyage_pod_schedule` (campos `etd`, `eta`, `etb`, `ata`, `atd`, `rtw`, `ceStatus`, `linked`, `escalaNumber`, `deleted`). Reconstruídas de `audit_logs`.
- **`voyage_export_schedules`** (tabela real, 1:1 por voyage): `pol`, `has_granite`, `containers_qty`, `movements_qty`, `eta`, `etb`, `ce_status` (`waiting|received|launching|approving|approved`), `linked`.

### Timeline

`voyageTimeline.ts` cruza 4 fontes (`audit_logs` de schedule, `audit_logs` de voyage, `baplie_reconciliation_resolutions`, primeira data de `baplie_containers`) e deriva eventos ordenados do mais recente ao mais antigo: manifesto importado, Baplie importado, datas de escala (ETA/ETB/ATA/ATD), criação de Nº de Escala, manifestos vinculados, mudança de status de CE, RTW (restow), divergência aberta/resolvida, CE Master definido, viagem concluída (todos PODs com ATD).

### Sistema Mercante: CE Master e indicadores

- **CE Master por manifesto.** Distinto do CE Mercante por B/L. É o CE agrupador de um manifesto, armazenado em `import_batches.ce_master`, editado inline e auditado (`setImportBatchCeMaster` em `manifestImport.ts`). Um por manifesto/batch. Ver [GLOSSARIO](../GLOSSARIO.md) e [Manifesto & EDI](manifesto-edi.md).
- **Número de Escala** (Mercante): identificador da escala do navio no terminal. Existir o número = a escala foi **criada** no Mercante (campo `escalaNumber` do POD schedule).
- **Indicador "ESCALA" / VINCULADA** (`linked`): afirma que os **manifestos foram vinculados** à escala no Mercante — passo distinto de a escala ter sido criada. `linked=true` → "ESCALA = SIM". **Não confundir** com a existência do Número de Escala (ver [GLOSSARIO](../GLOSSARIO.md), "Vínculo de Manifestos à Escala"). Pode ser marcado manualmente ou auto-vinculado no import do manifesto quando o POD já tem ETA.
- **"No Escala" / não escalado**: estado derivado da ausência — sem `escalaNumber` e/ou `linked=false` o POD aparece como não escalado; não é um flag explícito no código.

### Estado de Conciliação

Sinal de leitura (não bloqueio) derivado em `viagensHelpers.ts`, exibido como dot no rail e usado em filtro:

| Nível | Significado |
| --- | --- |
| **Divergente** | Há Divergência de Existência ou de Atributo (Baplie↔manifesto) não resolvida — exige ação |
| **Incompleto** | Falta manifesto, CE Mercante incompleto, ou Baplie em staging sem conciliação |
| **Conciliado** | Tudo conciliado e CEs completos |

## Dependências

**Tabelas Supabase**
- `voyages` (`vessel_id`, `voyage_number`, `pol_id`, `pod_id`, `etd/eta/ata`, `status` `active|completed|cancelled`)
- `vessels` (`name`, `imo`, `carrier_id`), `carriers` (`name`, `scac`), `ports` (`name`, `locode`, `country`)
- `voyage_export_schedules` (1:1 por voyage)
- `audit_logs` — fonte de verdade dos schedules POL/POD e da timeline
- `import_batches` (`ce_master`), `baplie_containers`, `baplie_reconciliation_resolutions` — leitura cruzada
- `bls` — `voyagesWithUnpaidBls`

**RPCs** — schedules e CE Master operam por inserts em `audit_logs` / upsert direto, não por RPC dedicada. (Conciliação Baplie é client-side via `reconcileBaplieWithManifest`.)

**Integrações externas** — nenhuma direta.

**Outros módulos**
- [Manifesto & EDI](manifesto-edi.md) — batches, CE Master, conciliação Baplie
- [Faturamento](faturamento.md) — `voyagesWithUnpaidBls`, deep-link do Financeiro
- Painel / Alertas — deep-link para `/viagens/:voyageId`

## Notas e divergências

- **Schedules sem tabela própria.** POL/POD vivem em `audit_logs` (insert-only). Qualquer consumidor precisa reconstruir o estado pelas funções `list*`, não esperar uma tabela `voyage_pod_schedules`. Apenas `voyage_export_schedules` é tabela física.
- A rota dedicada `/viagens/:voyageId` precisa tratar `:voyageId` inexistente e a responsividade do par rail+detalhe (desktop-first), conforme as consequências do [ADR 0012](../adr/0012-viagens-master-detail-rota-dedicada.md).
- O "ESCALA = SIM" (VINCULADA) é frequentemente confundido com o Número de Escala — são estados distintos do Mercante; ver [GLOSSARIO](../GLOSSARIO.md).
