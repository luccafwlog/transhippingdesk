# Plan 03: Formulário Chegadas e Saídas cria/anexa a Viagem

> **Executor instructions**: Follow step by step. Run every verification. Honor
> STOP conditions. Update the status row in `../README.md` when done.
>
> **Drift check (run first)**:
> `git log --oneline -3 -- src/pages/ChegadasSaidas.tsx`
> Re-read the file if it changed since 2026-07-09.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (troca o destino de escrita da tela; datas viram obrigatórias)
- **Depends on**: 01, 02
- **Category**: feature (ADR 0021)

## Why this matters

É a tela onde o operador vê o valor: cadastrar aqui passa a criar/anexar a
Viagem (via `createOrAttachVoyageFromSchedule`, plano 02), com datas reais e a
regra "não escala". A tela para de escrever em `vessel_schedules`.

## Current state

`src/pages/ChegadasSaidas.tsx`:
- `emptyVessel` (linhas 10-22): campos texto livre por porto + IMO.
- `handleSubmit` (293-306): `insert`/`update` em `vessel_schedules`.
- `VesselForm` (63-143): inputs de texto por porto.
- Lista `vessels` (269-276) lê `vessel_schedules`; setas de ordem (308-320) e
  `handleEnd`/`handleDelete` (322-339) mexem em `vessel_schedules`/`ended_vessels`.

## Target

- Formulário com **um seletor de data por lane** (de `PORTAL_SCHEDULE_LANES`) +
  checkbox "não escala" (equivalente ao antigo `X`). Sem campo de armador.
- Submit monta `lanes: ScheduleLaneInput[]` e chama
  `createOrAttachVoyageFromSchedule`.
- A lista passa a mostrar as **viagens visíveis no Portal** (ordenadas por ETA),
  editáveis (pré-preenchidas a partir dos schedules) e removíveis do Portal
  (`setVoyageShowOnPortal(id, false)` em vez de arquivar). Setas de ordem
  removidas (ordenação automática por ETA — ADR 0021).

## Tasks

### Task 1: Helper puro — montar lanes a partir do formulário

**Files:**
- Create: `src/pages/chegadasSaidasForm.ts`
- Test: `src/pages/__tests__/chegadasSaidasForm.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { buildScheduleLanes, emptyScheduleForm } from '../chegadasSaidasForm'

describe('buildScheduleLanes', () => {
  it('converte o form em lanes com code canônico, pulando "não escala"', () => {
    const form = { ...emptyScheduleForm }
    form.dates['QINGDAO'] = '2026-01-04'
    form.dates['SALVADOR'] = '2026-01-22'
    form.dates['VITÓRIA'] = '' // não escala
    const lanes = buildScheduleLanes(form)
    expect(lanes).toContainEqual({ code: 'CNTAO', kind: 'pol', date: '2026-01-04' })
    expect(lanes).toContainEqual({ code: 'BRSSA', kind: 'pod', date: '2026-01-22' })
    expect(lanes.find((l) => l.code === 'BRVIX')?.date).toBe(null)
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npx vitest run src/pages/__tests__/chegadasSaidasForm.test.ts`

- [ ] **Step 3: Implementar**

```ts
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import type { ScheduleLaneInput } from '../services/voyageFromSchedule'

export type ScheduleForm = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  /** data ISO por label de lane; '' = não escala. */
  dates: Record<string, string>
}

export const emptyScheduleForm: ScheduleForm = {
  vesselName: '', vesselImo: '', voyageNumber: '',
  dates: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((l) => [l.label, ''])),
}

export function buildScheduleLanes(form: ScheduleForm): ScheduleLaneInput[] {
  return PORTAL_SCHEDULE_LANES.map((lane) => ({
    code: portalLaneCode(lane),
    kind: lane.kind,
    date: form.dates[lane.label]?.trim() ? form.dates[lane.label] : null,
  }))
}
```

- [ ] **Step 4: Rodar (passa)**

- [ ] **Step 5: Commit** — `git commit -m "feat(chegadas): montar lanes do formulário sobre a constante de portos"`

### Task 2: Reescrever o submit da tela

**Files:**
- Modify: `src/pages/ChegadasSaidas.tsx` (`emptyVessel`, `VesselForm`, `handleSubmit`)

- [ ] **Step 1: Trocar o estado do formulário** para `ScheduleForm`
  (`emptyScheduleForm`), removendo `emptyVessel` e o campo de armador (que já não
  existe). O `VesselForm` passa a renderizar, para cada `lane` de
  `PORTAL_SCHEDULE_LANES`: um `<input type="date">` ligado a
  `formData.dates[lane.label]` + um checkbox "não escala" que, marcado, zera a
  data (`dates[lane.label] = ''`) e desabilita o date input. Campos fixos no
  topo: Nome do Navio, Viagem (VOY), IMO (mantém os inputs atuais de
  `ChegadasSaidas.tsx:73-88`).

