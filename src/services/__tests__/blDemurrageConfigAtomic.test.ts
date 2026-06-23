import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { saveBlDemurrageConfig } from '../blDemurrageConfig'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => rpcMock.mockReset())

it('salva free time e overrides P1/P2 em uma unica RPC', async () => {
  rpcMock.mockResolvedValue({ error: null })

  await saveBlDemurrageConfig({
    blId: 'BL-1',
    expectedUpdatedAt: '2026-06-23T00:00:00Z',
    freeTime: 7,
    p1: 10.5,
    p2: null,
    changedBy: 'user-1',
  })

  expect(rpcMock).toHaveBeenCalledWith('save_bl_demurrage_config', {
    p_bl_id: 'BL-1',
    p_expected_updated_at: '2026-06-23T00:00:00Z',
    p_free_time_override: 7,
    p_rate_p1_usd: 10.5,
    p_rate_p2_usd: null,
    p_changed_by: 'user-1',
  })
})

it('define RPC atomica, auditada e protegida', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/20260623112000_save_bl_demurrage_config_atomic.sql'),
    'utf8',
  )
  expect(sql).toMatch(/FUNCTION public\.save_bl_demurrage_config/i)
  expect(sql).toMatch(/FOR UPDATE/i)
  expect(sql).toMatch(/demurrage_rate_override_p1_usd/i)
  expect(sql).toMatch(/demurrage_rate_override_p2_usd/i)
  expect(sql).toMatch(/INSERT INTO public\.audit_logs/i)
  expect(sql).toMatch(/ERRCODE = 'PT409'/i)
  expect(sql).toMatch(/FROM PUBLIC, anon/i)
  expect(sql).toMatch(/TO authenticated/i)
})
