import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeReport: vi.fn(),
  reopenReport: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('../../services/agencyDepartureReport', () => ({
  addOccurrence: vi.fn(),
  closeReport: mocks.closeReport,
  getAgencyReportDerivedData: vi.fn(),
  getAgencyReportOwnData: vi.fn(),
  reopenReport: mocks.reopenReport,
  setSignoff: vi.fn(),
  setTerminal: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { mutationFn: (input: unknown) => Promise<void>; onSuccess?: () => void }) => ({
    mutate: async (input: unknown) => {
      await options.mutationFn(input)
      options.onSuccess?.()
    },
  }),
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

import { useCloseAgencyReport, useReopenAgencyReport } from '../useAgencyReport'

const expectedInvalidations = [
  ['agency-report-own'],
  ['agency-report'],
  ['alerts'],
  ['op-count'],
  ['header-alert'],
  ['dashboard'],
]

describe('agency report close/reopen cache invalidation', () => {
  beforeEach(() => {
    mocks.closeReport.mockReset().mockResolvedValue(undefined)
    mocks.reopenReport.mockReset().mockResolvedValue(undefined)
    mocks.invalidateQueries.mockReset()
  })

  it.each([
    ['close', useCloseAgencyReport, mocks.closeReport],
    ['reopen', useReopenAgencyReport, mocks.reopenReport],
  ] as const)('%s invalida todas as famílias derivadas sem invalidar tudo', async (_label, hook, service) => {
    const mutation = hook()
    await mutation.mutate({ voyageId: 42, port: 'SANTOS' })

    expect(service).toHaveBeenCalledWith({ voyageId: 42, port: 'SANTOS' })
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(expectedInvalidations.length)
    for (const queryKey of expectedInvalidations) {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith()
  })
})
