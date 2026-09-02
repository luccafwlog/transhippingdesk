// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseCustomerVoyageCommunicationStatus } = vi.hoisted(() => ({
  mockUseCustomerVoyageCommunicationStatus: vi.fn(),
}))

vi.mock('../../../hooks/useCustomerCommunicationReadiness', () => ({
  useCustomerVoyageCommunicationStatuses: () => [mockUseCustomerVoyageCommunicationStatus()],
}))

import { InvoiceCommunicationStatusCell } from '../InvoiceCommunicationStatusCell'

const invoice = {
  id: 1,
  invoice_number: 'INV-1',
  customer_id: 10,
  bl_id: 'BL-1',
  issued_at: '2026-09-01',
  total_brl: 100,
  status: 'issued',
  invoice_type: 'individual',
  total_paid_brl: 0,
  balance_brl: 100,
  created_at: '2026-09-01',
  invoice_bls: [{
    id: 1,
    bl_id: 'BL-1',
    subtotal_brl: 100,
    subtotal_usd: 0,
    bl: { pod: 'BRSSZ', voyage: { id: 7, voyage_number: 'V7', vessel: { name: 'Navio 7' } } },
  }],
} as never

describe('InvoiceCommunicationStatusCell', () => {
  beforeEach(() => {
    mockUseCustomerVoyageCommunicationStatus.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        readiness: { ready: true },
        blockedReason: null,
        latest: { id: 12, status: 'enviado', createdAt: '2026-09-01T13:15:00Z', attemptDiscriminator: 0 },
        nextManualAttemptDiscriminator: 1,
      },
    })
  })

  it('exibe envio automático, histórico e reenvio assistido', () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><InvoiceCommunicationStatusCell invoice={invoice} /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('customer-finance-communication-status').textContent).toContain('Enviado automaticamente')
    expect(screen.getByRole('link', { name: 'Ver comunicado' }).getAttribute('href')).toContain('tab=historico')
    expect(screen.getByRole('button', { name: 'Reenviar comunicado' })).toBeTruthy()
  })

  it('oferece reenvio quando a prontidão está liberada mesmo sem histórico', () => {
    mockUseCustomerVoyageCommunicationStatus.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        readiness: { ready: true },
        blockedReason: null,
        latest: null,
        nextManualAttemptDiscriminator: 1,
      },
    })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><InvoiceCommunicationStatusCell invoice={invoice} /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Aguardando envio automático')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reenviar comunicado' })).toBeTruthy()
  })

  it('exibe o motivo de bloqueio e não oferece reenvio', () => {
    mockUseCustomerVoyageCommunicationStatus.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        readiness: { ready: false },
        blockedReason: 'CE Mercante ausente',
        latest: null,
        nextManualAttemptDiscriminator: 1,
      },
    })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><InvoiceCommunicationStatusCell invoice={invoice} /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Prontidão bloqueada: CE Mercante ausente')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reenviar comunicado' })).toBeNull()
  })
})
