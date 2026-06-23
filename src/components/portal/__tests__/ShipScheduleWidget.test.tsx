// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  removeChannel: vi.fn(),
}))

const channel = {
  on: mocks.on,
  subscribe: mocks.subscribe,
}

mocks.on.mockReturnValue(channel)
mocks.subscribe.mockReturnValue(channel)

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../../hooks/useVesselSchedules', () => ({
  useVesselSchedules: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../services/supabase', () => ({
  supabasePortal: {
    channel: () => channel,
    removeChannel: mocks.removeChannel,
  },
}))

import { ShipScheduleWidget } from '../ShipScheduleWidget'

it('invalidates the Portal schedule after a Realtime change and removes the channel', () => {
  let realtimeCallback: (() => void) | undefined
  mocks.on.mockImplementation((_event, _filter, callback) => {
    realtimeCallback = callback
    return channel
  })

  const { unmount } = render(<ShipScheduleWidget />)
  realtimeCallback?.()

  expect(mocks.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ['portal-vessel-schedules'],
  })

  unmount()
  expect(mocks.removeChannel).toHaveBeenCalledWith(channel)
})
