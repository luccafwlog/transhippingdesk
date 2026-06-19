import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCustomerPortalAccount,
  normalizeCustomerPortalRpcError,
  provisionPortalForCustomer,
  sumIssuedInvoiceBalancesByCustomer,
  upsertCustomerPortalAccount,
} from '../customers'

const { mockInvoke, mockRpc } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
    rpc: mockRpc,
    from: vi.fn(),
  },
}))

describe('customers portal provisioning', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
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
      p_login_cnpj: null,
    })
  })

  it('so ativa a conta depois de vincular o usuario Auth', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'upsert_customer_portal_account') {
        return {
          data: { id: 7, customer_id: 10, active: false },
          error: null,
        }
      }
      if (name === 'set_customer_portal_account_active') {
        return {
          data: {
            id: 7,
            customer_id: 10,
            active: true,
            auth_user_id: 'auth-user-1',
            portal_email: 'financeiro@cliente.com',
          },
          error: null,
        }
      }
      throw new Error(`RPC inesperada: ${name}`)
    })
    mockInvoke.mockResolvedValue({
      data: { success: true, auth_user_id: 'auth-user-1' },
      error: null,
    })

    await provisionPortalForCustomer({
      customerId: 10,
      portalEmail: 'financeiro@cliente.com',
      actorId: 'admin-1',
      loginCnpj: '12116971001071',
    })

    expect(mockRpc.mock.calls[0]).toEqual([
      'upsert_customer_portal_account',
      expect.objectContaining({ p_active: false }),
    ])
    expect(mockInvoke).toHaveBeenCalledWith(
      'provision-portal-user',
      expect.objectContaining({
        body: expect.objectContaining({
          customer_portal_account_id: 7,
          portal_email: 'financeiro@cliente.com',
        }),
      }),
    )
    expect(mockRpc.mock.calls[1]).toEqual([
      'set_customer_portal_account_active',
      {
        p_customer_id: 10,
        p_active: true,
        p_actor: 'admin-1',
      },
    ])
  })

  it('mantem a conta inativa quando o provisionamento Auth falha', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 7, customer_id: 10, active: false },
      error: null,
    })
    mockInvoke.mockResolvedValue({
      data: null,
      error: new Error('Falha ao criar usuario Auth'),
    })

    await expect(
      provisionPortalForCustomer({
        customerId: 10,
        portalEmail: 'financeiro@cliente.com',
        actorId: 'admin-1',
      }),
    ).rejects.toThrow('Falha ao criar usuario Auth')

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith(
      'upsert_customer_portal_account',
      expect.objectContaining({ p_active: false }),
    )
  })

  it('nao ativa a conta se a Edge Function nao confirmar auth_user_id', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 7, customer_id: 10, active: false },
      error: null,
    })
    mockInvoke.mockResolvedValue({
      data: { success: true },
      error: null,
    })

    await expect(
      provisionPortalForCustomer({
        customerId: 10,
        portalEmail: 'financeiro@cliente.com',
        actorId: 'admin-1',
      }),
    ).rejects.toThrow('nao confirmou o usuario Auth')

    expect(mockRpc).toHaveBeenCalledTimes(1)
  })
})

describe('sumIssuedInvoiceBalancesByCustomer', () => {
  it('soma apenas invoices issued por cliente', () => {
    const result = sumIssuedInvoiceBalancesByCustomer([
      { customer_id: 10, status: 'issued', balance_brl: 120 },
      { customer_id: 10, status: 'partially_paid', balance_brl: 40 },
      { customer_id: 10, status: 'paid', balance_brl: 0 },
      { customer_id: 20, status: 'issued', balance_brl: 75 },
      { customer_id: null, status: 'issued', balance_brl: 99 },
    ])

    expect(result.get(10)).toBe(120)
    expect(result.get(20)).toBe(75)
    expect(result.has(0)).toBe(false)
  })
})
