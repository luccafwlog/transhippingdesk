# Correções pós-revisão da PR #347 — Implementation Plan

> **For agentic workers:** implemente este plano tarefa a tarefa, na ordem. Os
> passos usam checkbox (`- [ ]`) para rastreio. Cada passo é uma ação de 2–5 min
> (escrever teste → vê-lo falhar → implementação mínima → vê-lo passar →
> commit). Rode os gates do repositório (`npm run lint`, `npm test`,
> `npm run docs:check`, `npm run build`) conforme indicado.

**Goal:** corrigir os defeitos apontados na revisão da PR #347 sem sair do
escopo da ADR 0021 (Chegadas e Saídas projeta a Viagem).

**Architecture:** o cadastro de Chegadas e Saídas (CES) escreve na Viagem via
`createOrAttachVoyageFromSchedule`, compartilhada por dois consumidores com
semânticas opostas para "porto sem data": o **formulário unitário** cancela a
escala; o **upload em lote** apenas pula. A remoção de escala respeita realidade
operacional (nunca destrói ATA/ATD/manifesto/B/L). O quadro do Portal exibe
datas formatadas para o cliente brasileiro.

**Tech Stack:** React + TypeScript, TanStack Query, Supabase (Postgres + RPC),
Vitest (jsdom para componentes), Zod.

**Branch de trabalho:** aplicar sobre a HEAD da PR #347
(`codex/cadastro-unico-navio-viagem`). Os arquivos abaixo já existem nessa
branch (foram introduzidos pela própria PR).

---

## Decisões do grilling (fecham lacunas da ADR 0021)

Estas decisões refinam a ADR 0021, que definiu "não escala" só no sentido de
criação. Viram **nota editorial** da ADR na Tarefa 7.

- **D1 — Remoção na edição (CES).** Marcar "não escala" numa viagem publicada
  zera o ETD/ETA publicado. POD **sem âncora operacional** → soft-delete (some
  de Portal, Viagens e Line-Up). POD **com âncora** → só zera o ETA publicado (o
  POD permanece; nada operacional é destruído). O cliente vê o sumiço silencioso;
  o rastro fica na auditoria.
- **D2 — Lote vs. unitário.** A função compartilhada ganha `mode: 'form' |
  'bulk'`. `'form'` cancela escalas sem data; `'bulk'` pula (`X`/vazio não toca
  em nada). Default `'bulk'` (não destrutivo).
- **D3 — Exibição de datas.** Widget do Portal e tabela do CES exibem
  `DD/MM/AAAA` (conversão por string, sem `new Date`, sem bug de fuso). Inputs do
  formulário seguem ISO nativo (`<input type="date">`). `'X'` inalterado.
- **D4 — Edição = só agenda.** Na edição, passa o `voyageId` conhecido (sem
  re-dedup) e os campos navio/VOY/IMO ficam **read-only**. Dedup só nos caminhos
  de criar/anexar (add unitário + lote). Identidade de viagem se corrige na tela
  Viagens.
- **D5 — Performance do RPC.** Sem índice novo agora; comentário `ponytail:` no
  RPC nomeando o teto e o upgrade.
- **D6 — Âncora operacional (POD).** `linked === true || ata != null || atd !=
  null || existe B/L consignado para esse POD`. POL não tem soft-delete: cancelar
  POL = `etd = null`.
- **D7a — Robustez do lote.** Ler a planilha com `cellDates: true`;
  `parseCellDate` aceita `Date`; célula não-vazia, não-`X` e não-parseável vira
  **aviso de linha** (nunca some em silêncio).
