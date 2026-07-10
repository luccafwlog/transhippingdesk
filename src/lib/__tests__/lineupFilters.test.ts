import { describe, expect, it } from 'vitest'
import { countActiveLineUpFilters, emptyLineUpFilters, filterLineUpRows } from '../lineupFilters'
import type { LineUpRow } from '../../services/lineup'

const rows: LineUpRow[] = [
  row({ id: '1::SSZ', voyageId: 1, vesselName: 'Aurora', voyageNumber: '001A', pod: 'SSZ', eta: '2026-07-11', vin: 2, bbTotal: 1, mty: 3, rtw: 2, ceStatus: 'approved', linked: true }),
  row({ id: '1::RIO', voyageId: 1, vesselName: 'Aurora', voyageNumber: '001A', pod: 'RIO', eta: '2026-07-12', vin: 0, bbTotal: 0, mty: 0, rtw: null, ceStatus: 'waiting', linked: false }),
  row({ id: '2::PNG', voyageId: 2, vesselName: 'Boreal', voyageNumber: '002B', pod: 'PNG', eta: '2026-07-13', vin: 0, bbTotal: 0, mty: 0, rtw: 0, ceStatus: 'missing', linked: false }),
  row({ id: 'exp::3', voyageId: 3, vesselName: 'Exportador', voyageNumber: '003C', rowType: 'export', eta: '2026-07-14', exportCeStatus: 'approved', exportLinked: true }),
]

describe('filterLineUpRows', () => {
  it('filtra por navio, viagem e período inclusive', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), vessels: ['Aurora'], voyages: ['001A'], periodo: 'custom', dataInicio: '2026-07-12', dataFim: '2026-07-12' }).map((item) => item.id)).toEqual(['1::RIO', 'exp::3'])
  })

  it('filtra linhas de importação que possuem veículos ou BB', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), vehicles: true }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), bb: true }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
  })

  it('considera MTY em toda a viagem, embora seja creditado apenas na primeira rota', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), mty: true }).map((item) => item.id)).toEqual(['1::SSZ', '1::RIO', 'exp::3'])
  })

  it('não considera RTW nulo ou zero como presente', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), rtw: true }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
  })

  it('agrupa waiting e missing como CEs aguardando', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), ces: 'waiting' }).map((item) => item.id)).toEqual(['1::RIO', '2::PNG', 'exp::3'])
  })

  it('usa os campos de exportação para CEs e Linked e mantém exportações visíveis', () => {
    expect(filterLineUpRows(rows, { ...emptyLineUpFilters(), ces: 'approved', linked: true }).map((item) => item.id)).toEqual(['1::SSZ', 'exp::3'])
  })

  it('conta filtros ativos sem contar as datas isoladamente', () => {
    expect(countActiveLineUpFilters({ ...emptyLineUpFilters(), vessels: ['Aurora'], periodo: 'custom', dataInicio: '2026-07-11', dataFim: '2026-07-12', linked: true })).toBe(3)
  })
})

function row(overrides: Partial<LineUpRow>): LineUpRow {
  return {
    id: 'row', voyageId: 99, voyageNumber: '000', voyageStatus: 'active', vesselName: 'Navio', pod: 'POD', eta: null, etb: null,
    rowType: 'import', vin: 0, car: 0, cg: 0, total: 0, mty: 0, rtw: null, bbMachines: 0, bbPackages: 0, bbTotal: 0,
    atd: null, ceStatus: 'waiting', linked: false, exportHasGranite: null, exportContainersQty: null, exportMovementsQty: null,
    exportCeStatus: null, exportLinked: null, ...overrides,
  }
}
