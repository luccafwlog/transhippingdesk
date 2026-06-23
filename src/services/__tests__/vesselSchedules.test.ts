import { expect, it, vi } from 'vitest'

const from = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabasePortal: { from } }))

import { listVesselSchedules } from '../vesselSchedules'

it('propagates schedule read failures instead of returning an empty list', async () => {
  const error = new Error('schedule unavailable')
  const builder = {
    select: vi.fn(),
    order: vi.fn().mockResolvedValue({ data: null, error }),
  }
  builder.select.mockReturnValue(builder)
  from.mockReturnValue(builder)

  await expect(listVesselSchedules()).rejects.toThrow('schedule unavailable')
})
