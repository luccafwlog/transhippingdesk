import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCustomerDependencies, deleteCustomers } from '../customers'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))

beforeEach(() => {
  mockFrom.mockReset()
})

function selectInResult(result: { data: unknown[]; error: unknown }) {
  return { select: () => ({ in: () => Promise.resolve(result) }) }
}

const CHECK_TABLES = ['bls', 'invoices', 'demurrage_invoices', 'bl_receivables', 'billing_batches']

describe('checkCustomerDependencies', () => {
  it('bloqueia cliente com B/L vinculado e libera o restante', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') return selectInResult({ data: [{ customer_id: 10 }], error: null })
      if (CHECK_TABLES.includes(table)) return selectInResult({ data: [], error: null })
      throw new Error(`tabela nao mockada: ${table}`)
    })

    const report = await checkCustomerDependencies([10, 20])
    expect(report.deletableIds).toEqual([20])
    expect(report.blockedIds[0].id).toBe(10)
    expect(report.blockedIds[0].reasons[0]).toMatch(/B\/L/)
  })

  it('bloqueia cliente com fatura', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'invoices') return selectInResult({ data: [{ customer_id: 7 }], error: null })
      if (CHECK_TABLES.includes(table)) return selectInResult({ data: [], error: null })
      throw new Error(`tabela nao mockada: ${table}`)
    })

    const report = await checkCustomerDependencies([7])
    expect(report.deletableIds).toEqual([])
    expect(report.blockedIds[0].reasons[0]).toMatch(/fatura/)
  })
})

describe('deleteCustomers', () => {
  it('apaga contatos e overrides antes do cliente', async () => {
    const order: string[] = []
    const make = (name: string) => vi.fn(() => { order.push(name); return Promise.resolve({ error: null }) })
    const contactsIn = make('customer_contacts')
    const overridesIn = make('customer_rate_overrides')
    const customersIn = make('customers')
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customer_contacts') return { delete: () => ({ in: contactsIn }) }
      if (table === 'customer_rate_overrides') return { delete: () => ({ in: overridesIn }) }
      if (table === 'customers') return { delete: () => ({ in: customersIn }) }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await deleteCustomers([10])

    expect(order).toEqual(['customer_contacts', 'customer_rate_overrides', 'customers'])
    expect(customersIn).toHaveBeenCalledWith('id', [10])
  })

  it('propaga erro do banco', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customer_contacts') return { delete: () => ({ in: () => Promise.resolve({ error: new Error('db down') }) }) }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await expect(deleteCustomers([1])).rejects.toThrow('db down')
  })
})