- **D7b — Dedup por VOY.** Manter `ilike` (case-insensitive é necessário para
  viagens nascidas de manifesto, gravadas em caixa variável), porém **escapando**
  os metacaracteres `%`/`_` do valor. `.eq` foi rejeitado por regredir a
  case-insensitivity.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/services/voyageFromSchedule.ts` | orquestra criar/anexar + cancelar escala; modo form/bulk; teste de âncora | Modificar |
| `src/services/voyages.ts` | `findVoyageByNumberAndVessel` (escape do `ilike`) | Modificar |
| `src/services/portalScheduleLanes.ts` | `formatScheduleDate` (helper puro de exibição) | Modificar |
| `src/services/portalScheduleBulkImport.ts` | `parseCellDate` aceita `Date`; avisos de célula inválida | Modificar |
| `src/pages/ChegadasSaidas.tsx` | passa `mode`/`voyageId`; identidade read-only na edição; exibe `DD/MM/AAAA`; mostra avisos do lote | Modificar |
| `src/components/portal/ShipScheduleWidget.tsx` | exibe `DD/MM/AAAA` | Modificar |
| `supabase/migrations/173_portal_ship_schedule.sql` | comentário `ponytail:` do teto de performance | Modificar |
| `docs/adr/0021-...md`, `docs/modules/chegadas-saidas.md` | nota editorial + comportamento de edição | Modificar |
| `src/services/__tests__/voyageFromSchedule.attach.test.ts` | testes do modo form (cancelar/soft-delete/âncora) | Modificar |
| `src/services/__tests__/portalScheduleLanes.test.ts` | teste de `formatScheduleDate` | Modificar |
| `src/services/__tests__/portalScheduleBulkImport.test.ts` | teste de `Date`/serial + avisos | Modificar |

---

## Task 1: modo form/bulk + cancelamento condicional de escala (D1, D2, D6)

**Files:**
- Modify: `src/services/voyageFromSchedule.ts`
- Test: `src/services/__tests__/voyageFromSchedule.attach.test.ts`

Contexto: hoje `createOrAttachVoyageFromSchedule` recebe `(input, changedBy)` e
`partitionScheduleLanes` **descarta** toda lane sem data, então cancelar uma
escala na edição é um no-op silencioso. Vamos adicionar `options` com `mode` e
`voyageId`, e um caminho de cancelamento que respeita a âncora operacional.

- [ ] **Step 1: escrever o teste que falha — modo form cancela POD sem âncora (soft-delete)**

No arquivo de teste, adicione o mock de `deleteVoyagePodSchedule`,
`saveVoyagePolSchedule`, `listVoyagePolSchedules` e do `supabase` (para a query
de B/L). Substitua o bloco de mocks/topo por:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  createVoyage: vi.fn(),
  setShow: vi.fn(),
  findVoyage: vi.fn(),
  savePol: vi.fn(),
  savePod: vi.fn(),
  deletePod: vi.fn(),
  listPod: vi.fn(),
  listPol: vi.fn(),
  blSelect: vi.fn(),
}))

vi.mock('../voyages', () => ({
  createVoyage: calls.createVoyage,
  setVoyageShowOnPortal: calls.setShow,
  findVoyageByNumberAndVessel: calls.findVoyage,
}))

vi.mock('../voyageRouteSchedules', () => ({
  saveVoyagePolSchedule: calls.savePol,
  saveVoyagePodSchedule: calls.savePod,
  deleteVoyagePodSchedule: calls.deletePod,
  listVoyagePodSchedules: calls.listPod,
  listVoyagePolSchedules: calls.listPol,
  buildVoyagePodEntityId: (id: number, pod: string) => `${id}::${pod}`,
  buildVoyagePolEntityId: (id: number, pol: string) => `${id}::${pol}`,
}))

// supabase.from('bls').select('id').eq(...).eq(...).limit(1) => { data, error }
vi.mock('../supabase', () => ({
  supabase: { from: (...args: unknown[]) => calls.blSelect(...args) },
}))

import { createOrAttachVoyageFromSchedule } from '../voyageFromSchedule'

function blQuery(rows: Array<{ id: string }>) {
  const result = Promise.resolve({ data: rows, error: null })
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => result,
  }
  return builder
}
```

E acrescente o teste do cancelamento sem âncora:

```ts
describe('createOrAttachVoyageFromSchedule — modo form (cancelar escala)', () => {
  beforeEach(() => {
    Object.values(calls).forEach((call) => call.mockReset())
    calls.listPod.mockResolvedValue(new Map())
    calls.listPol.mockResolvedValue(new Map())
    calls.blSelect.mockReturnValue(blQuery([]))
  })

  it('POD sem âncora e sem data vira soft-delete', async () => {
    calls.findVoyage.mockResolvedValue(42)
    // A escala existia com ETA publicado, mas sem linked/ata/atd nem B/L.
    calls.listPod.mockResolvedValue(new Map([
      ['42::BRVIX', { entityId: '42::BRVIX', voyageId: 42, pod: 'BRVIX', eta: '2026-01-25', etb: null, ata: null, atd: null, rtw: null, ceStatus: null, linked: false }],
    ]))

    await createOrAttachVoyageFromSchedule({
      vesselName: 'GREEN PECEM', vesselImo: '9976501', voyageNumber: '6',
      lanes: [
        { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
        { code: 'BRVIX', kind: 'pod', date: null },
      ],
    }, 'user-1', { mode: 'form', voyageId: 42 })

    expect(calls.findVoyage).not.toHaveBeenCalled() // voyageId conhecido: sem dedup
    expect(calls.deletePod).toHaveBeenCalledWith({ voyageId: 42, pod: 'BRVIX', changedBy: 'user-1' })
    expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSA', eta: '2026-01-22' }))
  })
})
```

- [ ] **Step 2: rodar o teste e vê-lo falhar**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.attach.test.ts`
Expected: FAIL (a função ainda ignora `options`; `deleteVoyagePodSchedule` não é chamado).

- [ ] **Step 3: reescrever `voyageFromSchedule.ts` com o modo e o cancelamento**

Substitua o conteúdo por:

```ts
import { DEFAULT_CARRIER_NAME, DEFAULT_CARRIER_SCAC } from './voyageForm'
import { supabase } from './supabase'
import {
  createVoyage,
  findVoyageByNumberAndVessel,
  setVoyageShowOnPortal,
} from './voyages'
import {
  buildVoyagePodEntityId,
  buildVoyagePolEntityId,
  deleteVoyagePodSchedule,
  listVoyagePodSchedules,
  listVoyagePolSchedules,
  saveVoyagePodSchedule,
  saveVoyagePolSchedule,
  type VoyagePodSchedule,
} from './voyageRouteSchedules'

export type ScheduleLaneInput = {
  /** Code canonico do porto (de portalLaneCode). */
  code: string
  kind: 'pol' | 'pod'
  /** Data ISO (YYYY-MM-DD) ou null/'' quando o porto nao escala. */
  date: string | null
}

export type VoyageScheduleInput = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
}

/**
 * 'bulk' pula lanes sem data (X = nao mexe; planilha nao cancela em massa).
 * 'form' trata lane sem data como cancelamento explicito da escala.
 */
