import { expect, it, vi } from 'vitest'
import { parseVesselScheduleFile } from '../vesselScheduleImport'

it('rejects an oversized workbook before reading its bytes', async () => {
  const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'navios.xlsx')
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer')

  await expect(parseVesselScheduleFile(file)).rejects.toThrow(/tamanho|limite|MB/i)
  expect(arrayBuffer).not.toHaveBeenCalled()
})
