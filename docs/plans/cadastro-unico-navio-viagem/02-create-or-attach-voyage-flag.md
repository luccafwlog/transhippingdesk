# Plan 02: `show_on_portal` + `createOrAttachVoyageFromSchedule`

> **Executor instructions**: Follow step by step. Run every verification and
> confirm before advancing. Honor STOP conditions. Update the status row in
> `../README.md` when done.
>
> **Drift check (run first)**:
> `git log --oneline -3 -- src/services/voyages.ts src/services/voyageRouteSchedules.ts src/types/database.ts`
> Re-read `voyages.ts` and `voyageRouteSchedules.ts` if either changed since
> 2026-07-09. This plan reuses `createVoyage`, `saveVoyagePolSchedule`,
> `saveVoyagePodSchedule`, `listVoyagePodSchedules` from those files.
>
> **PROTECTED FILE**: `src/types/database.ts` is guarded by a hook. This plan
> adds exactly one field (`show_on_portal`) to the `Voyage` type — an authorized,
> additive change that mirrors a migration. Do not touch anything else there.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (nova coluna + serviço que cria/anexa viagem)
- **Depends on**: 01
- **Category**: feature (ADR 0021)

## Why this matters

O núcleo do cadastro único: uma função de serviço que, a partir dos dados de um
navio do quadro do Portal, **cria uma viagem nova ou anexa a uma existente**
(dedup por VOY + IMO), gravando POL/ETD e POD/ETA **sem** tocar dados reais
(ATA/ATD/RTW/CE/linked). E a flag `show_on_portal` que marca quais viagens
aparecem no quadro do cliente (plano 04).

## Current state

- `createVoyage(form, changedBy)` em `src/services/voyages.ts:9-33` cria a
  viagem (carrier+vessel via `getOrCreate*`, insert em `voyages`, auditoria) e
  chama `syncDischargePortEtas` — que **preserva** etb/ata/atd/rtw/ceStatus/
  linked, tocando só ETA (`voyages.ts:116-141`). É o padrão de sobrescrita
  segura que este plano segue.
- `saveVoyagePolSchedule({voyageId, pol, etd, changedBy})` em
  `voyageRouteSchedules.ts:226-253` grava só ETD (e Nº de escala opcional) por
  POL — já é escopo-seguro.
- `voyages` (schema em `supabase/migrations/001_schema.sql`) **não** tem coluna
  de visibilidade no Portal.

## Tasks

### Task 1: Migração — coluna `show_on_portal`

**Files:**
- Create: `supabase/migrations/171_voyages_show_on_portal.sql`
- Test: `src/services/__tests__/voyagesShowOnPortalMigration.test.ts`

> Consulte a skill `supabase-migration` para convenções. Numeração sequencial
> única (ADR 0016): confirme o próximo número com
> `ls supabase/migrations | tail -1` — use `171` se `170` for o último.

