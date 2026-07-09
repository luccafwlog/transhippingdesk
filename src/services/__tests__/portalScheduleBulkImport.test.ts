import { describe, expect, it } from 'vitest'
import { parseScheduleRows, scheduleTemplateColumns } from '../portalScheduleBulkImport'

describe('parseScheduleRows', () => {
  it('gera colunas do template a partir da constante de lanes', () => {
    expect(scheduleTemplateColumns()).toEqual(
      expect.arrayContaining(['VESSEL NAME', 'VOY', 'IMO', 'QINGDAO ETD', 'SALVADOR ETA']),
    )
  })

  it('converte linha em input, tratando X/vazio como nao escala e DD/MM/AAAA em ISO', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'QINGDAO ETD': '04/01/2026',
      'SHANGHAI ETD': 'X',
      'SALVADOR ETA': '2026-01-22',
    }])

    expect(row.vesselName).toBe('GREEN PECEM')
    expect(row.lanes).toContainEqual({ code: 'CNTAO', kind: 'pol', date: '2026-01-04' })
    expect(row.lanes.find((lane) => lane.code === 'CNSHA')?.date).toBe(null)
    expect(row.lanes.find((lane) => lane.code === 'BRSSA')?.date).toBe('2026-01-22')
  })

  it('aceita celula Date (Excel auto-formatado) convertendo para ISO', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'QINGDAO ETD': new Date('2026-01-04T00:00:00'),
    }])
    expect(row.lanes.find((lane) => lane.code === 'CNTAO')?.date).toBe('2026-01-04')
  })

  it('reporta celula nao-vazia e nao-parseavel como aviso, sem sumir', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'SALVADOR ETA': 'quarta-feira',
    }])
    expect(row.lanes.find((lane) => lane.code === 'BRSSA')?.date).toBe(null)
    expect(row.invalidCells).toContain('SALVADOR ETA')
  })
})
