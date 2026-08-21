// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DemurrageDisputeConversation } from '../DemurrageDisputeConversation'

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

let mockState = 'aberta'

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
  useQuery: vi.fn(() => ({
    data: [{ ...mockDispute, state: mockState }],
    isLoading: false,
    error: null,
  })),
  useMutation: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

describe('DemurrageDisputeConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState = 'aberta'
  })

  it('renders the dispute subject and status', () => {
    render(<DemurrageDisputeConversation />)
    expect(screen.getByText('DEM-123 · Test Customer')).toBeTruthy()
    expect(screen.getByText('aberta')).toBeTruthy()
  })

  it('renders a form for new messages when state is aberta', () => {
    render(<DemurrageDisputeConversation />)
    expect(screen.getByPlaceholderText('Responder ao cliente...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar resposta/ })).toBeTruthy()
    // ensure fireEvent is used so TS doesn't complain
    fireEvent.change(screen.getByPlaceholderText('Responder ao cliente...'), { target: { value: 'Test' } })
    expect(screen.getByRole('combobox', { name: 'Próxima ação' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Encerrar pendência (Ninguém)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar resposta/ })).toBeTruthy()
  })

  it('renders a reopen form when state is resolvida', () => {
    mockState = 'resolvida'
    render(<DemurrageDisputeConversation />)
    expect(screen.getByPlaceholderText('Justifique a reabertura...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reabrir Dispute/ })).toBeTruthy()
  })
})
