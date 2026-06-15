// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../../services/portalBilling'

const localInvoices: PortalInvoiceSummary[] = [
  {
    id: 1,
    invoice_number: 'INV-001',
    issued_at: '2026-06-01',
    due_date: '2026-06-20',
    total_brl: 100,
    total_paid_brl: 0,
    balance_brl: 100,
    status: 'issued',
    invoice_type: 'individual',
    vessels: ['NAVIO A'],
    voyages: ['001W'],
    vessel_voyages: ['NAVIO A / 001W'],
    bls: ['BL-EXPORTADO'],
    pods: ['BRVIX'],
  },
  {
    id: 2,
    invoice_number: 'INV-002',
    issued_at: '2026-06-02',
    due_date: '2026-06-21',
    total_brl: 200,
    total_paid_brl: 0,
    balance_brl: 200,
    status: 'issued',
    invoice_type: 'individual',
    vessels: ['NAVIO B'],
    voyages: ['002W'],
    vessel_voyages: ['NAVIO B / 002W'],
    bls: ['BL-OCULTO'],
    pods: ['BRSSZ'],
  },
]

const demurrageInvoices: PortalDemurrageInvoice[] = [
  {
    id: 10,
    doc_number: 'DEM-001',
    doc_date: '2026-06-03',
    due_date: '2026-06-30',
    billed_at: '2026-06-03',
    paid_at: null,
    total_usd: 50,
    frozen_roe: 5,
    frozen_total_brl: 250,
    status: 'issued',
    pix_payload: null,
    dispute_open: false,
    discount_type: null,
    discount_value: null,
    discount_mode: null,
    bl_id: 'BL-DEM',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_number: '003W',
    vessel_name: 'NAVIO C',
  },
]

const downloadCsv = vi.fn()

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../components/portal/PortalConsolidatedModal', () => ({
  PortalConsolidatedModal: () => null,
}))

vi.mock('../../components/portal/DisputeModal', () => ({
  DisputeModal: () => null,
}))

vi.mock('../../components/billing/InvoiceDocumentLocal', () => ({
  InvoiceDocumentLocal: () => null,
}))

vi.mock('../../hooks/usePortalAuth', () => ({
  usePortalAuth: () => ({
    overview: { pending_balance: 300, customer_name: 'Cliente Teste' },
    refreshOverview: vi.fn(),
  }),
}))

vi.mock('../../hooks/usePortalBilling', () => ({
  usePortalConsolidatableReceivables: () => ({ data: [] }),
  usePortalInvoices: () => ({ data: localInvoices, isLoading: false, error: null }),
  usePortalDemurrageInvoices: () => ({ data: demurrageInvoices, isLoading: false }),
  usePortalInvoiceDetail: () => ({ data: null, isLoading: false, error: null }),
  usePortalDemurrageInvoiceDetail: () => ({ data: null, isLoading: false, error: null }),
  usePortalObsoleteConsolidation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('../../lib/csv', () => ({
  downloadCsv: (...args: unknown[]) => downloadCsv(...args),
}))

import { PortalBilling } from '../PortalBilling'

afterEach(() => {
  cleanup()
  downloadCsv.mockClear()
})

describe('PortalBilling', () => {
  it('exporta CSV de taxas locais usando apenas as faturas filtradas', async () => {
    const user = userEvent.setup()
    render(<PortalBilling />)

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    await user.type(screen.getByLabelText('B/L'), 'BL-EXPORTADO')
    await user.click(screen.getByRole('button', { name: /Exportar CSV/i }))

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const rows = downloadCsv.mock.calls[0]?.[2] as string[][]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      'INV-001',
      'Individual',
      'BL-EXPORTADO',
      '01/06/2026',
      '20/06/2026',
      expect.stringContaining('100,00'),
      'issued',
    ])
  })

  it('exporta CSV de demurrage quando a aba Demurrage esta ativa', async () => {
    const user = userEvent.setup()
    render(<PortalBilling />)

    await user.click(screen.getByRole('tab', { name: 'Demurrage' }))
    await user.click(screen.getByRole('button', { name: /Exportar CSV/i }))

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    expect(downloadCsv.mock.calls[0]?.[1]).toEqual([
      'Documento',
      'B/L',
      'Navio/Viagem',
      'Emissao',
      'Vencimento',
      'Total USD',
      'Total BRL',
      'Status',
    ])
    const rows = downloadCsv.mock.calls[0]?.[2] as string[][]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      'DEM-001',
      'BL-DEM',
      'NAVIO C / 003W',
      '03/06/2026',
      '30/06/2026',
      '50.00',
      expect.stringContaining('250,00'),
      'issued',
    ])
  })
})
