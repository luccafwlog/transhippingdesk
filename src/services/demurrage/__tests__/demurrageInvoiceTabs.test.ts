import { expect, it } from 'vitest'
import { DEMURRAGE_INVOICE_TABS } from '../demurrageInvoiceTabs'

it('exposes the active Demurrage invoice statuses (sem draft/overdue sob recálculo diário)', () => {
  expect(DEMURRAGE_INVOICE_TABS.map((tab) => tab.status)).toEqual([
    'issued',
    'paid',
    'cancelled',
  ])
})
