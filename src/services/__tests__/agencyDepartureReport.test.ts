import { describe, expect, it, vi } from 'vitest'
import {
  AGENCY_REPORT_SECTIONS,
  addOccurrence,
  buildContainerTypeMatrix,
  groupEmptyEmbarkBookings,
  groupVehiclesByBrand,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
  setDepartmentSignoff,
  setSectionObservation,
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
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
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

describe('groupEmptyEmbarkBookings', () => {
  it('agrupa por (tipo, condição, local), traduz a condição e ordena alfabeticamente, sem célula zerada', () => {
    const rows = groupEmptyEmbarkBookings([
      { type: '40HC', condition: 'vazio', localLabel: 'VBR' },
      { type: '40HC', condition: 'vazio', localLabel: 'VBR' },
      { type: '40HC', condition: 'material', localLabel: 'VBR' },
      { type: '20DV', condition: 'vazio', localLabel: 'TVV' },
    ])

    expect(rows).toEqual([
      { type: '20DV', condition: 'EMPTY', localLabel: 'TVV', quantity: 1 },
      { type: '40HC', condition: 'EMPTY', localLabel: 'VBR', quantity: 2 },
      { type: '40HC', condition: 'EMPTY W/ MATERIAL', localLabel: 'VBR', quantity: 1 },
    ])
  })
})

describe('AGENCY_REPORT_SECTIONS', () => {
  it('mapeia as 7 secoes aos departamentos donos (ocorrencias removida na ADR 0030)', () => {
    expect(AGENCY_REPORT_SECTIONS).toEqual({
      datas: 'operacoes',
      carga_descarregada: 'documentacao',
      carga_carregada: 'documentacao',
      veiculos: 'equipamentos',
      vazios_embarcados: 'equipamentos',
      vazios_descarregados: 'documentacao',
      operacao_patio: 'equipamentos',
    })
    expect(Object.keys(AGENCY_REPORT_SECTIONS)).toHaveLength(7)
  })
})

describe('getAgencyReportDerivedData', () => {
  it('não consulta unidades ou linhas de serviço quando a escala não possui operação de vazios', async () => {
    fromMock.mockImplementation((table: string) =>
      table === 'vazios_export_operations' ? singleQueryBuilder(null) : queryBuilder(),
    )
    schedulesMock.mockResolvedValue(new Map())

    await getAgencyReportDerivedData(179, 'BRSSA')

    expect(fromMock).not.toHaveBeenCalledWith('vazios_bookings')
    expect(fromMock).not.toHaveBeenCalledWith('vazios_export_service_lines')
    expect(fromMock).not.toHaveBeenCalledWith('depots')
  })

  it('resolve o local das unidades sem depender do relacionamento embutido do PostgREST', async () => {
    const bookingsQuery = queryBuilder([{ container_number: 'ABCD1234567', local_id: 'local-1', condition: 'vazio' }])
    const depotsQuery = queryBuilder([{ id: 'local-1', code: 'DEP', name: 'Depot teste', tipo: 'depot' }])
    fromMock.mockImplementation((table: string) => {
      if (table === 'vazios_bookings') return bookingsQuery
      if (table === 'depots') return depotsQuery
      if (table === 'vazios_export_operations') return singleQueryBuilder({ id: 'operation-1' })
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(bookingsQuery.select).not.toHaveBeenCalledWith(expect.stringContaining('local:depots'))
    expect(result.vaziosExp).toMatchObject([{
      container_number: 'ABCD1234567',
      local: { id: 'local-1', code: 'DEP', name: 'Depot teste', tipo: 'depot' },
    }])
    expect(result.costs).not.toHaveProperty('qtyTotal')
  })

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

  it('compoe a matriz por B/L, flags do BAPLI e categorias operacionais', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bl_containers') {
        return queryBuilder([
          { id: 10, container_number: 'docu 1234567', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          { id: 11, container_number: 'TRNS1234567', type: '20GP', is_imo: false, bl: { transshipments: [{ disposition: 'transshipment' }] } },
          { id: 12, container_number: 'NOBP1234567', type: '40GP', is_imo: true, bl: { transshipments: [] } },
        ])
      }
      if (table === 'baplie_containers') {
        return queryBuilder([
          { container_number: 'DOCU1234567', size_type: '45G1', status: 'full', is_imo: true, pod: 'BRVIX' },
          { container_number: 'TRNS1234567', size_type: '22G1', status: 'full', is_imo: false, pod: 'BRVIX' },
          { container_number: 'ORPH1234567', size_type: '42G1', status: 'full', is_imo: false, pod: 'BRVIX' },
        ])
      }
      if (table === 'vehicles') return queryBuilder([{ brand: 'BYD', bl_id: 'bl-1', chassis: '1', container_id: 10 }])
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    await expect(getAgencyReportDerivedData(179, 'BRVIX')).resolves.toMatchObject({
      containers: [
        { container_number: 'docu 1234567', size_type: '40HC', is_imo: true, category: 'veiculos' },
        { container_number: 'TRNS1234567', size_type: '20GP', is_imo: false, category: 'transbordo' },
        { container_number: 'NOBP1234567', size_type: '40GP', is_imo: true, category: 'imo' },
      ],
      // ORPH1234567 é cheio no Baplie sem B/L correspondente: sai da matriz e
      // vira divergência (Task 3, CAR-1), não mais 'carga_geral'.
      dischargeDivergence: { orphanFullContainers: 1 },
    })
  })

  describe('B/L conta os cheios; Baplie conta os vazios (ADR 2026-07-31, Task 3)', () => {
    it('exclui cheio órfão do Baplie da matriz e o reporta só na divergência; vazio do Baplie vira categoria vazio', async () => {
      fromMock.mockImplementation((table: string) => {
        if (table === 'bl_containers') {
          return queryBuilder([
            { id: 1, container_number: 'FULL0000001', type: '40HC', is_imo: false, bl: { transshipments: [] } },
            { id: 2, container_number: 'FULL0000002', type: '40HC', is_imo: false, bl: { transshipments: [] } },
            { id: 3, container_number: 'FULL0000003', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          ])
        }
        if (table === 'baplie_containers') {
          return queryBuilder([
            { container_number: 'FULL0000001', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'FULL0000002', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'FULL0000003', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'ORPH0000009', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000001', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000002', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
          ])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(result.containers).toHaveLength(5)
      const fullFromBl = result.containers.filter((c) => c.category === 'carga_geral')
      const vazios = result.containers.filter((c) => c.category === 'vazio')
      expect(fullFromBl.map((c) => c.container_number).sort()).toEqual(['FULL0000001', 'FULL0000002', 'FULL0000003'])
      expect(vazios.map((c) => c.container_number).sort()).toEqual(['EMTY0000001', 'EMTY0000002'])
      expect(result.containers.some((c) => c.container_number === 'ORPH0000009')).toBe(false)
      expect(result.dischargeDivergence).toEqual({ orphanFullContainers: 1 })
    })

    it('reporta divergência entre a contagem de vazios do Baplie e a do módulo de vazios, com quantas estão sem natureza', async () => {
      fromMock.mockImplementation((table: string) => {
        if (table === 'baplie_containers') {
          return queryBuilder([
            { container_number: 'EMTY0000001', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000002', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000003', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
          ])
        }
        if (table === 'vazios_importacao_containers') {
          return queryBuilder([
            { container_type: '20GP', natureza: 'cama', pod: 'BRVIX' },
            { container_type: '20GP', natureza: null, pod: 'BRVIX' },
          ])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(result.vaziosDivergence).toEqual({
        baplieCount: 3,
        moduleCount: 2,
        unclassifiedCount: 1,
        diverges: true,
      })
    })
  })

  describe('carga em transbordo (ADR 2026-07-31, Task 1)', () => {
    it('inclui containers, carga solta e veículos de B/Ls em transbordo de um porto omitido', async () => {
      let blContainersCall = 0
      let vehiclesCall = 0
      let blsCall = 0
      fromMock.mockImplementation((table: string) => {
        if (table === 'voyage_omissions') return queryBuilder([{ id: 42 }])
        if (table === 'bl_transshipments') return queryBuilder([{ bl_id: 'BL-T1' }, { bl_id: 'BL-T2' }])
        if (table === 'bl_containers') {
          blContainersCall += 1
          if (blContainersCall === 1) {
            return queryBuilder([
              { id: 1, container_number: 'OWN0000001', type: '40HC', is_imo: false, bl: { transshipments: [] } },
              { id: 2, container_number: 'OWN0000002', type: '40HC', is_imo: false, bl: { transshipments: [] } },
              { id: 3, container_number: 'OWN0000003', type: '40HC', is_imo: false, bl: { transshipments: [] } },
            ])
          }
          return queryBuilder([
            { id: 4, container_number: 'TRB0000001', type: '20GP', is_imo: false, bl: { transshipments: [{ disposition: 'transshipment' }] } },
            { id: 5, container_number: 'TRB0000002', type: '20GP', is_imo: false, bl: { transshipments: [{ disposition: 'transshipment' }] } },
          ])
        }
        if (table === 'bls') {
          blsCall += 1
          if (blsCall === 1) {
            return queryBuilder([{ bb_machine_qty: 1, bb_packages_qty: 2, bb_weight_ton: 1, total_weight_kg: null, total_cbm: 3 }])
          }
          return queryBuilder([{ bb_machine_qty: 5, bb_packages_qty: 6, bb_weight_ton: 2, total_weight_kg: null, total_cbm: 4 }])
        }
        if (table === 'vehicles') {
          vehiclesCall += 1
          if (vehiclesCall === 1) return queryBuilder([{ brand: 'BYD', bl_id: 'BL-OWN', chassis: 'own-1', container_id: null }])
          return queryBuilder([{ brand: 'GWM', bl_id: 'BL-T1', chassis: 'trb-1', container_id: null }])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(result.containers).toHaveLength(5)
      const transbordo = result.containers.filter((container) => container.category === 'transbordo')
      expect(transbordo.map((container) => container.container_number).sort()).toEqual(['TRB0000001', 'TRB0000002'])

      expect(result.cargaSolta).toMatchObject({
        bls: 1,
        machines: 1,
        packages: 2,
        transshipment: { bls: 1, machines: 5, packages: 6 },
      })

      expect(result.vehicles).toEqual([
        expect.objectContaining({ bl_id: 'BL-OWN', isTransshipment: false }),
        expect.objectContaining({ bl_id: 'BL-T1', isTransshipment: true }),
      ])
    })

    it('não dispara consultas extras nem altera o resultado quando a escala não possui omissão', async () => {
      fromMock.mockClear()
      let blContainersCall = 0
      fromMock.mockImplementation((table: string) => {
        if (table === 'voyage_omissions') return queryBuilder([])
        if (table === 'bl_containers') {
          blContainersCall += 1
          return queryBuilder([
            { id: 1, container_number: 'OWN0000001', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          ])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(fromMock).not.toHaveBeenCalledWith('bl_transshipments')
      expect(blContainersCall).toBe(1)
      expect(result.containers).toEqual([
        { container_number: 'OWN0000001', size_type: '40HC', is_imo: false, category: 'carga_geral' },
      ])
      expect(result.cargaSolta.transshipment).toMatchObject({ bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 })
    })
  })
})

describe('Granito casa por porto normalizado, com fallback do manifesto (ADR 2026-07-31, Task 6)', () => {
  it('casa loading_port em LOCODE, em texto livre e via fallback do manifesto contra a escala BRVIX', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'granite_bls') {
        return queryBuilder([
          { real_weight_kg: 1000, blocks_qty: 1, loading_port: 'BRVIX', manifest: { loading_port: null } },
          { real_weight_kg: 2000, blocks_qty: 2, loading_port: 'VITORIA', manifest: { loading_port: null } },
          { real_weight_kg: 3000, blocks_qty: 3, loading_port: 'Vitoria, Brazil', manifest: { loading_port: null } },
          { real_weight_kg: 4000, blocks_qty: 4, loading_port: null, manifest: { loading_port: 'BRVIX' } },
          // outro porto: não deve casar com a escala BRVIX
          { real_weight_kg: 5000, blocks_qty: 5, loading_port: 'BRSSA', manifest: { loading_port: null } },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.granite).toHaveLength(4)
    expect(result.granite.map((bl) => bl.real_weight_kg).sort()).toEqual([1000, 2000, 3000, 4000])
  })
})

describe('getAgencyReportOwnData', () => {
  it('resolve nomes dos atores pelo RPC unico, autorizado no escopo do ADR', async () => {
    const reportQuery = singleQueryBuilder({ id: 'adr-1', closed_by: 'other-user' })
    fromMock.mockImplementation(() => reportQuery)
    rpcMock.mockResolvedValue({ data: [{ user_id: 'other-user', full_name: 'Lucca F.' }], error: null })

    await expect(getAgencyReportOwnData(7, 'BRVIX')).resolves.toMatchObject({
      closed_by_name: 'Lucca F.',
      actor_names: { 'other-user': 'Lucca F.' },
    })

    expect(rpcMock).toHaveBeenCalledWith('get_agency_report_actor_names', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
    })
    expect(fromMock).not.toHaveBeenCalledWith('user_profiles')
  })

  it('degrada sem autor quando a RPC de nomes dos atores falha (migration ausente no remoto)', async () => {
    const reportQuery = singleQueryBuilder({ id: 'adr-1', closed_by: 'other-user' })
    fromMock.mockImplementation(() => reportQuery)
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(getAgencyReportOwnData(7, 'BRVIX')).resolves.toMatchObject({ closed_by_name: null })

    consoleErrorSpy.mockRestore()
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

describe('addOccurrence', () => {
  it('chama a RPC com a tag de seção opcional', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await addOccurrence({ voyageId: 7, port: 'BRVIX', body: 'Atracação concluída.', section: 'operacao_patio' })

    expect(rpcMock).toHaveBeenCalledWith('add_agency_report_occurrence', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_body: 'Atracação concluída.',
      p_section: 'operacao_patio',
    })
  })

  it('omite a seção quando não informada', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await addOccurrence({ voyageId: 7, port: 'BRVIX', body: 'Sem tag.' })

    expect(rpcMock).toHaveBeenCalledWith('add_agency_report_occurrence', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_body: 'Sem tag.',
      p_section: undefined,
    })
  })
})

describe('setSectionObservation', () => {
  it('chama a RPC de Observação por seção (ADR 0030) com os argumentos tipados', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setSectionObservation({ voyageId: 7, port: 'BRVIX', section: 'veiculos', observation: 'Nota de apoio.' })

    expect(rpcMock).toHaveBeenCalledWith('set_agency_report_section_observation', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_section: 'veiculos',
      p_observation: 'Nota de apoio.',
    })
  })
})

describe('setDepartmentSignoff', () => {
  it('chama a RPC do sign-off departamental com os argumentos tipados', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setDepartmentSignoff({ voyageId: 7, port: 'BRVIX', department: 'equipamentos', signed: true })

    expect(rpcMock).toHaveBeenCalledWith('set_agency_report_department_signoff', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_department: 'equipamentos',
      p_signed: true,
      p_justification: undefined,
    })
  })
})
