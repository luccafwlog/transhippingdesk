import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as Array<{ id: number; voyage_number: string; vessel: { name: string | null; imo: string | null } | null }> }))

vi.mock('../supabase', () => {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  builder.select = () => builder
  builder.ilike = () => builder
  builder.overrideTypes = () => Promise.resolve({ data: state.rows, error: null })
  return { supabase: { from: () => builder } }
})

import { findVoyageByNumberAndVessel } from '../voyages'

describe('voyage identity S03', () => {
  beforeEach(() => {
    state.rows = []
  })

  it('IMO prevalece sobre grafia (ZYHY vs canônico)', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'ZHONG YUAN HAI YUN JIN QU', imo: '1234567' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '1234567', 'ZYHY JIN QU')).resolves.toBe(1)
  })

  it('IMOs distintos nunca fundem', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: '1111111' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '2222222', 'GREEN SANTOS')).resolves.toBeNull()
  })

  it('conflito explícito em vez de .find arbitrário', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: null } },
      { id: 2, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: null } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '', 'GREEN SANTOS')).rejects.toThrow(/ambígua/)
  })

  it('CSCL não casa com COSCO por prefixo', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'COSCO SHIPPING ALGOL', imo: null } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '', 'CSCL VENUS')).resolves.toBeNull()
  })
})
