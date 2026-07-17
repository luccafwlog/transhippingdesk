import { expect, it } from 'vitest'
import { isCycleStartRow } from '../../lib/lineupCycle'

it('identifica toda ocorrência renderizada da primeira escala pelo id de origem', () => {
  expect(isCycleStartRow('1::SSZ', '1::SSZ')).toBe(true)
  expect(isCycleStartRow('1::SSZ::display-track-8-2', '1::SSZ')).toBe(true)
  expect(isCycleStartRow('2::RIO::display-track-8-3', '1::SSZ')).toBe(false)
})
