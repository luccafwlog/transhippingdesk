import { describe, expect, it } from 'vitest'
import {
  AGENCY_REPORT_SECTIONS,
  buildContainerTypeMatrix,
  groupVehiclesByBrand,
} from '../agencyDepartureReport'

describe('buildContainerTypeMatrix', () => {
  it('agrupa contagens por tipo e categoria', () => {
    const matrix = buildContainerTypeMatrix([
      { type: '40HC', category: 'carga_geral' },
      { type: '40HC', category: 'carga_geral' },
      { type: '40HC', category: 'imo' },
      { type: '20GP', category: 'veiculos' },
    ])

    expect(matrix.rows['40HC']).toEqual({ carga_geral: 2, imo: 1 })
    expect(matrix.rows['20GP']).toEqual({ veiculos: 1 })
    expect(matrix.totals).toEqual({ carga_geral: 2, imo: 1, veiculos: 1 })
  })
})

describe('groupVehiclesByBrand', () => {
  it('agrega marcas com qty de BLs distintos e chassis', () => {
    const grouped = groupVehiclesByBrand([
      { brand: 'BYD', bl_id: 'a', chassis: '1' },
      { brand: 'BYD', bl_id: 'a', chassis: '2' },
      { brand: 'BYD', bl_id: 'b', chassis: '3' },
      { brand: 'GWM', bl_id: 'c', chassis: '4' },
    ])

    expect(grouped).toEqual([
      { brand: 'BYD', blCount: 2, vinCount: 3 },
      { brand: 'GWM', blCount: 1, vinCount: 1 },
    ])
  })
})

describe('AGENCY_REPORT_SECTIONS', () => {
  it('mapeia as 7 secoes aos departamentos donos', () => {
    expect(AGENCY_REPORT_SECTIONS).toEqual({
      datas: 'operacoes',
      carga_descarregada: 'documentacao',
      carga_carregada: 'documentacao',
      veiculos: 'equipamentos',
      vazios_embarcados: 'equipamentos',
      vazios_descarregados: 'documentacao',
      ocorrencias: 'operacoes',
    })
  })
})
