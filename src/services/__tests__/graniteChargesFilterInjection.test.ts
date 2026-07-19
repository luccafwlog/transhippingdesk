import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ or: vi.fn() }))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder, range: () => builder, order: () => builder, eq: () => builder, in: () => builder,
    or: (arg: string) => { calls.or(arg); return builder },
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) => resolve({ data: [], error: null, count: 0 }),
  })
  return { supabase: { from: () => builder } }
})

import { listGraniteBls } from '../graniteCharges'

describe('listGraniteBls - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())
  it('escapa metacaracteres de filtro no termo de busca', async () => {
    await listGraniteBls({ search: 'ACME,ME' })
    expect(calls.or).toHaveBeenCalledWith('bl_number.ilike.%ACME ME%,shipper_name.ilike.%ACME ME%,shipper_cnpj.ilike.%ACME ME%')
  })
})
