import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBlFreightPayload,
  buildBlFreightPreview,
  confirmBlFreightImport,
  type BlFreightImportPreview,
} from '../blFreightImport'
import type { ParsedBLDocument } from '../blParser'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: vi.fn(),
  },
}))

function parsedBL(): ParsedBLDocument {
  return {
    blNumber: 'CSC45250E02Y00',
    parties: {
      shipperBlock: 'SHIPPER LTDA\nADDRESS',
      consigneeBlock: 'IMPORTADOR LTDA\nCNPJ: 12.345.678/0001-95',
      consigneeTaxId: '12345678000195',
      notifyBlock: 'NOTIFY LTDA',
      alsoNotifyBlock: '',
    },
    route: {
      receipt: 'SHANGHAI',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      delivery: 'SANTOS',
      vessel: 'GREEN SANTOS',
      voyage: '14',
      movementFrom: 'CY',
      movementTo: 'CY',
    },
    dates: {
      ladenOnBoard: '2026-02-19',
      issueDate: '2026-02-20',
      issuePlace: 'SHANGHAI',
    },
    containers: [
      {
        containerNumber: 'TCLU1234567',
        sealNumber: 'SEAL001',
        tareKg: 3900,
        ownership: 'COC',
        packages: '1 PKG',
        type: '40HC',
        grossWeightKg: 28000,
        cbm: 68.5,
      },
    ],
    vehicles: [{ chassis: '9BWZZZ377VT004251', containerNumber: 'TCLU1234567', blNumber: 'CSC45250E02Y00' }],
    freightCharges: [
      { description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 2600, per: 'BL', currency: 'USD', amount: 2600, payment: 'PREPAID' },
      { description: 'THD', rateCurrency: 'BRL', rateAmount: 1717, per: 'CNTR', currency: 'BRL', amount: 1717, payment: 'COLLECT' },
      { description: 'BAF', rateCurrency: 'USD', rateAmount: 172, per: 'CNTR', currency: 'USD', amount: 172, payment: 'PREPAID' },
    ],
  }
}

describe('blFreightImport', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('builds the transactional RPC payload from a parsed COSCO BL', () => {
    const payload = buildBlFreightPayload(parsedBL(), 7)

    expect(payload).toMatchObject({
      id: 'CSC45250E02Y00',
      voyage_id: 7,
      shipper: 'SHIPPER LTDA\nADDRESS',
      consignee: 'IMPORTADOR LTDA',
      manifest_customer_cnpj_cpf: '12345678000195',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      place_of_delivery: 'SANTOS',
      total_weight_kg: 28000,
      total_cbm: 68.5,
      payment_type: 'PREPAID',
      bl_emission_date: '2026-02-20',
    })
    expect(payload.freight_lines).toEqual([
      { seq: 1, description: 'OCEAN FREIGHT', category: 'OCEAN_FREIGHT', mercante_code: null, currency: 'USD', amount: 2600, payment: 'PREPAID' },
      { seq: 2, description: 'THD', category: 'THD', mercante_code: null, currency: 'BRL', amount: 1717, payment: 'COLLECT' },
      { seq: 3, description: 'BAF', category: 'BAF', mercante_code: null, currency: 'USD', amount: 172, payment: 'PREPAID' },
    ])
    expect(payload.containers[0]).toMatchObject({ container_number: 'TCLU1234567', type: '40HC' })
    expect(payload.vehicles[0]).toMatchObject({ chassis: '9BWZZZ377VT004251', container_number: 'TCLU1234567' })
  })

  it('computes field diffs and blocks physical changes when billing exists', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      voyageIdByBl: new Map([['CSC45250E02Y00', 7]]),
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          shipper: 'OLD SHIPPER',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 1000,
          total_cbm: 10,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-19',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [],
          bl_freight_lines: [],
        },
      ],
    })

    expect(preview.summary).toMatchObject({ total: 1, blockedCount: 1 })
    expect(preview.rows[0]?.status).toBe('blocked')
    expect(preview.rows[0]?.blockedReasons.join(' ')).toContain('Peso ou composicao fisica')
    expect(preview.rows[0]?.diffs.find((diff) => diff.field === 'shipper')?.blocked).toBe(false)
    expect(preview.rows[0]?.diffs.find((diff) => diff.field === 'total_weight_kg')?.blocked).toBe(true)
  })

  it('blocks a BL-detail scoped import when the file has another BL number', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      voyageIdByBl: new Map([['CSC45250E02Y00', 7]]),
      onlyBlId: 'OUTROBL',
    })

    expect(preview.rows[0]?.status).toBe('blocked')
    expect(preview.rows[0]?.blockedReasons[0]).toContain('OUTROBL')
    expect(preview.rows[0]?.payload).toBeNull()
  })

  it('calls the transactional RPC only with unblocked payloads', async () => {
    mockRpc.mockResolvedValue({ data: { bls_received: 1 }, error: null })
    const preview: BlFreightImportPreview = {
      rows: [
        {
          blNumber: 'CSC45250E02Y00',
          status: 'new',
          existing: false,
          voyageId: 7,
          consigneeDocumentMatches: null,
          blockedReasons: [],
          diffs: [],
          payload: buildBlFreightPayload(parsedBL(), 7),
        },
        {
          blNumber: 'BLOCKED',
          status: 'blocked',
          existing: true,
          voyageId: 7,
          consigneeDocumentMatches: null,
          blockedReasons: ['bloqueado'],
          diffs: [],
          payload: null,
        },
      ],
      summary: { total: 2, newCount: 1, updatedCount: 0, unchangedCount: 0, blockedCount: 1 },
    }

    await expect(confirmBlFreightImport(preview, 'user-1')).resolves.toEqual({ bls_received: 1 })
    expect(mockRpc).toHaveBeenCalledWith('import_bl_freight_transactional', {
      p_bls: [preview.rows[0]?.payload],
      p_changed_by: 'user-1',
    })
  })
})