- [ ] **Step 2: Reescrever `handleSubmit`** (substitui `ChegadasSaidas.tsx:293-306`):

```ts
const handleSubmit = async () => {
  const lanes = buildScheduleLanes(formData)
  const pods = lanes.filter((l) => l.kind === 'pod' && l.date)
  if (!formData.vesselName.trim() || !formData.voyageNumber.trim()) {
    showToast('Informe navio e número da viagem.', 'error'); return
  }
  if (pods.length === 0) {
    showToast('Informe ao menos um porto de descarga com data.', 'error'); return
  }
  try {
    await createOrAttachVoyageFromSchedule({
      vesselName: formData.vesselName,
      vesselImo: formData.vesselImo,
      voyageNumber: formData.voyageNumber,
      lanes,
    }, user?.id ?? null)
    showToast('Viagem cadastrada e publicada no Portal.', 'success')
    queryClient.invalidateQueries({ queryKey: ['portal-schedule-voyages'] })
    queryClient.invalidateQueries({ queryKey: ['voyages'] })
    closeDialog()
  } catch {
    showToast('Falha ao cadastrar a viagem.', 'error')
  }
}
```

Adicione `useAuth` para `user` (padrão de `Viagens.tsx`) e importe
`createOrAttachVoyageFromSchedule` e `buildScheduleLanes`.

- [ ] **Step 3: Verificar typecheck** — `npx tsc --noEmit`
  Expected: sem erros nos arquivos tocados (podem restar erros na lista/edição,
  resolvidos na Task 3).

- [ ] **Step 4: Commit** — `git commit -m "feat(chegadas): submit cria/anexa viagem em vez de vessel_schedules"`

### Task 3: Lista e edição sobre viagens visíveis

**Files:**
- Modify: `src/pages/ChegadasSaidas.tsx` (query da lista, `openEdit`, ações)
- Create: `src/services/portalScheduleVoyages.ts` (query compartilhada com o
  Portal — ver plano 04; se o plano 04 ainda não rodou, crie o mínimo aqui e o
  04 reusa)

- [ ] **Step 1**: Substituir a query `admin-vessel-schedules` por
  `portal-schedule-voyages`, que lista viagens com `show_on_portal = true`,
  ordenadas por ETA (menor ETA de POD). Reuse a projeção do plano 04
  (`fetchPortalScheduleVoyages`); cada linha traz `voyageId`, navio, VOY, IMO e a
  data por lane, para render na tabela existente (`ChegadasSaidas.tsx:397-461`),
  agora com colunas derivadas de `PORTAL_SCHEDULE_LANES`.

- [ ] **Step 2**: `openEdit(row)` pré-preenche o `ScheduleForm` a partir das
  datas projetadas da viagem (POL ETD / POD ETA por lane). Salvar chama de novo
  `createOrAttachVoyageFromSchedule` (anexa à mesma viagem por VOY+IMO).

- [ ] **Step 3**: Trocar `handleEnd`/`handleDelete`/setas de ordem por uma única
  ação **"Remover do Portal"** → `setVoyageShowOnPortal(row.voyageId, false)` +
  invalidate. (Excluir a viagem em si continua responsabilidade da tela Viagens.)
  Remover `reorderVesselSchedules`/`archiveVesselSchedule`/`SpreadsheetUpload`
  desta tela — o upload volta reescrito no plano 06.

- [ ] **Step 4**: Atualizar o teste de comportamento
  `src/pages/__tests__/ChegadasSaidas.behavior.test.tsx` para o novo fluxo
  (cadastro chama `createOrAttachVoyageFromSchedule`; sem escrita em
  `vessel_schedules`). Rode: `npx vitest run src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`.

- [ ] **Step 5: Commit** — `git commit -m "feat(chegadas): lista e edição sobre viagens visíveis no Portal"`

## Docs to update

- `docs/modules/chegadas-saidas.md`: reescrever — a tela agora cria/anexa
  Viagem e projeta; não referencia mais `vessel_schedules`. (Isto também sana a
  observação do Codex no PR #345 sobre o módulo doc dizer o contrário.)
- `docs/RASTREABILIDADE.md`: atualizar a rota `/chegadas-saidas`.
- Rodar `npm run docs:check` ao final.

## STOP conditions

- O plano 04 ainda não definiu `fetchPortalScheduleVoyages` e você não consegue
  derivar a projeção sozinho — rode o plano 04 primeiro, depois volte à Task 3.
- Remover `SpreadsheetUpload` quebra imports usados por outra tela — confirme
  com grep antes de apagar; se compartilhado, só desconecte desta página.