- [ ] **Step 1: Escrever o teste de contrato da migração (falha)**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('adiciona voyages.show_on_portal como boolean not null default false', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations')
  const sql = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')

  expect(sql).toMatch(/ALTER TABLE\s+public\.voyages\s+ADD COLUMN\s+IF NOT EXISTS\s+show_on_portal/i)
  expect(sql).toMatch(/show_on_portal\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i)
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/services/__tests__/voyagesShowOnPortalMigration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Escrever a migração**

`supabase/migrations/171_voyages_show_on_portal.sql`:

```sql
-- ADR 0021: viagens exibidas no quadro "Programação de Navios" do Portal.
-- Default false: viagens criadas manualmente / por manifesto não aparecem ao
-- cliente até serem marcadas. O cadastro por Chegadas e Saídas liga a flag.
ALTER TABLE public.voyages
  ADD COLUMN IF NOT EXISTS show_on_portal boolean NOT NULL DEFAULT false;

-- Índice parcial: o Portal só consulta viagens visíveis e ativas.
CREATE INDEX IF NOT EXISTS voyages_show_on_portal_active_idx
  ON public.voyages (show_on_portal)
  WHERE show_on_portal AND status = 'active';
```

- [ ] **Step 4: Aplicar a migração** (ambiente local/branch Supabase)

Run: aplique via MCP Supabase `apply_migration` ou o fluxo do `WORKFLOW.md`.
Expected: sucesso; `voyages` passa a ter a coluna.

- [ ] **Step 5: Rodar para ver passar**

Run: `npx vitest run src/services/__tests__/voyagesShowOnPortalMigration.test.ts`
Expected: PASS.

- [ ] **Step 6: Adicionar o campo ao tipo `Voyage`**

Em `src/types/database.ts`, no tipo `Voyage` (linhas 134-145), adicione o campo
após `status`:

```ts
  status: 'active' | 'completed' | 'cancelled' | null
  show_on_portal: boolean
  created_at: string | null
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/171_voyages_show_on_portal.sql \
        src/services/__tests__/voyagesShowOnPortalMigration.test.ts \
        src/types/database.ts
git commit -m "feat(voyages): coluna show_on_portal para o quadro do Portal (ADR 0021)"
```

### Task 2: Helper puro — particionar lanes em POL/POD

**Files:**
- Create: `src/services/voyageFromSchedule.ts`
- Test: `src/services/__tests__/voyageFromSchedule.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { partitionScheduleLanes, type ScheduleLaneInput } from '../voyageFromSchedule'

describe('partitionScheduleLanes', () => {
  const lanes: ScheduleLaneInput[] = [
    { code: 'CNTAO', kind: 'pol', date: '2026-01-04' },
    { code: 'CNSHA', kind: 'pol', date: null },        // não escala
    { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
    { code: 'BRVIX', kind: 'pod', date: '' },           // não escala
  ]

  it('mantém só lanes com data e separa POL de POD', () => {
    const { pols, pods } = partitionScheduleLanes(lanes)
    expect(pols).toEqual([{ code: 'CNTAO', etd: '2026-01-04' }])
    expect(pods).toEqual([{ pod: 'BRSSA', eta: '2026-01-22' }])
  })
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o helper puro**

`src/services/voyageFromSchedule.ts` (só o helper por ora; a função assíncrona
vem na Task 3):

```ts
export type ScheduleLaneInput = {
  /** Code canônico do porto (de portalLaneCode). */
  code: string
  kind: 'pol' | 'pod'
  /** Data ISO (YYYY-MM-DD) ou null/'' quando o porto não escala. */
  date: string | null
}

export function partitionScheduleLanes(lanes: ScheduleLaneInput[]) {
  const pols: Array<{ code: string; etd: string }> = []
  const pods: Array<{ pod: string; eta: string }> = []
  for (const lane of lanes) {
    const date = (lane.date ?? '').trim()
    if (!date) continue // "não escala": porto fora da rota
    if (lane.kind === 'pol') pols.push({ code: lane.code, etd: date })
    else pods.push({ pod: lane.code, eta: date })
  }
  return { pols, pods }
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/voyageFromSchedule.ts src/services/__tests__/voyageFromSchedule.test.ts
git commit -m "feat(voyage): particionar lanes do Portal em POL/POD (ADR 0021)"
```

### Task 3: `createOrAttachVoyageFromSchedule` (dedup + escrita segura)

**Files:**
- Modify: `src/services/voyageFromSchedule.ts`
- Modify: `src/services/voyages.ts` (exportar `createVoyage` já é exportado;
  adicionar helper `setVoyageShowOnPortal`)
- Test: `src/services/__tests__/voyageFromSchedule.attach.test.ts`

- [ ] **Step 1: Adicionar `setVoyageShowOnPortal` em `voyages.ts`**

No fim de `src/services/voyages.ts`:

```ts
export async function setVoyageShowOnPortal(voyageId: number, show: boolean) {
  const { error } = await supabase
    .from('voyages')
    .update({ show_on_portal: show })
    .eq('id', voyageId)
  if (error) throw error
}

/** Busca viagem por VOY + navio (IMO; fallback nome). null se não existir. */
export async function findVoyageByNumberAndVessel(
  voyageNumber: string,
  vesselImo: string,
  vesselName: string,
): Promise<number | null> {
  const number = voyageNumber.trim().toUpperCase()
  const imo = vesselImo.trim()
  const name = vesselName.trim().toUpperCase()

  const { data, error } = await supabase
    .from('voyages')
    .select('id, voyage_number, vessel:vessels(name, imo)')
    .ilike('voyage_number', number)
    .overrideTypes<Array<{ id: number; voyage_number: string; vessel: { name: string | null; imo: string | null } | null }>, { merge: false }>()
  if (error) throw error

  const match = (data ?? []).find((row) => {
    if (row.voyage_number.trim().toUpperCase() !== number) return false
    if (imo && row.vessel?.imo) return row.vessel.imo.trim() === imo
    return (row.vessel?.name ?? '').trim().toUpperCase() === name
  })
  return match?.id ?? null
}
```

- [ ] **Step 2: Escrever o teste que falha** (mock de supabase, padrão do repo)

`src/services/__tests__/voyageFromSchedule.attach.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  createVoyage: vi.fn(),
  setShow: vi.fn(),
  findVoyage: vi.fn(),
  savePol: vi.fn(),
  savePod: vi.fn(),
  listPod: vi.fn(),
}))