export type ScheduleWriteMode = 'form' | 'bulk'

export type ScheduleWriteOptions = {
  mode?: ScheduleWriteMode
  /** Viagem alvo conhecida (edicao): pula a deduplicacao por VOY+navio. */
  voyageId?: number
}

export function partitionScheduleLanes(lanes: ScheduleLaneInput[]) {
  const pols: Array<{ code: string; etd: string }> = []
  const pods: Array<{ pod: string; eta: string }> = []
  for (const lane of lanes) {
    const date = (lane.date ?? '').trim()
    if (!date) continue
    if (lane.kind === 'pol') pols.push({ code: lane.code, etd: date })
    else pods.push({ pod: lane.code, eta: date })
  }
  return { pols, pods }
}

/** Lanes explicitamente sem data — candidatas a cancelamento no modo 'form'. */
function collectClearedLanes(lanes: ScheduleLaneInput[]) {
  const pols: string[] = []
  const pods: string[] = []
  for (const lane of lanes) {
    if ((lane.date ?? '').trim()) continue
    if (lane.kind === 'pol') pols.push(lane.code)
    else pods.push(lane.code)
  }
  return { pols, pods }
}

/**
 * Uma escala de POD tem ancora operacional quando ha realidade que o Portal nao
 * pode apagar: manifesto vinculado, ATA/ATD reais, ou B/L consignado para o POD.
 */
