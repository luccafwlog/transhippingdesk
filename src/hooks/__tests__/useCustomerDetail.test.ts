// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useCustomerDetail } from '../useCustomers'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))
vi.mock('../../services/supabase', () => ({ supabase: { from: mockFrom } }))
vi.mock('../../services/customers', () => ({ fetchIssuedInvoiceBalanceByCustomer: vi.fn() }))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function makeInvoicePage(count: number, offset: number, status: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: offset + index,
    invoice_number: `INV-${offset + index}`,
    issued_at: '2026-07-01',
    due_date: '2026-08-01',
    total_brl: 100,
    balance_brl: 100,
    status,
  }))
}

describe('useCustomerDetail — paginacao de invoices', () => {
  it('soma o saldo pendente de todas as paginas, nao so da primeira janela de 500', async () => {
    const firstPage = makeInvoicePage(500, 1, 'issued')
    const secondPage = makeInvoicePage(1, 501, 'issued')

    let invoiceCall = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'customers') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 9, cnpj_cpf: '1', customer_contacts: [], bls: [] }, error: null }) }) }),
        }
      }
      if (table === 'invoices') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                range: () => {
                  invoiceCall += 1
                  return Promise.resolve({ data: invoiceCall === 1 ? firstPage : secondPage, error: null })
                },
              }),
            }),
          }),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const { result } = renderHook(() => useCustomerDetail('12345678000195'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.invoices?.length).toBe(501)
    expect(result.current.data?.pending_balance).toBe(501 * 100)
  })
})
