import { expect, it, vi } from 'vitest'
import { invalidateAgencyReportForVoyage } from '../agencyReportInvalidation'

it('invalida somente o ADR da viagem alterada', async () => {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined)
  await invalidateAgencyReportForVoyage({ invalidateQueries }, 179)
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['agency-report', 179] })
})
