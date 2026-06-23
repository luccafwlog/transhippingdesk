// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const open = { id: 1, status: 'open', type: 'demurrage', message: 'Container vencendo', entity_type: 'container', entity_id: 'CNTR1', created_at: '2026-06-20T00:00:00Z' }
const ack = { id: 2, status: 'acknowledged', type: 'invoice_overdue', message: 'Fatura vencida 123', entity_type: 'invoice', entity_id: '123', created_at: '2026-06-19T00:00:00Z' }

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const filter = queryKey[1] as string
    const data = filter === 'open' ? [open] : filter === 'acknowledged' ? [ack] : [open, ack]
    return { data, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/alerts', () => ({
  acknowledgeAlert: vi.fn(),
  closeAlert: vi.fn(),
  listAlerts: vi.fn(),
}))

import { Alertas } from '../Alertas'

function renderAlertas() {
  render(
    <MemoryRouter>
      <Alertas />
    </MemoryRouter>,
  )
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('US-135: lista os alertas e filtra por status', () => {
  renderAlertas()

  // "Todos os abertos" tab is active -> both alerts visible
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.getByText('Fatura vencida 123')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Novos' }))
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.queryByText('Fatura vencida 123')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Reconhecidos' }))
  expect(screen.getByText('Fatura vencida 123')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()
})

it('US-138: oferece link direto para a entidade do alerta', () => {
  renderAlertas()

  // container alert -> /demurrage?busca=CNTR1
  expect(screen.getByRole('link', { name: /Ver Demurrage/ }).getAttribute('href')).toBe('/demurrage?busca=CNTR1')
  // invoice alert with numeric id -> /faturamento?invoice=123
  expect(screen.getByRole('link', { name: /Ver Fatura/ }).getAttribute('href')).toBe('/faturamento?invoice=123')
})