async function podHasOperationalAnchor(
  voyageId: number,
  podCode: string,
  current: VoyagePodSchedule | undefined,
): Promise<boolean> {
  if (current?.linked || current?.ata || current?.atd) return true
  const { data, error } = await supabase
    .from('bls')
    .select('id')
    .eq('voyage_id', voyageId)
    .eq('pod', podCode)
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

async function cancelClearedLanes(
  voyageId: number,
  lanes: ScheduleLaneInput[],
  changedBy: string | null,
) {
  const cleared = collectClearedLanes(lanes)

  // POL: basta zerar o ETD publicado (o RPC exige valor nao-nulo -> some do Portal).
  const clearedPolIds = cleared.pols.map((code) => buildVoyagePolEntityId(voyageId, code))
  const currentPols = await listVoyagePolSchedules(clearedPolIds)
  await Promise.all(cleared.pols.map((code) => {
    const current = currentPols.get(buildVoyagePolEntityId(voyageId, code))
    if (!current?.etd) return Promise.resolve() // nada publicado: nada a cancelar
    return saveVoyagePolSchedule({ voyageId, pol: code, etd: null, changedBy })
  }))

  // POD: zera o ETA publicado; sem ancora operacional, soft-delete.
  const clearedPodIds = cleared.pods.map((code) => buildVoyagePodEntityId(voyageId, code))
  const currentPods = await listVoyagePodSchedules(clearedPodIds)
  await Promise.all(cleared.pods.map(async (code) => {
    const current = currentPods.get(buildVoyagePodEntityId(voyageId, code))
    if (!current) return // escala nunca existiu: nada a cancelar
    const anchored = await podHasOperationalAnchor(voyageId, code, current)
    if (anchored) {
      if (current.eta === null) return // ja sem ETA publicado; preserva o operacional
      await saveVoyagePodSchedule({
        voyageId,
        pod: code,
        eta: null,
        etb: current.etb ?? null,
        ata: current.ata ?? null,
        atd: current.atd ?? null,
        rtw: current.rtw ?? null,
        ceStatus: current.ceStatus ?? null,
        linked: current.linked ?? false,
        changedBy,
      })
      return
    }
    await deleteVoyagePodSchedule({ voyageId, pod: code, changedBy })
  }))
}

export async function createOrAttachVoyageFromSchedule(
  input: VoyageScheduleInput,
  changedBy: string | null,
  options: ScheduleWriteOptions = {},
) {
  const mode = options.mode ?? 'bulk'
  const { pols, pods } = partitionScheduleLanes(input.lanes)

  const existingId = options.voyageId
    ?? (await findVoyageByNumberAndVessel(input.voyageNumber, input.vesselImo, input.vesselName))
  const voyageId = existingId ?? (await createVoyage({
    carrierName: DEFAULT_CARRIER_NAME,
    carrierScac: DEFAULT_CARRIER_SCAC,
    vesselName: input.vesselName,
    vesselImo: input.vesselImo,
    voyageNumber: input.voyageNumber,
    status: 'active',
    loadPortEtds: [],
    dischargePortEtas: [],
  }, changedBy)).id

  await setVoyageShowOnPortal(voyageId, true)

  await Promise.all(pols.map((pol) => saveVoyagePolSchedule({
    voyageId,
    pol: pol.code,
    etd: pol.etd,
    changedBy,
  })))

  const entityIds = pods.map((pod) => buildVoyagePodEntityId(voyageId, pod.pod))
  const currentSchedules = await listVoyagePodSchedules(entityIds)

  await Promise.all(pods.map((pod) => {
    const current = currentSchedules.get(buildVoyagePodEntityId(voyageId, pod.pod))
    return saveVoyagePodSchedule({
      voyageId,
      pod: pod.pod,
      eta: pod.eta,
      etb: current?.etb ?? null,
      ata: current?.ata ?? null,
      atd: current?.atd ?? null,
      rtw: current?.rtw ?? null,
      ceStatus: current?.ceStatus ?? null,
      linked: current?.linked ?? false,
      changedBy,
    })
  }))

  // So a edicao unitaria cancela escalas; o lote apenas pula (X != cancelar).
  if (mode === 'form') {
    await cancelClearedLanes(voyageId, input.lanes, changedBy)
  }

  return { voyageId, created: existingId === null }
}
```

- [ ] **Step 4: rodar o teste e vê-lo passar**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.attach.test.ts`
Expected: PASS.

- [ ] **Step 5: adicionar o teste do POD com âncora (não apaga, só zera ETA)**

```ts
it('POD com ancora (linked) so zera o ETA publicado, sem soft-delete', async () => {
  calls.listPod.mockResolvedValue(new Map([
    ['42::BRSSA', { entityId: '42::BRSSA', voyageId: 42, pod: 'BRSSA', eta: '2026-01-22', etb: null, ata: null, atd: null, rtw: null, ceStatus: null, linked: true }],
  ]))

  await createOrAttachVoyageFromSchedule({
    vesselName: 'GREEN PECEM', vesselImo: '9976501', voyageNumber: '6',
    lanes: [{ code: 'BRSSA', kind: 'pod', date: null }],
  }, 'user-1', { mode: 'form', voyageId: 42 })

  expect(calls.deletePod).not.toHaveBeenCalled()
  expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSA', eta: null, linked: true }))
})
```

- [ ] **Step 6: adicionar o teste do modo bulk (pula lane sem data, nunca cancela)**

```ts
it('modo bulk ignora lanes sem data (nao cancela)', async () => {
  calls.findVoyage.mockResolvedValue(42)
  calls.listPod.mockResolvedValue(new Map())

  await createOrAttachVoyageFromSchedule({
    vesselName: 'GREEN PECEM', vesselImo: '9976501', voyageNumber: '6',
    lanes: [
      { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
      { code: 'BRVIX', kind: 'pod', date: null },
    ],
  }, 'user-1', { mode: 'bulk' })

  expect(calls.deletePod).not.toHaveBeenCalled()
  expect(calls.savePod).toHaveBeenCalledTimes(1)
  expect(calls.savePod).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSA' }))
})
```

- [ ] **Step 7: garantir que os dois testes legados de attach continuam verdes**

Os testes existentes ("anexa a viagem existente..." e "cria viagem quando nao
encontra dedup...") chamam a função **sem** `options` (default `mode: 'bulk'`,
sem `voyageId`). Como `blSelect`/`listPol` agora têm defaults no `beforeEach`,
eles continuam passando.

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.attach.test.ts src/services/__tests__/voyageFromSchedule.test.ts`
Expected: PASS (todos).

- [ ] **Step 8: commit**

```bash
git add src/services/voyageFromSchedule.ts src/services/__tests__/voyageFromSchedule.attach.test.ts
git commit -m "fix(ces): cancelar escala na edicao respeitando ancora operacional; modo form/bulk"
```

---

## Task 2: fiação no CES — modo/voyageId e identidade read-only (D2, D4)

**Files:**
- Modify: `src/pages/ChegadasSaidas.tsx`
- Test: `src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`

- [ ] **Step 1: escrever o teste que falha — edição não re-deduplica e usa o voyageId**

Adicione ao arquivo de behavior (o mock de `createOrAttachVoyageFromSchedule` já
existe como `mocks.createOrAttach`):

```ts
it('edicao salva com mode form e o voyageId conhecido (sem re-dedup)', async () => {
  const user = userEvent.setup()
  render(<ChegadasSaidas />)

  await user.click(screen.getAllByTitle('Editar')[0]) // ALPHA, voyageId 1
  await user.click(screen.getByRole('button', { name: /Salvar/ }))

  expect(mocks.createOrAttach).toHaveBeenCalledWith(
    expect.objectContaining({ vesselName: 'ALPHA', voyageNumber: '001' }),
    'user-1',
    expect.objectContaining({ mode: 'form', voyageId: 1 }),
  )
})

it('campos de identidade ficam read-only na edicao', async () => {
  const user = userEvent.setup()
  render(<ChegadasSaidas />)

  await user.click(screen.getAllByTitle('Editar')[0])
  expect((screen.getByLabelText('Nome do Navio') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Viagem (VOY)') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Número IMO') as HTMLInputElement).disabled).toBe(true)
})
```

> Observação: a viagem ALPHA de teste (`datesByLabel: { SALVADOR: '2026-01-22' }`)
> tem um POD com data, então a validação "ao menos um POD com data" do
> `handleSubmit` passa ao salvar a edição sem tocar nas datas.

- [ ] **Step 2: rodar e vê-lo falhar**

Run: `npx vitest run src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`
Expected: FAIL (chamada sem 3º argumento; inputs não desabilitados).

- [ ] **Step 3: passar `mode`/`voyageId` no `handleSubmit`**

Em `ChegadasSaidas.tsx`, dentro de `handleSubmit`, troque a chamada:

```tsx
      await createOrAttachVoyageFromSchedule({
        vesselName: formData.vesselName,
        vesselImo: formData.vesselImo,
        voyageNumber: formData.voyageNumber,
        lanes,
      }, user?.id ?? null, { mode: 'form', voyageId: editingId ?? undefined })
