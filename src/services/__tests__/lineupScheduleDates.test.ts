import { expect, it } from 'vitest'
import { lineUpScheduleDates } from '../lineup'

it('transporta ATA, ATB e ATD do schedule para a linha de Line-Up', () => {
  expect(lineUpScheduleDates({
    ata: '2026-07-09',
    atb: '2026-07-10',
    atd: '2026-07-12',
  })).toEqual({
    ata: '2026-07-09',
    atb: '2026-07-10',
    atd: '2026-07-12',
  })
})

it('usa null para linha de exportação sem schedule POD', () => {
  expect(lineUpScheduleDates(undefined)).toEqual({ ata: null, atb: null, atd: null })
})
