# Plan 06: Upload em lote reescrito sobre viagens

> **Executor instructions**: Follow step by step. Run every verification. Update
> the status row in `../README.md` when done.
>
> **Drift check (run first)**:
> `git log --oneline -3 -- src/pages/ChegadasSaidas.tsx src/services/vesselScheduleImport.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (escrita em lote nas viagens)
- **Depends on**: 01, 02
- **Category**: feature (ADR 0021)

## Why this matters

O operador confirmou que o upload em lote é usado de verdade para atualizar
datas de forma rápida e dinâmica. No desenho antigo ele casava navios por nome e
atualizava colunas de `vessel_schedules` (`ChegadasSaidas.tsx:178-228`). Com o
cadastro único, ele precisa alimentar **viagens**: casar navio+VOY e atualizar
ETD/ETA no mesmo escopo seguro (nunca ATA/ATD/RTW/CE/linked).

## Current state

- `SpreadsheetUpload` (`ChegadasSaidas.tsx:145-260`) baixa template e faz upload,
  mapeando colunas fixas (`'QINGDAO ETD' → qingdao_etd`, etc.) e dando
  `supabase.from('vessel_schedules').update(...)` por navio casado por nome.
- Plano 03 desconectou esse componente da tela. Este plano o reescreve.

## Target

Uma planilha com colunas: `VESSEL NAME`, `VOY`, `IMO` e uma coluna por lane de
`PORTAL_SCHEDULE_LANES` (ex.: `QINGDAO ETD`, `SALVADOR ETA`, …). Cada linha vira
uma chamada a `createOrAttachVoyageFromSchedule` (mesma dedup VOY+IMO). Datas em
ISO ou `DD/MM/AAAA`; célula vazia/`X` = "não escala".

## Tasks

### Task 1: Parser puro planilha → inputs de viagem

**Files:**
- Create: `src/services/portalScheduleBulkImport.ts`
- Test: `src/services/__tests__/portalScheduleBulkImport.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { parseScheduleRows, scheduleTemplateColumns } from '../portalScheduleBulkImport'

describe('parseScheduleRows', () => {
  it('gera colunas do template a partir da constante de lanes', () => {
    expect(scheduleTemplateColumns()).toEqual(
      expect.arrayContaining(['VESSEL NAME', 'VOY', 'IMO', 'QINGDAO ETD', 'SALVADOR ETA']),
    )
  })

  it('converte linha em input, tratando X/vazio como não escala e DD/MM/AAAA em ISO', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM', 'VOY': '6', 'IMO': '9976501',
      'QINGDAO ETD': '04/01/2026', 'SHANGHAI ETD': 'X', 'SALVADOR ETA': '2026-01-22',
    }])
    expect(row.vesselName).toBe('GREEN PECEM')
    expect(row.lanes).toContainEqual({ code: 'CNTAO', kind: 'pol', date: '2026-01-04' })
    expect(row.lanes.find((l) => l.code === 'CNSHA')?.date).toBe(null)
    expect(row.lanes.find((l) => l.code === 'BRSSA')?.date).toBe('2026-01-22')
  })
})
```

- [ ] **Step 2: Rodar (falha)** — `npx vitest run src/services/__tests__/portalScheduleBulkImport.test.ts`

- [ ] **Step 3: Implementar** — `portalScheduleBulkImport.ts`:
  - `scheduleTemplateColumns()`: `['VESSEL NAME','VOY','IMO', ...lanes.map(l =>
    `${l.label} ${l.kind === 'pol' ? 'ETD' : 'ETA'}`)]` (rótulo sem acento na
    coluna se preferir; aceite ambos na leitura).
  - `parseScheduleRows(rows)`: para cada linha, extrai navio/VOY/IMO e, por lane,
    lê a célula, normaliza a data com `parseCellDate` (ISO passa direto;
    `DD/MM/AAAA` → ISO; `X`/vazio → null) e monta
    `{ code: portalLaneCode(lane), kind: lane.kind, date }`.

```ts
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from './portalScheduleLanes'
import type { ScheduleLaneInput } from './voyageFromSchedule'