```

E no `SpreadsheetUpload.handleFile`, deixe o lote explícito:

```tsx
          await createOrAttachVoyageFromSchedule(row, user?.id ?? null, { mode: 'bulk' })
```

- [ ] **Step 4: tornar identidade read-only na edição**

No componente `VesselForm`, os inputs de navio/VOY/IMO recebem `disabled={isEditing}`.
Aplique nos três (o `isEditing` já é prop do componente):

```tsx
          <input id="vessel_name" className="app-input app-input--full" value={formData.vesselName} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, vesselName: event.target.value })} placeholder="GREEN PECEM" required />
```
```tsx
          <input id="voyage" className="app-input app-input--full" value={formData.voyageNumber} disabled={isEditing}
            onChange={(event) => onChange({ ...formData, voyageNumber: event.target.value })} placeholder="6" required />
```
```tsx
        <input id="imo_number" className="app-input app-input--full" value={formData.vesselImo} disabled={isEditing}
          onChange={(event) => onChange({ ...formData, vesselImo: event.target.value })} placeholder="9976501" />
```

E adicione uma dica quando `isEditing`, logo abaixo do campo IMO:

```tsx
        {isEditing ? (
          <div className="mt-1 text-xs text-[var(--app-muted)]">
            Navio, VOY e IMO se editam na tela Viagens. Aqui você ajusta apenas as datas da programação.
          </div>
        ) : null}
```

- [ ] **Step 5: rodar os testes de behavior e vê-los passar**

Run: `npx vitest run src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`
Expected: PASS. (Os testes legados desta suíte usam ALPHA/BETA e continuam válidos.)

- [ ] **Step 6: commit**

```bash
git add src/pages/ChegadasSaidas.tsx src/pages/__tests__/ChegadasSaidas.behavior.test.tsx
git commit -m "fix(ces): edicao usa voyageId conhecido e trava identidade; lote explicito como bulk"
```

---

## Task 3: exibir datas em DD/MM/AAAA (D3)

**Files:**
- Modify: `src/services/portalScheduleLanes.ts`
- Modify: `src/components/portal/ShipScheduleWidget.tsx`
- Modify: `src/pages/ChegadasSaidas.tsx`
- Test: `src/services/__tests__/portalScheduleLanes.test.ts`

- [ ] **Step 1: escrever o teste que falha de `formatScheduleDate`**

Acrescente ao teste de lanes:

```ts
import { PORTAL_SCHEDULE_LANES, portalLaneCode, formatScheduleDate } from '../portalScheduleLanes'

describe('formatScheduleDate', () => {
  it('converte ISO em DD/MM/AAAA sem usar Date (sem bug de fuso)', () => {
    expect(formatScheduleDate('2026-01-22')).toBe('22/01/2026')
  })
  it('mantem X e valores nao-ISO como estao', () => {
    expect(formatScheduleDate('X')).toBe('X')
    expect(formatScheduleDate('')).toBe('')
    expect(formatScheduleDate('22/01/2026')).toBe('22/01/2026')
  })
})
```

- [ ] **Step 2: rodar e vê-lo falhar**

Run: `npx vitest run src/services/__tests__/portalScheduleLanes.test.ts`
Expected: FAIL ("formatScheduleDate is not a function").

- [ ] **Step 3: implementar `formatScheduleDate`**

No fim de `src/services/portalScheduleLanes.ts`:

```ts
/** Exibe uma data ISO (YYYY-MM-DD) como DD/MM/AAAA para o cliente. Conversao
 *  por string: nunca instancia Date, entao nao ha desvio de fuso horario. */
export function formatScheduleDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}
```

- [ ] **Step 4: rodar e vê-lo passar**

Run: `npx vitest run src/services/__tests__/portalScheduleLanes.test.ts`
Expected: PASS.

- [ ] **Step 5: aplicar no widget do Portal**

Em `ShipScheduleWidget.tsx`, importe e use na `DateCell` (mantendo `isDateInPast`
sobre o ISO cru):

```tsx
import { PORTAL_SCHEDULE_LANES, formatScheduleDate } from '../../services/portalScheduleLanes'
```

E no corpo da `DateCell`, troque o conteúdo renderizado:

```tsx
    <td className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${isX ? 'text-[var(--app-muted-soft)]' : isPast ? 'text-[var(--app-blue-btn)] font-semibold' : 'text-[var(--app-text)]'}`}>
      {isX ? 'X' : formatScheduleDate(value)}
    </td>
```

- [ ] **Step 6: aplicar na tabela do CES**

Em `ChegadasSaidas.tsx`, importe `formatScheduleDate` (junte ao import existente
de `portalScheduleLanes`) e troque o corpo de `DateTd`:

```tsx
    <td className={`px-3 py-2.5 text-center text-sm border-r border-[var(--app-border)] ${isX ? 'text-[var(--app-muted-soft)]' : info.isPast ? 'text-[var(--app-blue)] font-semibold' : ''}`}>
      {isX ? 'X' : formatScheduleDate(value)}
    </td>
```

- [ ] **Step 7: ajustar o teste do widget (agora exibe DD/MM/AAAA)**

O teste `ShipScheduleWidget.test.tsx` espera `screen.getByText('2026-01-04')`.
Troque as duas asserções de data para o formato exibido:

```ts
  expect(screen.getByText('04/01/2026')).toBeTruthy()
  expect(screen.getByText('22/01/2026')).toBeTruthy()
```

