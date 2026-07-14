import { describe, expect, it } from 'vitest'
import { sumIssuedInvoiceBalancesByCustomer } from '../customers'

describe('sumIssuedInvoiceBalancesByCustomer', () => {
  it('soma apenas invoices issued por cliente', () => {
    const result = sumIssuedInvoiceBalancesByCustomer([
      { customer_id: 10, status: 'issued', balance_brl: 120 },
      { customer_id: 10, status: 'partially_paid', balance_brl: 40 },
      { customer_id: 10, status: 'paid', balance_brl: 0 },
      { customer_id: 20, status: 'issued', balance_brl: 75 },
      { customer_id: null, status: 'issued', balance_brl: 99 },
    ])

    expect(result.get(10)).toBe(120)
    expect(result.get(20)).toBe(75)
    expect(result.has(0)).toBe(false)
  })
})
