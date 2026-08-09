// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DemurrageInvoicesTab } from '../DemurrageInvoicesTab'

afterEach(cleanup)

const invoice = {
  id: 1,
  doc_number: 'DEM-001',
  bl_id: 'BL-001',
  status: 'issued',
  billed_at: '2026-08-09T12:00:00Z',
  total_usd: 140,
  current_total_brl: 756,
  discount_value: 0,
  dispute_open: false,
  dispute_status: null,
  customer: { name: 'Cliente Alpha', cnpj_cpf: '123' },
} as never

it('organiza a linha em pilhas de contexto e separa a acao principal das financeiras', () => {
  render(<DemurrageInvoicesTab
    tab="issued"
    tabLabel="Faturas"
    invoices={[invoice]}
    loading={false}
    error={null}
    onOpenDetail={vi.fn()}
    onOpenDiscount={vi.fn()}
    onOpenDispute={vi.fn()}
    onOpenPayment={vi.fn()}
    onOpenDocument={vi.fn()}
    onCancel={vi.fn()}
    onReversePayment={vi.fn()}
  />)

  expect(screen.getByTestId('demurrage-invoice-context')).toBeTruthy()
  expect(screen.getByTestId('demurrage-invoice-financial')).toBeTruthy()
  expect(screen.getByTestId('demurrage-invoice-primary-action')).toBeTruthy()
  expect(screen.getByTestId('demurrage-invoice-secondary-actions')).toBeTruthy()
})