- [ ] **Step 8: rodar os testes tocados e vê-los passar**

Run: `npx vitest run src/services/__tests__/portalScheduleLanes.test.ts src/components/portal/__tests__/ShipScheduleWidget.test.tsx`
Expected: PASS.

- [ ] **Step 9: commit**

```bash
git add src/services/portalScheduleLanes.ts src/components/portal/ShipScheduleWidget.tsx src/pages/ChegadasSaidas.tsx src/services/__tests__/portalScheduleLanes.test.ts src/components/portal/__tests__/ShipScheduleWidget.test.tsx
git commit -m "fix(portal): exibir programacao em DD/MM/AAAA para o cliente"
```

---

## Task 4: robustez do upload em lote (D7a)

**Files:**
- Modify: `src/services/portalScheduleBulkImport.ts`
- Modify: `src/pages/ChegadasSaidas.tsx`
- Test: `src/services/__tests__/portalScheduleBulkImport.test.ts`

- [ ] **Step 1: escrever os testes que falham — Date e célula inválida viram aviso**

Acrescente ao teste de bulk import:

```ts
import { parseScheduleRows, scheduleTemplateColumns } from '../portalScheduleBulkImport'

it('aceita celula Date (Excel auto-formatado) convertendo para ISO', () => {
  const [row] = parseScheduleRows([{
    'VESSEL NAME': 'GREEN PECEM', VOY: '6', IMO: '9976501',
    'QINGDAO ETD': new Date('2026-01-04T00:00:00'),
  }])
  expect(row.lanes.find((lane) => lane.code === 'CNTAO')?.date).toBe('2026-01-04')
})

it('reporta celula nao-vazia e nao-parseavel como aviso, sem sumir', () => {
  const [row] = parseScheduleRows([{
    'VESSEL NAME': 'GREEN PECEM', VOY: '6', IMO: '9976501',
    'SALVADOR ETA': 'quarta-feira',
  }])
  expect(row.lanes.find((lane) => lane.code === 'BRSSA')?.date).toBe(null)
  expect(row.invalidCells).toContain('SALVADOR ETA')
})
```

- [ ] **Step 2: rodar e vê-los falhar**

Run: `npx vitest run src/services/__tests__/portalScheduleBulkImport.test.ts`
Expected: FAIL (`Date` não parseado; `invalidCells` inexistente).

- [ ] **Step 3: `parseCellDate` aceita Date; `BulkScheduleRow` ganha `invalidCells`**

Em `portalScheduleBulkImport.ts`, ajuste o tipo e as funções:

```ts
export type BulkScheduleRow = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
  /** Colunas com conteudo que nao pôde ser lido como data (aviso ao operador). */
  invalidCells: string[]
}
```

```ts
export function parseCellDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  const value = String(raw ?? '').trim()
  if (!value || value.toUpperCase() === 'X') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return null
}

/** Celula "vazia" = ausente, string vazia ou X (nao gera aviso). */
function isBlankCell(raw: unknown): boolean {
  if (raw == null) return true
  const value = String(raw).trim()
  return value === '' || value.toUpperCase() === 'X'
}

export function parseScheduleRows(rows: Array<Record<string, unknown>>): BulkScheduleRow[] {
  return rows
    .map((row) => {
      const vesselName = String(row['VESSEL NAME'] ?? row['Vessel Name'] ?? '').trim()
      const voyageNumber = String(row.VOY ?? '').trim()
      const vesselImo = String(row.IMO ?? '').trim()
      const invalidCells: string[] = []
      const lanes = PORTAL_SCHEDULE_LANES.map((lane) => {
        const column = laneColumn(lane.label, lane.kind)
        const raw = readCell(row, column) ?? row[lane.label]
        const date = parseCellDate(raw)
        if (date === null && !isBlankCell(raw)) invalidCells.push(column)
        return { code: portalLaneCode(lane), kind: lane.kind, date }
      })
      return { vesselName, vesselImo, voyageNumber, lanes, invalidCells }
    })
    .filter((row) => row.vesselName && row.voyageNumber && row.vesselName !== 'EXEMPLO NAVIO')
}
```

- [ ] **Step 4: rodar e vê-los passar**

Run: `npx vitest run src/services/__tests__/portalScheduleBulkImport.test.ts`
Expected: PASS.

- [ ] **Step 5: ler a planilha com `cellDates: true` e surfacear os avisos**

Em `ChegadasSaidas.tsx`, no `SpreadsheetUpload.handleFile`, troque a leitura para
converter datas nativas do Excel:

```tsx
      const wb = XLSX.read(buf, { cellDates: true })
```

E, ao processar cada linha, colete os avisos de célula (sem sumir em silêncio).
Amplie o acumulador e o loop:

```tsx
      const parsed = parseScheduleRows(rows)
      const next = { updated: [] as string[], errors: [] as string[], warnings: [] as string[] }

      for (const row of parsed) {
        if (row.invalidCells.length > 0) {
          next.warnings.push(`${row.vesselName} / ${row.voyageNumber}: datas ilegíveis em ${row.invalidCells.join(', ')}`)
        }
        try {
          await createOrAttachVoyageFromSchedule(row, user?.id ?? null, { mode: 'bulk' })
          next.updated.push(`${row.vesselName} / ${row.voyageNumber}`)
        } catch (error) {
          next.errors.push(`${row.vesselName}: ${error instanceof Error ? error.message : 'falha inesperada'}`)
        }
      }
```

