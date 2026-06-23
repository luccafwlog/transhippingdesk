import { beforeEach, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabasePortal: { rpc: rpcMock } }))

import { portalObsoleteConsolidation, portalOpenDemurrageDispute, portalUpdateProfile } from '../portalBilling'

beforeEach(() => {
  rpcMock.mockReset()
})

it('US-167: desfaz a consolidada chamando o RPC e retornando o resultado', async () => {
  rpcMock.mockResolvedValue({ data: { obsoleted: true }, error: null })

  await expect(portalObsoleteConsolidation(55)).resolves.toEqual({ obsoleted: true })
  expect(rpcMock).toHaveBeenCalledWith('portal_obsolete_consolidation', { p_invoice_id: 55 })
})

it('US-167: propaga erro do RPC ao desfazer a consolidada', async () => {
  rpcMock.mockResolvedValue({ data: null, error: new Error('nao permitido') })
  await expect(portalObsoleteConsolidation(55)).rejects.toThrow('nao permitido')
})

it('US-168: abre disputa de demurrage com motivo', async () => {
  rpcMock.mockResolvedValue({ data: null, error: null })

  await portalOpenDemurrageDispute(9, 'cobranca indevida')
  expect(rpcMock).toHaveBeenCalledWith('portal_open_demurrage_dispute', {
    p_demurrage_invoice_id: 9,
    p_reason: 'cobranca indevida',
  })
})

it('US-176: atualiza contato/endereco mapeando os parametros do RPC', async () => {
  rpcMock.mockResolvedValue({ data: null, error: null })

  await portalUpdateProfile({ contactEmail: 'a@b.com', phone: '11999', city: 'SP' })
  expect(rpcMock).toHaveBeenCalledWith('portal_update_profile', {
    p_contact_email: 'a@b.com',
    p_phone: '11999',
    p_address: null,
    p_city: 'SP',
    p_state: null,
    p_zip: null,
  })
})

it('US-176: propaga erro do RPC ao atualizar perfil', async () => {
  rpcMock.mockResolvedValue({ data: null, error: new Error('falha') })
  await expect(portalUpdateProfile({ phone: 'x' })).rejects.toThrow('falha')
})
