// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const row = {
  account_id: 1, customer_id: 123, customer_name: 'Cliente Portal', cnpj_cpf: '12345678000195',
  provisioning_decision: 'aguardando_analise', account_situation: 'sem_conta', recovery_email: null,
  recovery_email_source: null, pending_invite_expires_at: null, hasCriticalAlert: false,
  hasOpenInvoice: false, hasActiveProcess: false, lastActivityAt: null, candidates: [], sharedEmailCnpjs: [], sharedEmailCount: 0, latestDeliveryStatus: null, exceptionReason: null,
} as const

vi.mock('../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioning: () => ({ data: [row], isLoading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, can: () => true }) }))
vi.mock('../../services/supabase', () => ({ supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn() } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { ClientesPortal } from '../ClientesPortal'

describe('ClientesPortal', () => {
  it('abre filtrado por aguardando análise e mostra a fila', () => {
    render(<MemoryRouter><ClientesPortal /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Aguardando análise' })).toBeTruthy()
    expect(screen.getByText('Cliente Portal')).toBeTruthy()
  })
})
