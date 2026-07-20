import { describe, expect, it, vi } from 'vitest'
import {
  AGENCY_REPORT_SECTIONS,
  buildContainerTypeMatrix,
  groupVehiclesByBrand,
  getAgencyReportDerivedData,
} from '../agencyDepartureReport'

const { fromMock, schedulesMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  schedulesMock: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))
vi.mock('../voyageRouteSchedules', () => ({
  buildVoyagePodEntityId: (voyageId: number, port: string) => `${voyageId}::${port}`,
  listVoyagePodSchedules: schedulesMock,
}))
vi.mock('../vaziosExportOperations', () => ({
  computeStorageTotals: vi.fn(() => ({ containers: 0, days: 0 })),
}))

function queryBuilder(data: unknown[] = []) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  }
  return builder
}

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

describe('getAgencyReportDerivedData', () => {
  it('restringe veículos ao POD do BL, evitando misturar escalas da mesma viagem', async () => {
    const vehiclesQuery = queryBuilder([{ brand: 'BYD', bl_id: 'bl-1', chassis: '1', container_id: 10 }])
    fromMock.mockImplementation((table: string) => table === 'vehicles' ? vehiclesQuery : queryBuilder())
    schedulesMock.mockResolvedValue(new Map([['7::BRSSZ', null]]))

    await getAgencyReportDerivedData(7, 'BRSSZ')

    expect(vehiclesQuery.eq).toHaveBeenCalledWith('bl.voyage_id', 7)
    expect(vehiclesQuery.eq).toHaveBeenCalledWith('bl.pod', 'BRSSZ')
  })

  it('busca o local de desova do container para o bloco de veículos', async () => {
    const vehiclesQuery = queryBuilder()
    fromMock.mockImplementation((table: string) => table === 'vehicles' ? vehiclesQuery : queryBuilder())
    schedulesMock.mockResolvedValue(new Map())

    await getAgencyReportDerivedData(7, 'BRSSZ')

    expect(vehiclesQuery.select).toHaveBeenCalledWith(expect.stringContaining('unpacking_location'))
  })
})
