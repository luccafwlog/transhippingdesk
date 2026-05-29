import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConsolidatedInvoiceModal } from '../ConsolidatedInvoiceModal'

vi.mock('../../../hooks/useBilling', () => ({
  useBillingCustomers: () => ({ data: [] }),
}))

vi.mock('../../../hooks/useBillingLedger', () => ({
  useConsolidatableReceivables: () => ({ data: [], isLoading: false }),
  useCreateConsolidatedInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('../../ui/Toast')>('../../ui/Toast')
  return {
    ...actual,
    useToast: () => ({ showToast: vi.fn() }),
  }
})

describe('ConsolidatedInvoiceModal', () => {
  it('renders the optional voyage filter', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConsolidatedInvoiceModal, { open: true, onClose: vi.fn() }),
    )

    expect(html).toContain('Viagem')
    expect(html).toContain('Todas as viagens')
  })
})
