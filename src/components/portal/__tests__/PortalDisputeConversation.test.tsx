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

  it('renders the dispute subject and status', () => {
    render(<PortalDisputeConversation dispute={mockDispute} />)
    expect(screen.getByText('Test Subject')).toBeTruthy()
    expect(screen.getByText('aberta')).toBeTruthy()
  })

  it('renders a form for new messages when state is aberta', () => {
    render(<PortalDisputeConversation dispute={mockDispute} />)
    expect(screen.getByPlaceholderText('Digite sua mensagem...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeTruthy()
  })

  it('renders a reopen request form when state is resolvida', () => {
    const resolvedDispute = { ...mockDispute, state: 'resolvida' as const }
    render(<PortalDisputeConversation dispute={resolvedDispute} />)
    expect(screen.getByPlaceholderText('Justificativa para solicitar reabertura...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Solicitar reabertura/ })).toBeTruthy()
  })
})
