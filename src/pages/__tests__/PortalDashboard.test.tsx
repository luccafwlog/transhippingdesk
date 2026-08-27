// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../../services/portalBilling'
import type { PortalOperationBL } from '../../services/portalOperation'

const localInvoices: PortalInvoiceSummary[] = [
  { id: 1, invoice_number: 'INV-1', issued_at: '2026-06-01', total_brl: 100, total_paid_brl: 0, balance_brl: 100, status: 'issued', invoice_type: 'individual', vessels: [], voyages: [], vessel_voyages: [], bls: ['BL1'], pods: [] },
  { id: 2, invoice_number: 'INV-2', issued_at: '2026-06-02', total_brl: 50, total_paid_brl: 50, balance_brl: 0, status: 'paid', invoice_type: 'individual', vessels: [], voyages: [], vessel_voyages: [], bls: ['BL2'], pods: [] },
]

const demurrageInvoices: PortalDemurrageInvoice[] = [
  { id: 10, doc_number: 'DEM-1', doc_date: '2026-06-03', due_date: '2026-06-30', billed_at: '2026-06-03', paid_at: null, total_usd: 50, current_roe: 5, current_total_brl: 250, roe_source: 'bcb_live', updated_at: '2026-06-03T12:00:00Z', status: 'issued', pix_payload: null, dispute_open: false, discount_type: null, discount_value: null, discount_mode: null, bl_id: 'BL1', pol: null, pod: null, voyage_number: null, vessel_name: null },
]

const operationBls: PortalOperationBL[] = [
  {
    bl_id: 'BL1', ce_mercante: null, pol: null, pod: null, voyage_id: null, voyage_number: null, vessel_name: null,
    container_count: 3, containers_in_demurrage: 1, containers_returned: 1,
    containers: [
      { id: 1, container_number: 'C1', type: null, discharge_date: null, return_date: '2026-06-10', usage_days: null, free_time_days: null, demurrage_days: 0, status: 'devolvido' },
      { id: 2, container_number: 'C2', type: null, discharge_date: null, return_date: null, usage_days: null, free_time_days: null, demurrage_days: 0, status: 'dentro_free_time' },
      { id: 3, container_number: 'C3', type: null, discharge_date: null, return_date: null, usage_days: null, free_time_days: null, demurrage_days: 5, status: 'em_demurrage' },
    ],
  },
]

const hookState = vi.hoisted(() => ({
  localError: null as Error | null,
  demurrageError: null as Error | null,
  operationError: null as Error | null,
}))

vi.mock('../../hooks/usePortalBilling', () => ({
  usePortalInvoices: () => ({ data: hookState.localError ? undefined : localInvoices, isLoading: false, error: hookState.localError }),
  usePortalDemurrageInvoices: () => ({ data: hookState.demurrageError ? undefined : demurrageInvoices, isLoading: false, error: hookState.demurrageError }),
}))

vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: hookState.operationError ? undefined : operationBls, isLoading: false, error: hookState.operationError }),
}))

vi.mock('../../hooks/usePortalScheduleVoyages', () => ({
  usePortalScheduleVoyages: () => ({ data: [], isLoading: false }),
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }
})

import { PortalDashboard } from '../PortalDashboard'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderPainel() {
  return render(
    <MemoryRouter initialEntries={['/portal']}>
      <Routes>
        <Route path="/portal" element={<PortalDashboard />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('PortalDashboard (Painel)', () => {
  afterEach(() => {
    hookState.localError = null
    hookState.demurrageError = null
    hookState.operationError = null
  })

  it('mostra somente os quatro cards com valores derivados', () => {
    renderPainel()
    expect(screen.getByRole('heading', { name: 'Painel' })).toBeTruthy()

    // Taxas locais em aberto: somente INV-1 (issued) -> saldo 100, 1 fatura
    expect(screen.getByText('Taxas locais em aberto')).toBeTruthy()
    // Local e demurrage: cada um com 1 fatura em aberto
    expect(screen.getAllByText('1 fatura(s) em aberto')).toHaveLength(2)

    // Demurrage em aberto: 1 fatura
    expect(screen.getByText('Demurrage em aberto')).toBeTruthy()

    // Containers sem devolução: C2 e C3 -> 2
    expect(screen.getByText('Containers sem devolução')).toBeTruthy()
    // Containers em demurrage: C3 -> 1
    expect(screen.getByText('Containers em demurrage')).toBeTruthy()

    // Apenas quatro cards (quatro botoes)
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('navega para Containers filtrado ao clicar no card de demurrage', async () => {
    const user = userEvent.setup()
    renderPainel()
    await user.click(screen.getByText('Containers em demurrage'))
    expect(screen.getByTestId('location').textContent).toBe('/portal/operacao?tab=containers&devolucao=em_demurrage')
  })

  it('mostra falha honesta em vez de R$ 0,00 quando indicadores financeiros falham', () => {
    hookState.localError = new Error('rpc indisponivel')

    renderPainel()

    expect(screen.getByText('Falha ao carregar indicadores financeiros. Tente novamente em instantes.')).toBeTruthy()
    expect(screen.queryByText('R$ 0,00')).toBeNull()
  })
})
