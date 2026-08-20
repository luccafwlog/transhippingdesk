import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DemurrageDisputeConversation } from '../DemurrageDisputeConversation'

vi.mock('../../../hooks/useDemurrageDisputes', () => ({
  useDemurrageAddDisputeMessage: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useDemurrageReopenDispute: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

describe('DemurrageDisputeConversation', () => {
  const mockDispute = {
    id: 1,
    demurrage_invoice_id: 1,
    doc_number: 'DEM-123',
    customer_id: 1,
    customer_name: 'Test Customer',
    state: 'aberta' as const,
    next_responder: 'equipamentos' as const,
    subject: 'Test Subject',
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    messages: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the dispute subject and status', () => {
    render(<DemurrageDisputeConversation dispute={mockDispute} />)
    expect(screen.getByText('Test Subject')).toBeTruthy()
    expect(screen.getByText('aberta')).toBeTruthy()
  })

  it('renders a form for new messages when state is aberta', () => {
    render(<DemurrageDisputeConversation dispute={mockDispute} />)
    expect(screen.getByPlaceholderText('Digite sua resposta (Equipamentos)...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeTruthy()
  })

  it('renders a reopen form when state is resolvida', () => {
    const resolvedDispute = { ...mockDispute, state: 'resolvida' as const }
    render(<DemurrageDisputeConversation dispute={resolvedDispute} />)
    expect(screen.getByPlaceholderText('Justificativa da reabertura...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reabrir/ })).toBeTruthy()
  })
})
