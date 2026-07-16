// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { QueueRow } from '../../../services/portalProvisioning'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))
vi.mock('../../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { PortalReviewPanel } from '../PortalReviewPanel'

const row: QueueRow = {
  account_id: 1, customer_id: 1, customer_name: 'Cliente', cnpj_cpf: '123', provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null, recovery_email_source: null, pending_invite_expires_at: null,
  hasCriticalAlert: false, hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null,
  candidates: [{ email: 'financeiro@example.com', purpose: 'financeiro', origin: 'Contato do Cliente' }], sharedEmailCount: 0, latestDeliveryStatus: null, exceptionReason: null,
}

describe('PortalReviewPanel', () => {
  it('mostra candidato e mantém convite desabilitado sem email selecionado', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter><PortalReviewPanel row={{ ...row, candidates: [] }} /></MemoryRouter></QueryClientProvider>)
    expect(screen.getByText('Nenhum contato com email disponível.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enviar convite' })).toHaveProperty('disabled', true)
  })
})
