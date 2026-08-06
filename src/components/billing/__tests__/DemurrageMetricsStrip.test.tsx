// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DemurrageMetricsStrip } from '../DemurrageMetricsStrip'

afterEach(cleanup)

vi.mock('../../../services/demurrage/demurrageInvoices', () => ({
  listDemurrageInvoices: vi.fn(() =>
    Promise.resolve([
      { id: 1, status: 'issued', current_total_brl: 100, total_usd: 20 },
      { id: 2, status: 'paid', current_total_brl: 50, total_usd: 10 },
      { id: 3, status: 'overdue', current_total_brl: 30, total_usd: 5 },
    ]),
  ),
}))

// Etapa 12 do plano de faturamento: a faixa de métricas substitui a aba
// Demurrage duplicada — só as quatro métricas agregadas e um link real para
// /demurrage, onde a gestão de fato acontece.
describe('DemurrageMetricsStrip', () => {
  it('agrega as quatro métricas e linka para /demurrage', async () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DemurrageMetricsStrip />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('3')).toBeTruthy() // faturas demurrage
    expect(screen.getByText('2')).toBeTruthy() // em aberto (issued + overdue)
    expect(screen.getByText('R$ 130,00')).toBeTruthy() // 100 + 30
    expect(screen.getByText('US$ 35,00')).toBeTruthy() // 20 + 10 + 5
    expect(screen.getByRole('link', { name: /demurrage/i }).getAttribute('href')).toBe('/demurrage')
  })
})