vi.mock('../voyages', () => ({
  createVoyage: calls.createVoyage,
  setVoyageShowOnPortal: calls.setShow,
  findVoyageByNumberAndVessel: calls.findVoyage,
}))
vi.mock('../voyageRouteSchedules', () => ({
  saveVoyagePolSchedule: calls.savePol,
  saveVoyagePodSchedule: calls.savePod,
  listVoyagePodSchedules: calls.listPod,
  buildVoyagePodEntityId: (id: number, pod: string) => `${id}::${pod}`,
}))

import { createOrAttachVoyageFromSchedule } from '../voyageFromSchedule'

describe('createOrAttachVoyageFromSchedule', () => {
  beforeEach(() => Object.values(calls).forEach((c) => c.mockReset()))

  it('cria viagem nova quando não há match e liga a flag do Portal', async () => {
    calls.findVoyage.mockResolvedValue(null)
    calls.createVoyage.mockResolvedValue({ id: 42 })

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM', vesselImo: '9976501', voyageNumber: '6',
      lanes: [
        { code: 'CNTAO', kind: 'pol', date: '2026-01-04' },
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
      ],
    }, 'user-1')

    expect(calls.createVoyage).toHaveBeenCalledOnce()
    expect(calls.createVoyage.mock.calls[0][0].dischargePortEtas).toEqual([{ pod: 'BRSSA', eta: '2026-01-22' }])
    expect(calls.setShow).toHaveBeenCalledWith(42, true)
    expect(calls.savePol).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 42, pol: 'CNTAO', etd: '2026-01-04' }))
  })

  it('anexa à viagem existente sem criar outra, preservando dados reais do POD', async () => {
    calls.findVoyage.mockResolvedValue(99)
    calls.listPod.mockResolvedValue(new Map([['99::BRSSA', { etb: '2026-01-23', ata: '2026-01-22', atd: null, rtw: 3, ceStatus: 'approved', linked: true }]]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM', vesselImo: '9976501', voyageNumber: '6',
      lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-25' }],
    }, 'user-1')

    expect(calls.createVoyage).not.toHaveBeenCalled()
    expect(calls.setShow).toHaveBeenCalledWith(99, true)
    // ETA nova vence; ATA/ATD/RTW/CE/linked preservados.
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({
      voyageId: 99, pod: 'BRSSA', eta: '2026-01-25',
      etb: '2026-01-23', ata: '2026-01-22', atd: null, rtw: 3, ceStatus: 'approved', linked: true,
    }))
  })
})
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.attach.test.ts`
Expected: FAIL — `createOrAttachVoyageFromSchedule` não existe.

- [ ] **Step 4: Implementar a função**

Adicione a `src/services/voyageFromSchedule.ts`:

```ts
import { createVoyage, findVoyageByNumberAndVessel, setVoyageShowOnPortal } from './voyages'
import {
  buildVoyagePodEntityId,
  listVoyagePodSchedules,
  saveVoyagePodSchedule,
  saveVoyagePolSchedule,
} from './voyageRouteSchedules'
import { DEFAULT_CARRIER_NAME, DEFAULT_CARRIER_SCAC } from './voyageForm'

