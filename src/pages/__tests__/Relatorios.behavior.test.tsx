// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'report-operational') {
      return {
        data: {
          kpis: { totalBls: 5, totalContainers: 8, totalVoyages: 2, totalWeightKg: 1000, totalCbm: 50, truncated: false },
          rows: [{
            id: 'BL-OP-1', voyage: { vessel: { name: 'NAV' }, voyage_number: 'V9' }, pol: 'BRSSZ', pod: 'BRVIT',
            customer: { name: 'Cliente Op' }, bl_containers: [], total_weight_kg: 1000, total_cbm: 50,
            review_status: 'reviewed', financial_status: 'pending',
          }],
        },
        isLoading: false,
        error: null,
      }
    }
    if (queryKey[0] === 'demurrage-report') {
      return {
        data: [{
          id: 'd1', doc_number: 'DEM-1', bl_id: 'BL-9', status: 'issued', total_usd: 100,
          frozen_total_brl: 500, billed_at: null, due_date: null, customer: { name: 'Cliente Dem' },
        }],
        isLoading: false,
        error: null,
      }
    }
    return { data: undefined, isLoading: false, error: null }
  },
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))

import { Relatorios } from '../Relatorios'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('US-139: consulta operacional exibe KPIs e linhas do relatorio', () => {
  render(<Relatorios />)

  expect(screen.getByText('B/Ls')).toBeTruthy()
  expect(screen.getByText('Containers distintos')).toBeTruthy()
  expect(screen.getByText('BL-OP-1')).toBeTruthy()
  expect(screen.getByText('Cliente Op')).toBeTruthy()
})

it('US-142: consulta demurrage lista as invoices do periodo', () => {
  render(<Relatorios />)

  fireEvent.click(screen.getByRole('tab', { name: 'Demurrage' }))

  expect(screen.getByText('DEM-1')).toBeTruthy()
  expect(screen.getByText('BL-9')).toBeTruthy()
  expect(screen.getByText('Cliente Dem')).toBeTruthy()
  expect(screen.getAllByText('Total USD').length).toBeGreaterThan(0)
})
