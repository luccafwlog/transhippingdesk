// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const open = { id: 1, status: 'open', type: 'demurrage', message: 'Container vencendo', entity_type: 'container', entity_id: 'CNTR1', created_at: '2026-06-20T00:00:00Z' }
const ack = { id: 2, status: 'open', type: 'invoice_overdue', message: 'Fatura vencida 123', entity_type: 'invoice', entity_id: '123', created_at: '2026-06-19T00:00:00Z', dismissed_until: '2026-08-22T12:00:00Z' }
const portalInvoice = { id: 3, status: 'open', type: 'portal_excecao_critica_fatura', message: 'Portal sem email para fatura', entity_type: 'invoice', entity_id: '456', created_at: '2026-06-18T00:00:00Z' }
const adrLegacy = { id: 4, status: 'open', type: 'agency_report_department_pending', message: 'ADR legado', entity_type: 'agency_departure_report', entity_id: '10::BRVIX::documentacao', created_at: '2026-06-17T00:00:00Z' }
const adrTerminalized = { id: 5, status: 'open', type: 'agency_report_department_pending', message: 'ADR terminalizado', entity_type: 'agency_departure_report', entity_id: '10::BRVIX::TVV::documentacao', created_at: '2026-06-16T00:00:00Z' }

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const filter = queryKey[1] as string
    const data = filter === 'active' ? [open, portalInvoice, adrLegacy, adrTerminalized] : filter === 'dismissed' ? [ack] : [open, portalInvoice, adrLegacy, adrTerminalized, ack]
    return { data, isLoading: false, error: null }
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/alerts', () => ({
  listAlerts: vi.fn(),
  dismissAlertItem: vi.fn().mockResolvedValue(undefined),
  formatAgencyReportAlertEntity: (entityId: string) => entityId,
  formatAlertEntity: (entityType: string, entityId: string) => (entityType === 'agency_departure_report' ? entityId : null),
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

  // "Todos" tab is active -> all current projections are visible
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.getByText('Fatura vencida 123')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Ativos' }))
  expect(screen.getByText('Container vencendo')).toBeTruthy()
  expect(screen.queryByText('Fatura vencida 123')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Dispensados' }))
  expect(screen.getByText('Fatura vencida 123')).toBeTruthy()
  expect(screen.queryByText('Container vencendo')).toBeNull()
})

it('US-138: oferece link direto para a entidade do alerta', () => {
  renderAlertas()

  // container alert -> /demurrage?busca=CNTR1
  expect(screen.getByRole('link', { name: /Ver Demurrage/ }).getAttribute('href')).toBe('/demurrage?busca=CNTR1')
  // invoice alert with numeric id -> /taxas-locais?invoice=123
  expect(screen.getAllByRole('link', { name: /Ver Fatura/ })[0].getAttribute('href')).toBe('/taxas-locais?invoice=456')
  expect(screen.getAllByRole('link', { name: /Ver Fatura/ })[1].getAttribute('href')).toBe('/taxas-locais?invoice=123')
})

it('distingue o formato ADR legado do formato terminalizado ao abrir a viagem', () => {
  renderAlertas()

  expect(screen.getAllByRole('link', { name: /Abrir Viagem/ })[0].getAttribute('href')).toBe('/viagens/10?tab=adr&escala=BRVIX')
  expect(screen.getAllByRole('link', { name: /Abrir Viagem/ })[1].getAttribute('href')).toBe('/viagens/10?tab=adr&escala=BRVIX&terminal=TVV')
})
