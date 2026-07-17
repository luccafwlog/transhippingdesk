import * as XLSX from '@e965/xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scheduleMocks = vi.hoisted(() => ({
  listVoyagePolSchedules: vi.fn(),
  saveVoyagePolSchedule: vi.fn(),
}))

vi.mock('../voyageRouteSchedules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../voyageRouteSchedules')>()
  return {
    ...actual,
    listVoyagePolSchedules: scheduleMocks.listVoyagePolSchedules,
    saveVoyagePolSchedule: scheduleMocks.saveVoyagePolSchedule,
  }
})

import { formatPolDeparture } from '../../components/voyages/voyageCardHelpers'
import { buildBlFreightPayload, buildBlFreightPreview } from '../blFreightImport'
import { applyLadenOnBoardAtd } from '../ladenOnBoardAtd'
import { parseBLBuffer } from '../blParser'

function buildCoscoBlBuffer(blNumber: string, ladenOnBoard: string, containerNumber: string) {
  const rows: Array<Array<string | number>> = Array.from({ length: 60 }, () => [])
  rows[5][0] = 'EXPORTADORA TESTE LTDA\nRUA DO PORTO, 10'
  rows[5][28] = blNumber
  rows[9][0] = 'IMPORTADORA FUNCIONAL LTDA\nRUA DAS FLORES, 100\nCNPJ: 12.345.678/0001-95'
  rows[13][0] = 'NOTIFY TESTE LTDA'
  rows[17][0] = 'GREEN SANTOS   14'
  rows[17][6] = 'CNSHA'
  rows[19][0] = 'BRSSZ'
  rows[19][6] = 'SANTOS'
  rows[34][27] = ladenOnBoard
  rows[37][0] = '2026-07-10'
  rows[42][9] = 'Description of Goods (If Dangerous Goods, See Clause 21)'
  rows[43][9] = '10 UNITS OF TEST CARGO'
  rows[45][0] = 'TOTAL:'
  rows[45][2] = '10 UNITS'
  rows[46][0] = `${containerNumber} / SEAL001 / 3900 / COC / 10 PKG / 40HC / 28000 KGS / 68.500 CBM`

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Page 1')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('WS1 functional smoke', () => {
  beforeEach(() => {
    scheduleMocks.listVoyagePolSchedules.mockReset()
    scheduleMocks.saveVoyagePolSchedule.mockReset()
  })

  it('liga XLSX, payload documental, menor Laden on Board e exibicao do ATD sem acesso externo', async () => {
    const documents = await Promise.all([
      parseBLBuffer(buildCoscoBlBuffer('WS1-SMOKE-001', '2026-07-09', 'TCLU1234567')),
      parseBLBuffer(buildCoscoBlBuffer('WS1-SMOKE-002', '2026-07-08', 'CSNU7654321')),
    ])
    const payloads = documents.map((document) => buildBlFreightPayload(document, 390))

    expect(documents.map((document) => document.dates.ladenOnBoard)).toEqual(['2026-07-09', '2026-07-08'])
    expect(payloads.map((payload) => payload.consignee)).toEqual([
      'IMPORTADORA FUNCIONAL LTDA',
      'IMPORTADORA FUNCIONAL LTDA',
    ])
    expect(payloads.map((payload) => payload.consignee_block)).toEqual([
      'IMPORTADORA FUNCIONAL LTDA\nRUA DAS FLORES, 100\nCNPJ: 12.345.678/0001-95',
      'IMPORTADORA FUNCIONAL LTDA\nRUA DAS FLORES, 100\nCNPJ: 12.345.678/0001-95',
    ])

    const preview = buildBlFreightPreview({
      documents,
      selectedVoyage: { id: 390, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })
    expect(preview.rows.map((row) => row.ladenOnBoard)).toEqual(['2026-07-09', '2026-07-08'])
    expect(preview.rows.map((row) => row.payload)).toEqual(payloads)

    scheduleMocks.listVoyagePolSchedules.mockResolvedValue(new Map([
      ['390::CNSHA', {
        entityId: '390::CNSHA',
        voyageId: 390,
        pol: 'CNSHA',
        etd: '2026-07-15',
        atd: '2026-07-10',
        escalaNumber: null,
      }],
    ]))

    await applyLadenOnBoardAtd({ rows: preview.rows, changedBy: 'ws1-smoke' })

    expect(scheduleMocks.saveVoyagePolSchedule).toHaveBeenCalledOnce()
    expect(scheduleMocks.saveVoyagePolSchedule).toHaveBeenCalledWith({
      voyageId: 390,
      pol: 'CNSHA',
      etd: '2026-07-15',
      atd: '2026-07-08',
      changedBy: 'ws1-smoke',
    })
    expect(formatPolDeparture('2026-07-15', '2026-07-08')).toEqual({
      value: '2026-07-08',
      isActual: true,
    })
  })
})
