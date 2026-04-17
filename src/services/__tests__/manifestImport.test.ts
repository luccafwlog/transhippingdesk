import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateManifestImportError, importManifest, RateLimitImportError } from '../manifestImport'
import type { ParsedManifest } from '../manifestParser'

const { mockFrom, mockRpc, syncManifestPolEtdSchedulesMock } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  syncManifestPolEtdSchedulesMock: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

vi.mock('../voyageRouteSchedules', () => ({
  syncManifestPolEtdSchedules: syncManifestPolEtdSchedulesMock,
}))

describe('manifestImport customer reconciliation', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    syncManifestPolEtdSchedulesMock.mockReset()
    syncManifestPolEtdSchedulesMock.mockResolvedValue(undefined)
  })

  it('vincula cliente por nome quando o documento nao bate e marca revisao', async () => {
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
                data: [{ id: 7, cnpj_cpf: '12345678000195', name: 'CLIENTE ALFA LTDA' }],
                error: null,
              }),
            }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

    mockRpc.mockResolvedValue({ data: 101, error: null })

    const manifest: ParsedManifest = {
      bls: [
        {
          id: 'BL001',
          shipper: 'SHIPPER TESTE',
          consignee: 'Cliente Alfa Ltda',
          cargo_description: 'CARGA TESTE',
          cnpj_cpf: '00.000.000/0000-00',
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

    expect(mockRpc).toHaveBeenCalledTimes(2)
    const [rpcName, rpcArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(rpcName).toBe('import_manifest_transactional')

    const blsPayload = rpcArgs.p_bls as Array<Record<string, unknown>>
    expect(blsPayload).toHaveLength(1)
    expect(blsPayload[0]).toMatchObject({
      id: 'BL001',
      customer_id: 7,
      consignee: 'CLIENTE ALFA LTDA',
      review_status: 'pending_review',
    })
    expect(String(blsPayload[0]?.notes ?? '')).toContain('Cliente vinculado por nome; validar CNPJ')

    const containersPayload = rpcArgs.p_containers as Array<Record<string, unknown>>
    expect(containersPayload).toHaveLength(1)

    expect(syncManifestPolEtdSchedulesMock).toHaveBeenCalledOnce()
    expect(mockRpc.mock.calls[1]?.[0]).toBe('run_billing_for_import_batch')
    expect(mockRpc.mock.calls[1]?.[1]).toMatchObject({
      p_batch_id: 101,
      p_actor: 'tester',
      p_recalculate: true,
    })
  })

  it('mapeia unique violation de hash para DuplicateManifestImportError', async () => {
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
                data: [],
                error: null,
              }),
            }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

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
                data: [],
                error: null,
              }),
            }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

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
})