Atualize o tipo do estado e a exibição do resultado:

```tsx
  const [result, setResult] = useState<{ updated: string[]; errors: string[]; warnings: string[] } | null>(null)
```
```tsx
      {result && (
        <div className="space-y-2 mt-4 pt-4 border-t border-[var(--app-border)] text-sm">
          {result.updated.length > 0 && <div className="text-[var(--app-green)] font-medium">{result.updated.length} atualizada(s)</div>}
          {result.warnings.length > 0 && <div className="text-[var(--app-gold)]">{result.warnings.length} com datas ilegíveis (ignoradas)</div>}
          {result.errors.length > 0 && <div className="text-[var(--app-red)]">{result.errors.length} erro(s)</div>}
        </div>
      )}
```

- [ ] **Step 6: rodar a suíte do CES e do bulk para garantir que nada quebrou**

Run: `npx vitest run src/services/__tests__/portalScheduleBulkImport.test.ts src/services/__tests__/uxCopyContracts.test.ts`
Expected: PASS. (`uxCopyContracts` verifica strings do CES; nenhuma que mudamos é asserida negativamente.)

- [ ] **Step 7: commit**

```bash
git add src/services/portalScheduleBulkImport.ts src/pages/ChegadasSaidas.tsx src/services/__tests__/portalScheduleBulkImport.test.ts
git commit -m "fix(ces): lote le datas nativas do Excel e avisa celulas ilegiveis"
```

---

## Task 5: escape do `ilike` na deduplicação (D7b)

**Files:**
- Modify: `src/services/voyages.ts`
- Test: `src/services/__tests__/voyageDedup.test.ts` (novo)

Correção mínima: manter a busca case-insensitive, mas escapar `%`/`_`/`\` do
valor para que não atuem como curinga. `.eq` foi descartado porque quebraria a
dedup de viagens gravadas em caixa variável (import de manifesto).

- [ ] **Step 1: escrever o teste que falha — o padrão passado ao `ilike` é escapado**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ ilike: vi.fn() }))

vi.mock('../supabase', () => {
  const builder = {
    select: () => builder,
    ilike: (...args: unknown[]) => { calls.ilike(...args); return builder },
    overrideTypes: () => Promise.resolve({ data: [], error: null }),
  }
  return { supabase: { from: () => builder } }
})

import { findVoyageByNumberAndVessel } from '../voyages'

describe('findVoyageByNumberAndVessel — escape do ilike', () => {
  beforeEach(() => calls.ilike.mockReset())

  it('escapa metacaracteres LIKE do numero de viagem', async () => {
    await findVoyageByNumberAndVessel('50%_A', '', 'NAVIO')
    expect(calls.ilike).toHaveBeenCalledWith('voyage_number', '50\\%\\_A')
  })
})
```

- [ ] **Step 2: rodar e vê-lo falhar**

Run: `npx vitest run src/services/__tests__/voyageDedup.test.ts`
Expected: FAIL (o valor chega sem escape).

- [ ] **Step 3: escapar o valor antes do `ilike`**

Em `voyages.ts`, dentro de `findVoyageByNumberAndVessel`, antes da query:

```ts
  const number = voyageNumber.trim().toUpperCase()
  const imo = vesselImo.trim()
  const name = vesselName.trim().toUpperCase()
  // Escapa curingas LIKE para casar o numero literalmente (case-insensitive).
  const numberPattern = number.replace(/[\\%_]/g, (char) => `\\${char}`)
```

E troque a linha do filtro:

```ts
    .ilike('voyage_number', numberPattern)
```

(O `.find` client-side segue comparando `row.voyage_number.trim().toUpperCase() === number`, agora com o valor **sem** escape — inalterado.)

- [ ] **Step 4: rodar e vê-lo passar**

Run: `npx vitest run src/services/__tests__/voyageDedup.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/services/voyages.ts src/services/__tests__/voyageDedup.test.ts
git commit -m "fix(voyages): escapar curingas LIKE na dedup por numero de viagem"
```

---

## Task 6: comentário `ponytail:` de performance no RPC (D5)

**Files:**
- Modify: `supabase/migrations/173_portal_ship_schedule.sql`

