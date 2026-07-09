import { describe, expect, it } from 'vitest'
import { buildScheduleLanes, emptyScheduleForm } from '../chegadasSaidasForm'

describe('buildScheduleLanes', () => {
  it('converte o form em lanes com code canonico, pulando nao escala', () => {
    const form = { ...emptyScheduleForm, dates: { ...emptyScheduleForm.dates } }
    form.dates.QINGDAO = '2026-01-04'
    form.dates.SALVADOR = '2026-01-22'
    form.dates.VITÓRIA = ''

    const lanes = buildScheduleLanes(form)

    expect(lanes).toContainEqual({ code: 'CNTAO', kind: 'pol', date: '2026-01-04' })
    expect(lanes).toContainEqual({ code: 'BRSSA', kind: 'pod', date: '2026-01-22' })
    expect(lanes.find((lane) => lane.code === 'BRVIX')?.date).toBe(null)
  })
})
