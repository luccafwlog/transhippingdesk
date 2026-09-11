import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcCalls } = vi.hoisted(() => ({ rpcCalls: [] as Array<{ name: string; args: unknown }> }))

vi.mock('../supabase', () => {
  const client = {
    rest: { marker: true },
    rpc(this: { rest?: unknown } | undefined, name: string, args: Record<string, unknown>) {
      if (!this?.rest) {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')")
      }
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: [], error: null })
    },
  }
  return { supabase: client }
})

import { listPixReconciliationExceptions } from '../reconciliacao'

describe('RPCs de reconciliação PIX preservam o receptor do cliente', () => {
  beforeEach(() => {
    rpcCalls.length = 0
  })

  it('lista pendências sem destacar supabase.rpc', async () => {
    await expect(listPixReconciliationExceptions()).resolves.toEqual([])
    expect(rpcCalls).toEqual([{
      name: 'list_pix_reconciliation_exceptions',
      args: { p_status: 'active' },
    }])
  })
})
