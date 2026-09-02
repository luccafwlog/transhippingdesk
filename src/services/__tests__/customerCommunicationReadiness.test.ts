import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))

import {
  customerCommunicationReadinessReasonLabel,
  fetchCustomerLocalChargesCommunicationReadiness,
} from '../customerCommunicationReadiness'

describe('customerCommunicationReadiness', () => {
  beforeEach(() => rpc.mockReset())

  it('consulta a RPC por viagem/cliente e normaliza o veredito', async () => {
    rpc.mockResolvedValue({
      data: {
        voyage_id: 7,
        customer_id: 10,
        ready: false,
        reason_code: 'faturamento_pendente',
        bl_count: 2,
        blocked_bl_count: 1,
        reasons: ['faturamento_pendente'],
        bls: [{ bl_id: 'BL-2', financial_status: 'pending', blocked_reasons: ['faturamento_pendente'] }],
      },
      error: null,
    })

    const result = await fetchCustomerLocalChargesCommunicationReadiness(7, 10)
    expect(rpc).toHaveBeenCalledWith('customer_local_charges_communication_readiness', {
      p_voyage_id: 7,
      p_customer_id: 10,
    })
    expect(result.ready).toBe(false)
    expect(result.bls[0]?.cargo_mode).toBe('container')
    expect(customerCommunicationReadinessReasonLabel(result.reason_code)).toBe('Faturamento ainda não concluído')
  })
})
