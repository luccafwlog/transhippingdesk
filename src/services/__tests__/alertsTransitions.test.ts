import { beforeEach, expect, it, vi } from 'vitest'
import { dismissAlertItem } from '../alerts'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => { rpcMock.mockReset() })

it('envia dispensa temporária ao RPC central com motivo e revisão futura', async () => {
  rpcMock.mockResolvedValue({ data: { id: 12 }, error: null })

  await expect(dismissAlertItem(12, 'aguardar retorno do armador', '2026-08-22T12:00:00Z')).resolves.toBeUndefined()
  expect(rpcMock).toHaveBeenCalledWith('dismiss_alert_item', {
    p_item_id: 12,
    p_reason: 'aguardar retorno do armador',
    p_review_at: '2026-08-22T12:00:00Z',
  })
})
