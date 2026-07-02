import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  keepManifestAttribute,
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

function installReconcileMocks(input: {
  bls?: unknown[]
  baplie?: unknown[]
  containers?: unknown[]
  resolutions?: unknown[]
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bls') return createBuilder({ data: input.bls ?? [], error: null })
    if (table === 'baplie_containers') return createBuilder({ data: input.baplie ?? [], error: null })
    if (table === 'bl_containers') return createBuilder({ data: input.containers ?? [], error: null })
    if (table === 'baplie_reconciliation_resolutions') {
      return createBuilder({ data: input.resolutions ?? [], error: null })
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

describe('reconcileBaplieWithManifest', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('nao gera divergencia para OOG', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [
        {
          container_number: 'ABCD1234567',
          status: 'full',
          bl_ref: 'BL1',
          slot: null,
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: true,
        },
      ],
      containers: [
        {
          id: 10,
          bl_id: 'BL1',
          container_number: 'ABCD1234567',
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
    })

    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [] })
  })

  it('ignora divergencia IMO ja resolvida mantendo manifesto para a combinacao exata de valores', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [
        {
          container_number: 'ABCD1234567',
          status: 'full',
          bl_ref: 'BL1',
          slot: null,
          is_imo: true,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
      containers: [
        {
          id: 10,
          bl_id: 'BL1',
          container_number: 'ABCD1234567',
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
      resolutions: [
        {
          bl_container_id: 10,
          field_name: 'is_imo',
          baplie_value: 'true',
          manifest_value: 'false',
        },
      ],
    })

    const result = await reconcileBaplieWithManifest(1)

    expect(result.items).toEqual([])
  })

  it('usa a mesma normalizacao de container do manifesto e do Baplie', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [
        {
          container_number: 'ABCD 1234567',
          status: 'full',
          bl_ref: 'BL1',
          slot: null,
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
      containers: [
        {
          id: 10,
          bl_id: 'BL1',
          container_number: 'ABCD1234567',
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
    })

    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [] })
  })

  it('nao gera divergencia automatica para container Part Lot em mais de um B/L', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }, { id: 'BL2' }],
      baplie: [
        {
          container_number: 'ABCD1234567',
          status: 'full',
          bl_ref: 'BL1',
          slot: null,
          is_imo: true,
          imo_class: '3',
          un_number: '1203',
          is_oog: false,
        },
      ],
      containers: [
        {
          id: 10,
          bl_id: 'BL1',
          container_number: 'ABCD1234567',
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
        {
          id: 11,
          bl_id: 'BL2',
          container_number: 'ABCD1234567',
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
    })

    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [] })
  })

  it('deduplica containers repetidos no staging Baplie antes de reconciliar', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [
        {
          container_number: 'ABCD1234567',
          status: 'full',
          bl_ref: 'BL1',
          slot: '010101',
          is_imo: true,
          imo_class: '9',
          un_number: '3166',
          is_oog: false,
        },
        {
          container_number: 'ABCD 1234567',
          status: 'full',
          bl_ref: 'BL1',
          slot: '010102',
          is_imo: true,
          imo_class: '9',
          un_number: '3166',
          is_oog: false,
        },
      ],
      containers: [
        {
          id: 10,
          bl_id: 'BL1',
          container_number: 'ABCD1234567',
          is_imo: false,
          imo_class: null,
          un_number: null,
          is_oog: false,
        },
      ],
    })

    const result = await reconcileBaplieWithManifest(1)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      kind: 'attribute_divergence',
      container_number: 'ABCD1234567',
      divergences: [
        { field: 'is_imo' },
        { field: 'imo_class' },
        { field: 'un_number' },
      ],
    })
  })
})

describe('keepManifestAttribute', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('grava resolucao duravel e auditoria sem atualizar o container', async () => {
    const resolutionBuilder = createBuilder({ data: null, error: null })
    const auditBuilder = createBuilder({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'baplie_reconciliation_resolutions') return resolutionBuilder
      if (table === 'audit_logs') return auditBuilder
      if (table === 'bl_containers') throw new Error('bl_containers nao deve ser atualizado')
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    await keepManifestAttribute({
      voyageId: 1,
      blContainerId: 10,
      field: 'imo_class',
      baplieValue: '3',
      manifestValue: null,
      actorId: 'user-1',
    })

    expect(resolutionBuilder.upsert).toHaveBeenCalledWith(
      {
        voyage_id: 1,
        bl_container_id: 10,
        field_name: 'imo_class',
        baplie_value: '"3"',
        manifest_value: 'null',
        resolution: 'manifest',
        resolved_by: 'user-1',
      },
      { onConflict: 'voyage_id,bl_container_id,field_name,baplie_value,manifest_value,resolution' },
    )
    expect(auditBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'bl_container',
        entity_id: '10',
        field_name: 'imo_class',
        old_value: '"3"',
        new_value: 'null',
        changed_by: 'user-1',
      }),
    )
  })
})
