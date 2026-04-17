import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCustomerPortalAccount,
  normalizeCustomerPortalRpcError,
  upsertCustomerPortalAccount,
} from '../customers'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: vi.fn(),
  },
}))

describe('customers portal provisioning', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('normaliza erro de RPC ausente para orientar aplicacao da migration', () => {
    const message = normalizeCustomerPortalRpcError(
      {
        code: 'PGRST202',
        message: 'Could not find the function public.upsert_customer_portal_account in the schema cache',
      },
      'upsert',
    )

    expect(message).toContain('025_billing_orchestration_portal.sql')
  })

  it('normaliza erro de permissao administrativa', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Credenciais invalidas ou sem permissao administrativa.',
      },
    })

    await expect(getCustomerPortalAccount(10)).rejects.toThrow(
      "Usuario autenticado sem permissao administrativa no Supabase. Verifique public.user_profiles.role = 'admin' e active = true.",
    )
  })

  it('retorna conta provisionada quando a RPC responde com JSON valido', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 7,
        customer_id: 10,
        contact_email: 'financeiro@cliente.com',
        active: true,
        created_by: 'user-id',
        last_login_at: null,
        created_at: '2026-04-16T12:00:00Z',
        updated_at: '2026-04-16T12:00:00Z',
      },
      error: null,
    })

    const result = await upsertCustomerPortalAccount({
      customerId: 10,
      password: 'segredo123',
      contactEmail: 'financeiro@cliente.com',
      active: true,
      actorId: 'user-id',
    })

    expect(result.id).toBe(7)
    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_portal_account', {
      p_customer_id: 10,
      p_password: 'segredo123',
      p_contact_email: 'financeiro@cliente.com',
      p_active: true,
      p_actor: 'user-id',
    })
  })
})
