import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ ilike: vi.fn() }))

vi.mock('../supabase', () => {
  const builder = {
    select: () => builder,
    ilike: (...args: unknown[]) => {
      calls.ilike(...args)
      return builder
    },
    overrideTypes: () => Promise.resolve({ data: [], error: null }),
  }
  return { supabase: { from: () => builder } }
})

import { findVoyageByNumberAndVessel } from '../voyages'

describe('findVoyageByNumberAndVessel - escape do ilike', () => {
  beforeEach(() => calls.ilike.mockReset())

  it('escapa metacaracteres LIKE do numero de viagem', async () => {
    await findVoyageByNumberAndVessel('50%_A', '', 'NAVIO')
    expect(calls.ilike).toHaveBeenCalledWith('voyage_number', '50\\%\\_A')
  })
})
