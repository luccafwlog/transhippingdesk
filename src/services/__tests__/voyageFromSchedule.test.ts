import { describe, expect, it } from 'vitest'
import { partitionScheduleLanes, type ScheduleLaneInput } from '../voyageFromSchedule'

describe('partitionScheduleLanes', () => {
  const lanes: ScheduleLaneInput[] = [
    { code: 'CNTAO', kind: 'pol', date: '2026-01-04' },
    { code: 'CNSHA', kind: 'pol', date: null },
    { code: 'BRSSA', kind: 'pod', date: '2026-01-22' },
    { code: 'BRVIX', kind: 'pod', date: '' },
  ]

  it('mantem so lanes com data e separa POL de POD', () => {
    const { pols, pods } = partitionScheduleLanes(lanes)
    expect(pols).toEqual([{ code: 'CNTAO', etd: '2026-01-04' }])
    expect(pods).toEqual([{ pod: 'BRSSA', eta: '2026-01-22' }])
  })
})