export type BulkScheduleRow = {
  vesselName: string; vesselImo: string; voyageNumber: string; lanes: ScheduleLaneInput[]
}

const laneColumn = (label: string, kind: 'pol' | 'pod') => `${label} ${kind === 'pol' ? 'ETD' : 'ETA'}`

export function scheduleTemplateColumns(): string[] {
  return ['VESSEL NAME', 'VOY', 'IMO', ...PORTAL_SCHEDULE_LANES.map((l) => laneColumn(l.label, l.kind))]
}

export function parseCellDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s || s.toUpperCase() === 'X') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null // formato não reconhecido = não escala (reportado ao operador)
}

export function parseScheduleRows(rows: Array<Record<string, unknown>>): BulkScheduleRow[] {
  return rows
    .map((row) => {
      const vesselName = String(row['VESSEL NAME'] ?? row['Vessel Name'] ?? '').trim()
      const voyageNumber = String(row['VOY'] ?? '').trim()
      const vesselImo = String(row['IMO'] ?? '').trim()
      const lanes = PORTAL_SCHEDULE_LANES.map((l) => ({
        code: portalLaneCode(l), kind: l.kind,
        date: parseCellDate(row[laneColumn(l.label, l.kind)] ?? row[l.label]),
      }))
      return { vesselName, vesselImo, voyageNumber, lanes }
    })
    .filter((r) => r.vesselName && r.voyageNumber && r.vesselName !== 'EXEMPLO NAVIO')
}
```

- [ ] **Step 4: Rodar (passa)**

- [ ] **Step 5: Commit** — `git commit -m "feat(chegadas): parser do upload em lote sobre lanes de viagem"`

### Task 2: Reconectar `SpreadsheetUpload` às viagens

**Files:**
- Modify: `src/pages/ChegadasSaidas.tsx` (`SpreadsheetUpload`)

- [ ] **Step 1**: `downloadTemplate` gera cabeçalho de `scheduleTemplateColumns()`
  com uma linha de exemplo. (Não precisa mais ler `vessel_schedules`.)

- [ ] **Step 2**: `handleFile` passa as linhas por `parseScheduleRows` e, para
  cada `BulkScheduleRow`, chama `createOrAttachVoyageFromSchedule(row, user?.id)`;
  acumula sucesso/erro por navio no mesmo painel de resultado
  (`ChegadasSaidas.tsx:248-254`). Invalida `['portal-schedule-voyages']` e
  `['voyages']` ao final.

- [ ] **Step 3**: Recolocar `<SpreadsheetUpload>` na tela (removido no plano 03),
  apontando o `onUpdate` para invalidar `['portal-schedule-voyages']`.

- [ ] **Step 4: Teste** — cubra `parseScheduleRows` (Task 1) e um teste de
  comportamento leve garantindo que o submit do upload chama o serviço por linha
  (mock de `createOrAttachVoyageFromSchedule`). Rode:
  `npx vitest run src/pages/__tests__/ChegadasSaidas.behavior.test.tsx`.

- [ ] **Step 5: Commit** — `git commit -m "feat(chegadas): upload em lote atualiza viagens (ETD/ETA, dedup VOY+IMO)"`

## Docs to update

- `docs/modules/chegadas-saidas.md`: seção do upload em lote reescrita.
- `docs/import/` se houver catálogo de importadores (ver skill `import-parser`).
- Rodar `npm run docs:check`.

## STOP conditions

- Se `parseCellDate` receber muitos formatos reais fora de ISO/`DD/MM/AAAA`
  (ex.: `DD/MM` sem ano), pare e reporte — o ADR 0021 exige ano; um `DD/MM` no
  arquivo deve virar erro visível ao operador, não "não escala" silencioso.
  (Ajuste: colecione essas células num `errors[]` do painel de resultado em vez
  de descartá-las.)
