import { describe, expect, it } from 'vitest'
import { isWithinNextCalendarDays } from '../../lib/dates'

describe('isWithinNextCalendarDays', () => {
  const today = new Date('2026-06-15T15:30:00-03:00')

  it('inclui vencimentos na data atual', () => {
    expect(isWithinNextCalendarDays('2026-06-15', 7, today)).toBe(true)
  })

  it('inclui vencimentos ate sete dias corridos', () => {
    expect(isWithinNextCalendarDays('2026-06-22', 7, today)).toBe(true)
  })

  it('exclui vencimentos apos a janela de sete dias', () => {
    expect(isWithinNextCalendarDays('2026-06-23', 7, today)).toBe(false)
  })

  it('exclui datas nulas, invalidas e passadas', () => {
    expect(isWithinNextCalendarDays(null, 7, today)).toBe(false)
    expect(isWithinNextCalendarDays('data-invalida', 7, today)).toBe(false)
    expect(isWithinNextCalendarDays('2026-06-14', 7, today)).toBe(false)
  })
})
