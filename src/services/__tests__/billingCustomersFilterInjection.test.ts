import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder, order: () => builder, limit: () => builder,
    or: (arg: string) => { calls.or(arg); return builder },
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
  })
  return { supabase: { from: () => builder } }
})

import { listBillingCustomers } from '../billing'

describe('listBillingCustomers - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())
  it('remove curingas e metacaracteres de filtro do termo', async () => {
    await listBillingCustomers('AB,%_')
    expect(calls.or).toHaveBeenCalledWith('name.ilike.%AB%,cnpj_cpf.ilike.%AB%')
  })
})
