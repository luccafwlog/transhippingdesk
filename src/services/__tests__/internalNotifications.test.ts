import { beforeEach, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

import { listInternalNotifications } from '../alerts'

beforeEach(() => rpcMock.mockReset())

it('consulta notificações com cursor composto por data e id', async () => {
  rpcMock.mockResolvedValue({ data: [], error: null })

  await listInternalNotifications({
    includeRead: false,
    limit: 20,
    before: { createdAt: '2026-08-22T10:00:00Z', id: 41 },
  })

  expect(rpcMock).toHaveBeenCalledWith('list_internal_notifications', {
    p_include_read: false,
    p_limit: 20,
    p_before_created_at: '2026-08-22T10:00:00Z',
    p_before_id: 41,
  })
})
