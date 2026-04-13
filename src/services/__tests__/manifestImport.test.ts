import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importManifest } from '../manifestImport'
import type { ParsedManifest } from '../manifestParser'

const { mockFrom, syncManifestPolEtdSchedulesMock } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  syncManifestPolEtdSchedulesMock: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

vi.mock('../voyageRouteSchedules', () => ({
  syncManifestPolEtdSchedules: syncManifestPolEtdSchedulesMock,
}))

describe('manifestImport customer reconciliation', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    syncManifestPolEtdSchedulesMock.mockReset()
    syncManifestPolEtdSchedulesMock.mockResolvedValue(undefined)
  })

  it('vincula cliente por nome quando o documento nao bate e marca revisao', async () => {
    const insertedBls: Array<Record<string, unknown>> = []
    const insertedContainers: Array<Record<string, unknown>> = []

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

      if (table === 'import_batches') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: 101 },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
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

      if (table === 'bls') {
        return {
          upsert: async (rows: Array<Record<string, unknown>>) => {
            insertedBls.push(...rows)
            return { error: null }
          },
        }
      }

      if (table === 'bl_containers') {
        return {
          delete: () => ({
            in: async () => ({ error: null }),
          }),
          insert: async (rows: Array<Record<string, unknown>>) => {
            insertedContainers.push(...rows)
            return { error: null }
          },
        }
      }

      if (table === 'import_errors') {
        return {
          insert: async () => ({ error: null }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

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
    expect(insertedBls).toHaveLength(1)
    expect(insertedBls[0]).toMatchObject({
      id: 'BL001',
      customer_id: 7,
      consignee: 'CLIENTE ALFA LTDA',
      review_status: 'pending_review',
    })
    expect(String(insertedBls[0]?.notes ?? '')).toContain('Cliente vinculado por nome; validar CNPJ')
    expect(insertedContainers).toHaveLength(1)
    expect(syncManifestPolEtdSchedulesMock).toHaveBeenCalledOnce()
  })
})
