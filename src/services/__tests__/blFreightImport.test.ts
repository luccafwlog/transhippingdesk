import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBlFreightPayload,
  buildBlFreightPreview,
  confirmBlFreightImport,
  type BlFreightImportPreview,
} from '../blFreightImport'
import type { ParsedBLDocument } from '../blParser'

const { mockRpc, mockTryAutoIssueInvoice } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockTryAutoIssueInvoice: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: vi.fn(),
  },
}))

vi.mock('../reviewBillingAutomation', () => ({
  tryAutoIssueInvoice: mockTryAutoIssueInvoice,
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
    mockTryAutoIssueInvoice.mockReset()
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

  it('parses Brazilian DD/MM/YYYY emission dates instead of aborting the import', () => {
    const doc = parsedBL()
    doc.dates.issueDate = '21/04/2026'
    doc.dates.ladenOnBoard = '20/04/2026'
    // Before the fix this produced "2104-20-26", which the RPC's ::DATE cast rejected.
    expect(buildBlFreightPayload(doc, 7).bl_emission_date).toBe('2026-04-21')

    const invalid = parsedBL()
    invalid.dates.issueDate = '99/99/9999'
    invalid.dates.ladenOnBoard = ''
    // An unparseable cell yields null, never a bad string that blows up the transaction.
    expect(buildBlFreightPayload(invalid, 7).bl_emission_date).toBeNull()
  })

  it('normalizes port city names to UN/LOCODEs, keeping codes untouched', () => {
    const doc = parsedBL()
    doc.route.pol = 'CNSHA'
    doc.route.pod = 'SALVADOR, BRAZIL'
    doc.route.delivery = 'VITORIA,BRAZIL'
    const payload = buildBlFreightPayload(doc, 7)
    expect(payload.pol).toBe('CNSHA')
    expect(payload.pod).toBe('BRSSA')
    expect(payload.place_of_delivery).toBe('BRVIX')
  })

  it('links each B/L to its customer via the consignee document', () => {
    const customer = { id: 42, name: 'IMPORTADOR LTDA' }
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      customerMaps: {
        customersByDocument: new Map([['12345678000195', customer]]),
        customersByName: new Map(),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })
    expect(preview.rows[0].payload?.customer_id).toBe(42)
    expect(preview.rows[0].payload).toMatchObject({
      customer_reconciliation_status: 'matched_document',
      customer_reconciliation_notes: 'Cliente reconciliado automaticamente por CNPJ/CPF.',
      billing_hold_reason: null,
    })
  })

  it('keeps name-only customer matches under manual reconciliation', () => {
    const customer = { id: 43, name: 'IMPORTADOR LTDA' }
    const doc = parsedBL()
    doc.parties.consigneeTaxId = '00999999000100'
    const preview = buildBlFreightPreview({
      documents: [doc],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      customerMaps: {
        customersByDocument: new Map(),
        customersByName: new Map([['importador ltda', customer]]),
        customersByCanonicalName: new Map(),
        canonicalList: [],
      },
    })

    expect(preview.rows[0].payload).toMatchObject({
      customer_id: 43,
      customer_reconciliation_status: 'matched_name',
      customer_reconciliation_notes: 'Cliente sugerido por nome; validar documento.',
      billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
    })
  })

  it('flags container-set changes as override-required without dropping the payload', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'container',
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

    const row = preview.rows[0]
    expect(preview.summary).toMatchObject({ total: 1, blockedCount: 0, billingOverrideCount: 1 })
    expect(row?.status).toBe('updated')
    expect(row?.requiresBillingOverride).toBe(true)
    // container count 0 -> 1 is a billing impact; the row stays importable
    expect(row?.billingImpacts.some((message) => message.includes('Quantidade de containers'))).toBe(true)
    expect(row?.payload).not.toBeNull()
    expect(row?.payload?.billing_impact).toBe(true)
    expect(row?.payload?.override_billing).toBe(false)
    // weight/CBM on a container B/L are freely correctable; containers are the impact
    expect(row?.diffs.find((diff) => diff.field === 'total_weight_kg')?.billingImpact).toBe(false)
    expect(row?.diffs.find((diff) => diff.field === 'total_cbm')?.billingImpact).toBe(false)
    expect(row?.diffs.find((diff) => diff.field === 'containers')?.billingImpact).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'shipper')?.billingImpact).toBe(false)
  })

  it('treats weight as a billing impact only for carga solta cargo', () => {
    const matchingContainer = {
      container_number: 'TCLU1234567',
      seal_number: 'SEAL001',
      type: '40HC',
      tare_weight_kg: 3900,
      gross_weight_kg: 28000,
      cbm: 68.5,
      is_imo: false,
      is_oog: false,
    }
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'carga_solta',
          shipper: 'SHIPPER LTDA\nADDRESS',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 999,
          total_cbm: 68.5,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-20',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [matchingContainer],
          bl_freight_lines: [],
        },
      ],
    })

    const row = preview.rows[0]
    expect(row?.requiresBillingOverride).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'total_weight_kg')?.billingImpact).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'containers')).toBeUndefined()
    expect(row?.billingImpacts.some((message) => message.includes('Peso (carga solta'))).toBe(true)
  })

  it('flags replacing an existing shared container even when the count is unchanged', () => {
    // existing billed BL has one container that is shared with another B/L;
    // the import replaces it with the parsed unique container (same count).
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      billingLockedBlIds: new Set(['CSC45250E02Y00']),
      sharedContainerNumbers: new Set(['SHARED000000']),
      existingBls: [
        {
          id: 'CSC45250E02Y00',
          voyage_id: 7,
          cargo_mode: 'container',
          shipper: 'SHIPPER LTDA\nADDRESS',
          consignee: 'IMPORTADOR LTDA',
          notify_party: 'NOTIFY LTDA',
          pol: 'CNSHA',
          pod: 'BRSSZ',
          place_of_delivery: 'SANTOS',
          total_weight_kg: 28000,
          total_cbm: 68.5,
          payment_type: 'PREPAID',
          bl_emission_date: '2026-02-20',
          manifest_customer_cnpj_cpf: '12345678000195',
          manifest_customer_name: 'IMPORTADOR LTDA',
          bl_containers: [
            { container_number: 'SHARED000000', seal_number: null, type: '40HC', tare_weight_kg: 3900, gross_weight_kg: 28000, cbm: 68.5, is_imo: false, is_oog: false },
          ],
          bl_freight_lines: [],
        },
      ],
    })

    const row = preview.rows[0]
    expect(row?.requiresBillingOverride).toBe(true)
    expect(row?.billingImpacts.some((message) => message.includes('compartilhados'))).toBe(true)
    expect(row?.diffs.find((diff) => diff.field === 'containers')?.billingImpact).toBe(true)
  })

  it('blocks a BL-detail scoped import when the file has another BL number', () => {
    const preview = buildBlFreightPreview({
      documents: [parsedBL()],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      onlyBlId: 'OUTROBL',
    })

    expect(preview.rows[0]?.status).toBe('blocked')
    expect(preview.rows[0]?.blockedReasons[0]).toContain('OUTROBL')
    expect(preview.rows[0]?.payload).toBeNull()
  })

  it('blocks a BL file from a different declared vessel/voyage', () => {
    const document = parsedBL()
    document.route.vessel = 'OTHER VESSEL'
    document.route.voyage = '99W'

    const preview = buildBlFreightPreview({
      documents: [document],
      selectedVoyage: { id: 7, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })

    const row = preview.rows[0]
    expect(row?.status).toBe('blocked')
    expect(row?.voyageId).toBe(7)
    expect(row?.payload).toBeNull()
    expect(row?.blockedReasons[0]).toBe('Arquivo e da viagem OTHER VESSEL / 99W, mas voce apontou GREEN SANTOS / 14.')
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
          billingImpacts: [],
          requiresBillingOverride: false,
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
          billingImpacts: [],
          requiresBillingOverride: false,
          diffs: [],
          payload: null,
        },
      ],
      summary: { total: 2, newCount: 1, updatedCount: 0, unchangedCount: 0, blockedCount: 1, billingOverrideCount: 0 },
    }

    await expect(confirmBlFreightImport(preview, 'user-1')).resolves.toEqual({ bls_received: 1 })
    expect(mockRpc).toHaveBeenCalledWith('import_bl_freight_transactional', {
      p_bls: [preview.rows[0]?.payload],
      p_changed_by: 'user-1',
    })
    expect(mockTryAutoIssueInvoice).not.toHaveBeenCalled()
  })

  it('triggers automatic billing only after document-level customer reconciliation', async () => {
    mockRpc.mockResolvedValue({ data: { bls_received: 2 }, error: null })
    mockTryAutoIssueInvoice.mockResolvedValue({ status: 'blocked', message: 'Sem tabela vigente.' })
    const documentMatched = {
      ...buildBlFreightPayload(parsedBL(), 7),
      id: 'DOCMATCH',
      customer_id: 42,
      customer_reconciliation_status: 'matched_document' as const,
      customer_reconciliation_notes: 'Cliente reconciliado automaticamente por CNPJ/CPF.',
      billing_hold_reason: null,
    }
    const nameMatched = {
      ...buildBlFreightPayload(parsedBL(), 7),
      id: 'NAMEMATCH',
      customer_id: 43,
      customer_reconciliation_status: 'matched_name' as const,
      customer_reconciliation_notes: 'Cliente sugerido por nome; validar documento.',
      billing_hold_reason: 'Aguardando reconciliacao de cliente antes do faturamento.',
    }
    const preview: BlFreightImportPreview = {
      rows: [
        {
          blNumber: 'DOCMATCH',
          status: 'new',
          existing: false,
          voyageId: 7,
          consigneeDocumentMatches: null,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          diffs: [],
          payload: documentMatched,
        },
        {
          blNumber: 'NAMEMATCH',
          status: 'new',
          existing: false,
          voyageId: 7,
          consigneeDocumentMatches: null,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          diffs: [],
          payload: nameMatched,
        },
      ],
      summary: { total: 2, newCount: 2, updatedCount: 0, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 0 },
    }

    await confirmBlFreightImport(preview, 'user-1')
    expect(mockTryAutoIssueInvoice).toHaveBeenCalledTimes(1)
    expect(mockTryAutoIssueInvoice).toHaveBeenCalledWith({ blId: 'DOCMATCH', customerId: 42, actorId: 'user-1' })
  })

  it('applies the operator override flag only to billing-impacting rows', async () => {
    mockRpc.mockResolvedValue({ data: { bls_received: 2 }, error: null })
    const impactPayload = { ...buildBlFreightPayload(parsedBL(), 7), id: 'IMPACT', billing_impact: true, override_billing: false }
    const freePayload = { ...buildBlFreightPayload(parsedBL(), 7), id: 'FREE' }
    const preview: BlFreightImportPreview = {
      rows: [
        {
          blNumber: 'IMPACT',
          status: 'updated',
          existing: true,
          voyageId: 7,
          consigneeDocumentMatches: true,
          blockedReasons: [],
          billingImpacts: ['Quantidade de containers: 1 -> 2'],
          requiresBillingOverride: true,
          diffs: [],
          payload: impactPayload,
        },
        {
          blNumber: 'FREE',
          status: 'updated',
          existing: true,
          voyageId: 7,
          consigneeDocumentMatches: true,
          blockedReasons: [],
          billingImpacts: [],
          requiresBillingOverride: false,
          diffs: [],
          payload: freePayload,
        },
      ],
      summary: { total: 2, newCount: 0, updatedCount: 2, unchangedCount: 0, blockedCount: 0, billingOverrideCount: 1 },
    }

    await confirmBlFreightImport(preview, 'user-1', true)
    const sent = mockRpc.mock.calls[0]?.[1]?.p_bls as Array<{ id: string; override_billing: boolean }>
    expect(sent.find((bl) => bl.id === 'IMPACT')?.override_billing).toBe(true)
    expect(sent.find((bl) => bl.id === 'FREE')?.override_billing).toBe(true)

    mockRpc.mockClear()
    await confirmBlFreightImport(preview, 'user-1', false)
    const sentNoOverride = mockRpc.mock.calls[0]?.[1]?.p_bls as Array<{ id: string; override_billing: boolean }>
    // impacting row stays un-applied; the free row still applies
    expect(sentNoOverride.find((bl) => bl.id === 'IMPACT')?.override_billing).toBe(false)
    expect(sentNoOverride.find((bl) => bl.id === 'FREE')?.override_billing).toBe(true)
  })
})
