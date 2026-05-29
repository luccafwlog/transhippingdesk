import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('uses the specified left-filter/right-table layout with a fixed summary footer', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConsolidatedInvoiceModal, { open: true, onClose: vi.fn() }),
    )
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(html).toContain('data-testid="consolidated-invoice-main"')
    expect(html).toContain('data-testid="consolidated-invoice-filters"')
    expect(html).toContain('data-testid="consolidated-invoice-table"')
    expect(html).toContain('data-testid="consolidated-invoice-footer"')
    expect(css).toMatch(/\.invoice-create-modal\s*\{[^}]*display:\s*grid/)
    expect(css).toContain('grid-template-columns: minmax(220px, 280px) minmax(0, 1fr)')
    expect(css).toMatch(/\.invoice-create-modal__footer\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/)
  })
})