> **Guard:** migrations são protegidas por hook (CLAUDE.md §"Claude Code
> integration"). Esta é a migration **nova da própria PR**, ainda não aplicada —
> editar seu comentário antes do merge é legítimo. Se o hook bloquear, use a
> autorização explícita prevista.

- [ ] **Step 1: adicionar o comentário nomeando o teto e o upgrade**

Logo acima do `CREATE OR REPLACE FUNCTION public.portal_ship_schedule()`, insira:

```sql
-- ponytail: a projecao varre audit_logs (voyage_pol_schedule/voyage_pod_schedule)
-- e faz DISTINCT ON ordenado por changed_at a cada leitura. OK no volume atual +
-- cache do cliente (React Query). Teto: cresce ~7 linhas por edicao de POD.
-- Upgrade = indice coberto (entity_type, entity_id, field_name, changed_at DESC)
-- ou tabela materializada de "ultimo valor" se a leitura virar hot.
```

- [ ] **Step 2: garantir que o teste de forma da migration ainda passa**

Run: `npx vitest run src/services/__tests__/portalShipScheduleMigration.test.ts`
Expected: PASS (o comentário não altera as asserções de definer/allowlist).

- [ ] **Step 3: commit**

```bash
git add supabase/migrations/173_portal_ship_schedule.sql
git commit -m "docs(migration): nomear teto de performance do portal_ship_schedule (ponytail)"
```

---

## Task 7: documentação viva (CLAUDE.md §6)

**Files:**
- Modify: `docs/adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md`
- Modify: `docs/modules/chegadas-saidas.md`

- [ ] **Step 1: nota editorial na ADR 0021**

Ao fim da ADR 0021, seguindo o estilo de `docs/CONVENCOES.md`, adicione:

```markdown
## Nota editorial — 2026-07-09 (implementação, PR #347)

A decisão original definiu "não escala" só na criação. A implementação precisou
resolver a **remoção**:

- **Cancelamento na edição unitária** zera o ETD/ETA publicado. POD **sem âncora
  operacional** (sem `linked`, sem ATA/ATD, sem B/L consignado) é **soft-deletado**
  e some de Portal, Viagens e Line-Up; POD **com âncora** mantém a escala e apenas
  perde o ETA publicado — o Portal nunca destrói realidade operacional. POL
  cancela apenas com `etd = null` (sem soft-delete).
- **Upload em lote** não cancela: `X`/vazio significa "não mexe". A função
  `createOrAttachVoyageFromSchedule` distingue os dois via `mode: 'form' | 'bulk'`.
- **Edição = só agenda.** Navio/VOY/IMO são read-only na edição do CES (dedup só
  na criação/anexação); identidade se corrige na tela Viagens.
```

- [ ] **Step 2: refletir o comportamento no módulo de Chegadas e Saídas**

Em `docs/modules/chegadas-saidas.md`, na seção que descreve o cadastro/edição,
acrescente um parágrafo curto:

```markdown
Na **edição**, apenas as datas da programação são editáveis — navio, VOY e IMO
são read-only (corrigidos na tela Viagens). Marcar um porto como "não escala"
cancela aquela escala: o ETD/ETA publicado é removido e, se a escala não tiver
âncora operacional (manifesto vinculado, ATA/ATD ou B/L), ela é removida também
de Viagens e do Line-Up. O upload em lote nunca cancela escalas — células vazias
ou "X" são ignoradas.
```

- [ ] **Step 3: rodar o gate de docs**

Run: `npm run docs:check`
Expected: PASS (sem links quebrados).

- [ ] **Step 4: commit**

```bash
git add docs/adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md docs/modules/chegadas-saidas.md
git commit -m "docs: registrar semantica de remocao e edicao do CES (ADR 0021 + modulo)"
```

---

## Task 8: gates finais e PR pronta para revisão

**Files:** nenhum (verificação).

- [ ] **Step 1: lint**

Run: `npm run lint`
Expected: PASS (sem erros; atenção a imports não usados removidos nas Tasks 1–4).

- [ ] **Step 2: suíte de testes das superfícies tocadas**

Run: `npx vitest run src/services/__tests__/voyageFromSchedule.attach.test.ts src/services/__tests__/voyageFromSchedule.test.ts src/services/__tests__/portalScheduleLanes.test.ts src/services/__tests__/portalScheduleBulkImport.test.ts src/services/__tests__/voyageDedup.test.ts src/pages/__tests__/ChegadasSaidas.behavior.test.tsx src/components/portal/__tests__/ShipScheduleWidget.test.tsx src/services/__tests__/portalShipScheduleMigration.test.ts`
Expected: PASS (todos).

- [ ] **Step 3: suíte completa**

Run: `npm test`
Expected: PASS. Se falhar, confirme que a falha **não** vem das mudanças deste
plano (a descrição da PR menciona falhas pré-existentes em `blFreightImport` e
`reviewBillingAutomation` por worktree suja — resolva-as antes de marcar pronta,
já que a branch da PR não deve carregar mudanças não commitadas).

- [ ] **Step 4: build + docs**

Run: `npm run build && npm run docs:check`
Expected: PASS.

- [ ] **Step 5: push e marcar a PR como pronta**

```bash
git push
```

Marque a PR #347 como **ready for review** (sair de draft). A descrição da PR já
lista a verificação; adicione uma nota de que os achados da revisão foram
endereçados (D1–D7).

---

## Self-Review (checklist do autor)

- **Cobertura dos achados da revisão:** remoção-na-edição (Tasks 1–2), datas ISO
  ao cliente (Task 3), duplicata-ao-renomear (Task 2, `voyageId` + identidade
  read-only), performance do RPC (Task 6), serial do Excel + perda silenciosa
  (Task 4), escape do `ilike` (Task 5), docs (Task 7), draft/teste (Task 8). ✔
- **Sem placeholders:** todo passo que altera código traz o código; todo comando
  traz o resultado esperado. ✔
- **Consistência de tipos/nomes:** `ScheduleWriteOptions`/`mode`/`voyageId`
  (Task 1) são exatamente o objeto passado no `handleSubmit` (Task 2);
  `invalidCells` (Task 4) é o campo lido no loop de upload; `formatScheduleDate`
  (Task 3) tem o mesmo nome nas três telas. ✔
- **Escopo (ADR 0021):** nenhuma tarefa faz o CES mutar dado operacional; o
  cancelamento respeita âncora; identidade fica na tela Viagens. ✔
