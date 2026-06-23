import { expect, it } from 'vitest'
import { DEMURRAGE_INVOICE_TABS } from '../demurrageInvoiceTabs'

it('exposes every persisted Demurrage invoice status', () => {
  expect(DEMURRAGE_INVOICE_TABS.map((tab) => tab.status)).toEqual([
    'draft',
    'issued',
    'overdue',
    'paid',
    'cancelled',
  ])
})