export type VoyageFromScheduleInput = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
}

export async function createOrAttachVoyageFromSchedule(
  input: VoyageFromScheduleInput,
  changedBy: string | null,
): Promise<number> {
  const { pols, pods } = partitionScheduleLanes(input.lanes)

  let voyageId = await findVoyageByNumberAndVessel(input.voyageNumber, input.vesselImo, input.vesselName)

  if (voyageId === null) {
    const created = await createVoyage({
      carrierName: DEFAULT_CARRIER_NAME,
      carrierScac: DEFAULT_CARRIER_SCAC,
      vesselName: input.vesselName,
      vesselImo: input.vesselImo,
      voyageNumber: input.voyageNumber,
      status: 'active',
      dischargePortEtas: pods.map((p) => ({ pod: p.pod, eta: p.eta })),
    }, changedBy)
    voyageId = created.id
  } else {
    await upsertPodEtasPreservingActuals(voyageId, pods, changedBy)
  }

  // POLs: só ETD, sempre via saveVoyagePolSchedule (já escopo-seguro).
  for (const pol of pols) {
    await saveVoyagePolSchedule({ voyageId, pol: pol.code, etd: pol.etd, changedBy })
  }

  await setVoyageShowOnPortal(voyageId, true)
  return voyageId
}

// Grava ETA por POD preservando etb/ata/atd/rtw/ceStatus/linked existentes
// (mesma disciplina de syncDischargePortEtas em voyages.ts).
async function upsertPodEtasPreservingActuals(
  voyageId: number,
  pods: Array<{ pod: string; eta: string }>,
  changedBy: string | null,
) {
  if (!pods.length) return
  const entityIds = pods.map((p) => buildVoyagePodEntityId(voyageId, p.pod))
  const current = await listVoyagePodSchedules(entityIds)
  for (const p of pods) {
    const cur = current.get(buildVoyagePodEntityId(voyageId, p.pod))
    await saveVoyagePodSchedule({
      voyageId, pod: p.pod, eta: p.eta,
      etb: cur?.etb ?? null, ata: cur?.ata ?? null, atd: cur?.atd ?? null,
      rtw: cur?.rtw ?? null, ceStatus: cur?.ceStatus ?? null, linked: cur?.linked ?? false,
      changedBy,
    })
  }
}
```

- [ ] **Step 5: Rodar para ver passar**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.attach.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/voyageFromSchedule.ts src/services/voyages.ts \
        src/services/__tests__/voyageFromSchedule.attach.test.ts
git commit -m "feat(voyage): createOrAttachVoyageFromSchedule com dedup VOY+IMO (ADR 0021)"
```

## Docs to update

- `docs/RASTREABILIDADE.md`: adicionar `voyageFromSchedule.ts` e a coluna
  `show_on_portal` na rastreabilidade da viagem (o plano 03 consome a função).

## STOP conditions

- `createVoyage` mudou de assinatura desde 2026-07-09 (ver drift check) — ajuste
  a chamada e reporte.
- A migração exige nova policy RLS para `show_on_portal` que não seja coberta
  pela policy existente de `voyages` — pare e consulte a skill `supabase-migration`.
