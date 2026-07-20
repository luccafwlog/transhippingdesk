// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  demurrage: { data: undefined as unknown, isLoading: false, isError: false },
  receivables: { data: undefined as unknown, isLoading: false, isError: false },
  payments: { data: undefined as unknown, isLoading: false, isError: false },
  overrides: { data: [] as unknown[], isLoading: false, isError: false },
  manual: { data: [] as unknown[], isLoading: false, isError: false },
}))

vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerDemurrageInvoices: () => mocks.demurrage,
  useCustomerReceivables: () => mocks.receivables,
  useCustomerPayments: () => mocks.payments,
  useCustomerRateOverrides: () => mocks.overrides,
  useCustomerManualChargeBls: () => mocks.manual,
}))

import { FinanceiroTab } from '../FinanceiroTab'

const baseData = { id: 101, name: 'ACME', invoices: [], invoices_access_denied: false } as never

afterEach(() => {
  cleanup()
  mocks.demurrage = { data: undefined, isLoading: false, isError: false }
  mocks.receivables = { data: undefined, isLoading: false, isError: false }
  mocks.payments = { data: undefined, isLoading: false, isError: false }
})

describe('FinanceiroTab — estados de carregamento e erro', () => {
  it('mostra carregando, nao "nenhum recebivel", enquanto a query esta pendente', () => {
    mocks.receivables = { data: undefined, isLoading: true, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    expect(screen.getAllByText('Carregando…').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nenhum recebível.')).toBeNull()
  })

  it('mostra erro explicito, nao "nenhuma invoice de demurrage", quando a query falha', () => {
    mocks.demurrage = { data: undefined, isLoading: false, isError: true }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    expect(screen.getByText('Erro ao carregar dados financeiros.')).toBeTruthy()
    expect(screen.queryByText('Nenhuma invoice de demurrage.')).toBeNull()
  })
})
