import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateManifestImportError, importManifest, RateLimitImportError } from '../manifestImport'
import type { ParsedManifest } from '../manifestParser'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

vi.mock('../voyageRouteSchedules', () => ({
  buildVoyagePolEntityId: (voyageId: number, pol: string | null | undefined) => `${voyageId}::${pol ?? '-'}`,
  buildVoyagePodEntityId: (voyageId: number, pod: string | null | undefined) => `${voyageId}::${pod ?? '-'}`,
}))

function installBaseFromMock(customers: unknown[] = []) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'voyages') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ error: null }),
          }),
        }),
      }
    }

    if (table === 'customers') {
      return {
        select: () => ({
          order: () => ({
            range: async () => ({
              data: customers,
              error: null,
            }),
          }),
        }),
      }
    }

    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

describe('manifestImport customer reconciliation', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('vincula cliente por nome e envia postprocessamento na RPC transacional', async () => {
    installBaseFromMock([{ id: 7, cnpj_cpf: '12345678000195', name: 'CLIENTE ALFA LTDA' }])
    mockRpc.mockResolvedValue({ data: 101, error: null })

    const manifest: ParsedManifest = {
      bls: [
        {
          id: 'BL001',
          shipper: 'SHIPPER TESTE',
          consignee: 'Cliente Alfa Ltda',
          notify_party: null,
          cargo_description: 'CARGA TESTE',
          cnpj_cpf: '00.000.000/0000-00',
          customer_email: 'Financeiro@Cliente.test',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 1000,
          total_cbm: 20,
          review_status: 'ok',
          review_reasons: [],
          containers: [
            {
              container_number: 'CAXU1234567',
              seal_number: 'SEL123',
              type: '40FM',
              gross_weight_kg: 1000,
              cbm: 20,
              is_oog: false,
              is_imo: false,
              imo_class: null,
              un_number: null,
            },
          ],
        },
      ],
      rowErrors: [],
      manifest_etd: '2026-02-19',
    }

    const batchId = await importManifest({
      filename: 'teste.xlsx',
      voyageId: 10,
      manifest,
      uploadedBy: 'tester',
    })

    expect(batchId).toBe(101)
    expect(mockRpc).toHaveBeenCalledTimes(1)

    const [rpcName, rpcArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(rpcName).toBe('import_manifest_with_postprocess_transactional')

    const blsPayload = rpcArgs.p_bls as Array<Record<string, unknown>>
    expect(blsPayload).toHaveLength(1)
    expect(blsPayload[0]).toMatchObject({
      id: 'BL001',
      customer_id: 7,
      consignee: 'CLIENTE ALFA LTDA',
      review_status: 'pending_review',
    })
    expect(String(blsPayload[0]?.notes ?? '')).toContain('Cliente vinculado por nome; validar CNPJ')

    expect(rpcArgs.p_pol_etd).toEqual([{ entity_id: '10::CNTAC', etd: '2026-02-19' }])
    expect(rpcArgs.p_pod_linked).toEqual([{ entity_id: '10::BRVIT' }])
    expect(rpcArgs.p_contact_emails).toEqual([{ customer_id: 7, email: 'financeiro@cliente.test' }])
    expect(rpcArgs.p_containers).toHaveLength(1)
  })

  it('mapeia unique violation de hash para DuplicateManifestImportError', async () => {
    installBaseFromMock()
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_import_batches_voyage_hash"',
      },
    })

    const manifest: ParsedManifest = { bls: [], rowErrors: [], manifest_etd: null }

    await expect(
      importManifest({ filename: 'teste.xlsx', voyageId: 10, manifest, uploadedBy: 'tester', fileHash: 'abc123' }),
    ).rejects.toBeInstanceOf(DuplicateManifestImportError)
  })

  it('mapeia P0429 para RateLimitImportError', async () => {
    installBaseFromMock()
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0429',
        message: 'Limite de importacoes atingido. Aguarde 60 segundos antes de importar novamente.',
      },
    })

    const manifest: ParsedManifest = { bls: [], rowErrors: [], manifest_etd: null }

    await expect(
      importManifest({ filename: 'teste.xlsx', voyageId: 10, manifest, uploadedBy: 'tester' }),
    ).rejects.toBeInstanceOf(RateLimitImportError)
  })

  it('propaga erro da RPC transacional de importacao e pos-processamento', async () => {
    installBaseFromMock()
    mockRpc.mockResolvedValue({ data: null, error: new Error('postprocess failed') })

    const manifest: ParsedManifest = {
      bls: [
        {
          id: 'BL001',
          shipper: 'SHIPPER TESTE',
          consignee: 'Cliente Alfa Ltda',
          notify_party: null,
          cargo_description: 'CARGA TESTE',
          cnpj_cpf: '',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 1000,
          total_cbm: 20,
          review_status: 'ok',
          review_reasons: [],
          containers: [],
        },
      ],
      rowErrors: [],
      manifest_etd: null,
    }

    await expect(
      importManifest({ filename: 'teste.xlsx', voyageId: 10, manifest, uploadedBy: 'tester' }),
    ).rejects.toThrow('postprocess failed')
  })
})
