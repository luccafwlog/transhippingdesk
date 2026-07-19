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

import { listVaziosBookings } from '../vaziosImport'

describe('listVaziosBookings - injeção de filtro PostgREST', () => {
  beforeEach(() => calls.or.mockReset())
  it('escapa metacaracteres de filtro no termo de busca', async () => {
    await listVaziosBookings({ search: 'ACME,ME' })
    expect(calls.or).toHaveBeenCalledWith('booking_number.ilike.%ACME ME%,container_number.ilike.%ACME ME%')
  })
  it('não adiciona filtro quando o termo vira vazio', async () => {
    await listVaziosBookings({ search: '%%' })
    expect(calls.or).not.toHaveBeenCalled()
  })
})
