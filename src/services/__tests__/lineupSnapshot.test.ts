import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../supabase', () => ({ supabase: { from: (table: string) => from(table) } }))

function builder(result: { data: unknown; error: unknown }) {
  let data = Array.isArray(result.data) ? result.data : result.data
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'or', 'ilike', 'limit', 'not', 'overrideTypes', 'gte', 'lte']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.eq = vi.fn((field: string, value: unknown) => {
    if (Array.isArray(data) && data.some((row) => row && typeof row === 'object' && field in row)) {
      data = data.filter((row) => row && typeof row === 'object' && (row as Record<string, unknown>)[field] === value)
    }
    return chain
  })
  chain.in = vi.fn((field: string, values: unknown[]) => {
    if (Array.isArray(data) && data.some((row) => row && typeof row === 'object' && field in row)) {
      data = data.filter((row) => row && typeof row === 'object' && values.includes((row as Record<string, unknown>)[field]))
    }
    return chain
  })
  chain.range = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: result.error }).then(resolve)
  return chain
}

function byTable(tables: Record<string, unknown[]>) {
  return (table: string) => builder({ data: tables[table] ?? [], error: null })
}

const VOYAGE = {
  id: 24,
  voyage_number: '24W',
  status: 'active',
  vessel: { name: 'MV TESTE' },
  pol: { name: 'Vitoria', locode: 'BRVIX' },
}

describe('fetchLineUpSnapshot', () => {
  beforeEach(() => from.mockReset())

  it('devolve snapshot vazio sem consultar mais nada quando nao ha viagem', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({}))
    await expect(fetchLineUpSnapshot()).resolves.toEqual({ rows: [], lastChangedAt: null })
    expect(from.mock.calls.map(([table]) => table)).toEqual(['voyages'])
  })

  it('propaga a recusa do banco em vez de devolver snapshot parcial', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(() => builder({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(fetchLineUpSnapshot()).rejects.toBeTruthy()
  })

  it('monta uma linha de importacao por Escala da viagem', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{ id: 'BL1', voyage_id: 24, pod: 'BRSSZ', cargo_mode: 'carga_solta', ce_mercante: 'CE1', bb_machine_qty: 2, bb_packages_qty: 10 }],
      audit_logs: [
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRSSZ', field_name: 'eta', new_value: '2026-08-01', changed_at: '2026-07-27T00:00:00Z' },
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRSSZ', field_name: 'ata', new_value: '2026-08-02', changed_at: '2026-07-27T00:00:00Z' },
      ],
    }))
    const snapshot = await fetchLineUpSnapshot()
    const row = snapshot.rows.find((candidate) => candidate.pod === 'BRSSZ')
    expect(row).toBeDefined()
    expect(row).toMatchObject({ voyageId: 24, voyageNumber: '24W', vesselName: 'MV TESTE', rowType: 'import', ata: '2026-08-02', bbMachines: 2 })
  })

  it('monta linha de exportacao com datas da escala unificada', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      voyage_export_schedules: [{
        id: 'EXP1',
        voyage_id: 24,
        pol: 'BRVIX',
        has_granite: true,
        containers_qty: 12,
        movements_qty: 14,
        eta: '2026-08-01',
        etb: '2026-08-02',
        ce_status: 'received',
        linked: true,
      }],
      audit_logs: [
        { entity_type: 'voyage_pol_schedule', entity_id: '24::BRVIX', field_name: 'atd', new_value: '2026-08-05', changed_at: '2026-07-27T00:00:00Z' },
      ],
    }))

    const snapshot = await fetchLineUpSnapshot()
    const row = snapshot.rows.find((candidate) => candidate.id === 'exp::24::BRVIX')

    expect(row).toBeDefined()
    expect(row).toMatchObject({
      voyageId: 24,
      pod: 'BRVIX',
      rowType: 'export',
      eta: '2026-08-01',
      etb: '2026-08-02',
      ata: null,
      atb: null,
      atd: '2026-08-05',
      exportHasGranite: true,
      exportContainersQty: 12,
      exportMovementsQty: 14,
      exportCeStatus: 'received',
      exportLinked: true,
    })
  })
})
