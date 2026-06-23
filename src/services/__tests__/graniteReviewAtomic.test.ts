import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { saveGraniteBlReview } from '../review'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => { rpcMock.mockReset() })

it('vincula cliente Granite e auditoria em uma unica RPC', async () => {
  rpcMock.mockResolvedValue({ error: null })

  await saveGraniteBlReview({ graniteBlId: 'GR-1', clientId: 7, changedBy: 'user-1' })

  expect(rpcMock).toHaveBeenCalledWith('save_granite_bl_review', {
    p_granite_bl_id: 'GR-1',
    p_client_id: 7,
    p_changed_by: 'user-1',
  })
})

it('define RPC protegida com update e auditoria na mesma transacao', () => {
  const sql = fs.readFileSync(
    path.resolve('supabase/migrations/20260623120000_save_granite_bl_review_atomic.sql'),
    'utf8',
  )
  expect(sql).toMatch(/FUNCTION public\.save_granite_bl_review/i)
  expect(sql).toMatch(/UPDATE public\.granite_bls/i)
  expect(sql).toMatch(/INSERT INTO public\.audit_logs/i)
  expect(sql).toMatch(/FOR UPDATE/i)
  expect(sql).toMatch(/FROM PUBLIC, anon/i)
  expect(sql).toMatch(/TO authenticated/i)
})
