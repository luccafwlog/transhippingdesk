// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  portal: { data: undefined as unknown, isLoading: false, isError: false },
  demurrage: { data: { rows: [], denied: false }, isLoading: false, isError: false },
  pendingReconciliation: { data: [] as unknown[], isLoading: false, isError: false },
  runningDemurrage: { data: [] as unknown[], isLoading: false, isError: false },
  timeline: { data: [] as unknown[], isLoading: false, isError: false },
}))

vi.mock('../../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioningForCustomer: () => mocks.portal,
}))
vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerDemurrageInvoices: () => mocks.demurrage,
  useCustomerPendingReconciliation: () => mocks.pendingReconciliation,
  useCustomerRunningDemurrage: () => mocks.runningDemurrage,
  useCustomerTimeline: () => mocks.timeline,
}))

import { VisaoGeralTab } from '../VisaoGeralTab'

const baseData = { id: 101, cnpj_cpf: '12345678000195', city: null, state: null, customer_contacts: [], bls: [], invoices: [], invoices_access_denied: false } as never

afterEach(() => {
  cleanup()
  mocks.portal = { data: undefined, isLoading: false, isError: false }
  mocks.demurrage = { data: { rows: [], denied: false }, isLoading: false, isError: false }
  mocks.pendingReconciliation = { data: [], isLoading: false, isError: false }
  mocks.runningDemurrage = { data: [], isLoading: false, isError: false }
  mocks.timeline = { data: [], isLoading: false, isError: false }
})

function renderTab() {
  render(<MemoryRouter><VisaoGeralTab data={baseData} onNavigateTab={() => {}} /></MemoryRouter>)
}

describe('VisaoGeralTab — pendencias', () => {
  it('mostra estado de carregamento explicito, nao "nenhuma pendencia", enquanto as fontes ainda buscam', () => {
    mocks.pendingReconciliation = { data: [], isLoading: true, isError: false }
    renderTab()
    expect(screen.getByText('Verificando pendências…')).toBeTruthy()
    expect(screen.queryByText('Nenhuma pendência aberta.')).toBeNull()
  })

  it('mostra erro explicito, nao "nenhuma pendencia", quando uma fonte falha', () => {
    mocks.runningDemurrage = { data: [], isLoading: false, isError: true }
    renderTab()
    expect(screen.getByText('Erro ao carregar pendências.')).toBeTruthy()
    expect(screen.queryByText('Nenhuma pendência aberta.')).toBeNull()
  })

  it('nao trata excecao aprovada do Portal (provisionamento_nao_necessario) como pendencia', () => {
    mocks.portal = {
      data: { account_situation: 'suspenso', provisioning_decision: 'provisionamento_nao_necessario' },
      isLoading: false,
      isError: false,
    }
    renderTab()
    expect(screen.getByText('Nenhuma pendência aberta.')).toBeTruthy()
  })

  it('mantem pendencia de Portal para situacoes realmente pendentes', () => {
    mocks.portal = {
      data: { account_situation: 'convite_pendente', provisioning_decision: 'aprovado_para_provisionar' },
      isLoading: false,
      isError: false,
    }
    renderTab()
    expect(screen.getByText(/Portal não ativo/)).toBeTruthy()
  })
})
