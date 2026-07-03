import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeBapliePhysicalUpdates,
  computeExistenceDivergences,
  reconcileBaplieWithManifest,
} from '../baplieReconciliation'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

type QueryResult = { data: unknown; error: unknown; count?: number | null }

function createBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    range: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function installReconcileMocks(input: { bls?: unknown[]; baplie?: unknown[]; containers?: unknown[] }) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bls') return createBuilder({ data: input.bls ?? [], error: null })
    if (table === 'baplie_containers') return createBuilder({ data: input.baplie ?? [], error: null })
    if (table === 'bl_containers') return createBuilder({ data: input.containers ?? [], error: null })
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

type Staged = Parameters<typeof computeExistenceDivergences>[0]
type BlCs = Parameters<typeof computeExistenceDivergences>[1]

function staged(rows: Array<Record<string, unknown>>): Staged {
  return rows as unknown as Staged
}
function blcs(rows: Array<Record<string, unknown>>): BlCs {
  return rows as unknown as BlCs
}

describe('computeExistenceDivergences', () => {
  it('aponta container no Baplie (full) e em nenhum B/L', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: '01' }]),
      blcs([]),
    )
    expect(items).toEqual([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567', baplie_bl_ref: 'BL1', slot: '01' },
    ])
  })

  it('aponta container em B/L e ausente do Baplie', () => {
    const items = computeExistenceDivergences(
      staged([]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }]),
    )
    expect(items).toEqual([
      { kind: 'missing_in_baplie', container_number: 'ABCD1234567', bl_container_id: 10, bl_number: 'BL1' },
    ])
  })

  it('não aponta nada quando o container existe nas duas fontes (normalizando)', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD 1234567', status: 'full' }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }]),
    )
    expect(items).toEqual([])
  })

  it('ignora containers vazios do Baplie (só full participam da existência)', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'empty' }]),
      blcs([]),
    )
    expect(items).toEqual([])
  })

  it('não aponta divergência de atributo (IMO/OOG divergentes mas mesmo container)', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_oog: true }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }]),
    )
    expect(items).toEqual([])
  })
})

describe('computeBapliePhysicalUpdates (Baplie soberano)', () => {
  it('sobrescreve OOG do B/L com o do Baplie', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_oog: true, is_imo: false }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false, is_imo: false }]),
    )
    expect(updates).toEqual([
      { bl_container_id: 10, is_imo: false, imo_class: null, un_number: null, is_oog: true },
    ])
  })

  it('sobrescreve IMO/classe/ONU do B/L com os do Baplie', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '3', un_number: '1203' }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, imo_class: null, un_number: null }]),
    )
    expect(updates).toEqual([
      { bl_container_id: 10, is_imo: true, imo_class: '3', un_number: '1203', is_oog: false },
    ])
  })

  it('não gera update quando as flags já batem', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '9', un_number: '3166' }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: true, imo_class: '9', un_number: '3166', is_oog: false }]),
    )
    expect(updates).toEqual([])
  })

  it('zera classe/ONU quando o Baplie não é IMO', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: false, imo_class: null, un_number: null }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: true, imo_class: '3', un_number: '1203' }]),
    )
    expect(updates).toEqual([
      { bl_container_id: 10, is_imo: false, imo_class: null, un_number: null, is_oog: false },
    ])
  })

  it('não atualiza container Part Lot (mais de um B/L com o mesmo número)', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '3', un_number: '1203' }]),
      blcs([
        { id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false },
        { id: 11, bl_id: 'BL2', container_number: 'ABCD1234567', is_imo: false },
      ]),
    )
    expect(updates).toEqual([])
  })
})

describe('reconcileBaplieWithManifest', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('não gera divergência de atributo — mesmo container com IMO/OOG divergentes retorna vazio', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: null, is_oog: true }],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }],
    })
    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [] })
  })

  it('gera divergência de existência quando o container do Baplie não está em nenhum B/L', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: '01', is_oog: false }],
      containers: [],
    })
    const result = await reconcileBaplieWithManifest(1)
    expect(result.items).toEqual([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567', baplie_bl_ref: 'BL1', slot: '01' },
    ])
  })

  it('deduplica containers repetidos no staging antes de reconciliar', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [
        { container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: '01', is_oog: false },
        { container_number: 'ABCD 1234567', status: 'full', bl_ref: 'BL1', slot: '02', is_oog: false },
      ],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }],
    })
    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [] })
  })
})
