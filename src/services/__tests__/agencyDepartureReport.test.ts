import { describe, expect, it, vi } from 'vitest'
import {
  AGENCY_REPORT_SECTIONS,
  buildContainerTypeMatrix,
  groupVehiclesByBrand,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
  setSignoff,
} from '../agencyDepartureReport'

const { fromMock, schedulesMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  schedulesMock: vi.fn(),
}))

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))
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

function singleQueryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
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
  it('agrega a carga solta dos B/Ls Breakbulk apenas no porto da escala', async () => {
    const breakbulkQuery = queryBuilder([
      { bb_machine_qty: 2, bb_packages_qty: 8, bb_weight_ton: 3.5, total_weight_kg: 9999, total_cbm: 12.25 },
      { bb_machine_qty: 1, bb_packages_qty: 4, bb_weight_ton: null, total_weight_kg: 2500, total_cbm: 7.75 },
    ])
    fromMock.mockImplementation((table: string) => table === 'bls' ? breakbulkQuery : queryBuilder())
    schedulesMock.mockResolvedValue(new Map())

    await expect(getAgencyReportDerivedData(7, 'BRSSZ')).resolves.toMatchObject({
      cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 },
    })

    expect(breakbulkQuery.eq).toHaveBeenCalledWith('voyage_id', 7)
    expect(breakbulkQuery.eq).toHaveBeenCalledWith('pod', 'BRSSZ')
    expect(breakbulkQuery.eq).toHaveBeenCalledWith('cargo_mode', 'carga_solta')
  })

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

describe('getAgencyReportOwnData', () => {
  it('resolve closed_by para o nome exibido no fechamento', async () => {
    const reportQuery = singleQueryBuilder({ id: 'adr-1', closed_by: 'user-1' })
    const profileQuery = singleQueryBuilder({ full_name: 'Lucca F.' })
    fromMock.mockImplementation((table: string) => table === 'agency_departure_reports' ? reportQuery : profileQuery)

    await expect(getAgencyReportOwnData(7, 'BRVIX')).resolves.toMatchObject({ closed_by_name: 'Lucca F.' })

    expect(profileQuery.select).toHaveBeenCalledWith('full_name')
    expect(profileQuery.eq).toHaveBeenCalledWith('id', 'user-1')
  })
})

describe('setSignoff', () => {
  it('chama a RPC da migration 213 com os argumentos tipados', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setSignoff({ voyageId: 7, port: 'BRVIX', section: 'datas', state: 'confirmed' })

    expect(rpcMock).toHaveBeenCalledWith('set_agency_report_signoff', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_section: 'datas',
      p_state: 'confirmed',
    })
  })
})
