// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PortalDisputeConversation } from '../PortalDisputeConversation'

vi.mock('../../../hooks/usePortalDisputes', () => ({
  usePortalAddDisputeMessage: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  usePortalRequestDisputeReopen: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

describe('PortalDisputeConversation', () => {
  const mockDispute = {
    id: 1,
    demurrage_invoice_id: 1,
    doc_number: 'DEM-123',
    state: 'aberta' as const,
    next_responder: 'cliente' as const,
    subject: 'Test Subject',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    messages: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the dispute doc_number and status', () => {
    render(<PortalDisputeConversation disputes={[mockDispute]} />)
    expect(screen.getByText('DEM-123')).toBeTruthy()
    expect(screen.getByText('Aberta')).toBeTruthy()
  })

  it('renders a form for new messages when state is aberta', () => {
    render(<PortalDisputeConversation disputes={[mockDispute]} />)
    expect(screen.getByPlaceholderText('Responda à conversa...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeTruthy()
  })

  it('renders a reopen request form when state is resolvida', () => {
    const resolvedDispute = { ...mockDispute, state: 'resolvida' as const }
    render(<PortalDisputeConversation disputes={[resolvedDispute]} />)
    expect(screen.getByPlaceholderText('Explique por que a disputa deve ser reaberta...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Solicitar reabertura/ })).toBeTruthy()
  })
})
