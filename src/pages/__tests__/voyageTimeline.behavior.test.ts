import { describe, expect, it } from 'vitest'
import { buildVoyageTimeline } from '../viagensHelpers'

describe('buildVoyageTimeline (US-220 carregar timeline)', () => {
  it('humaniza importacoes, CE Master, cobertura de CE e import Baplie', () => {
    const events = buildVoyageTimeline({
      importBatches: [
        { id: 1, filename: 'manifesto.edi', cargo_mode: 'container', uploaded_at: '2026-06-01T10:00:00Z', route: 'BRSSZ-BRVIX', ce_master: 'CE-123' },
      ],
      ceCoverage: { filled: 2, total: 2 },
      baplieImports: [{ imported_at: '2026-06-02T08:00:00Z', container_count: 10 }],
      openDivergenceCount: 0,
    })

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('import')
    expect(kinds).toContain('ce-master')
    expect(kinds).toContain('ce-coverage')
    expect(kinds).toContain('baplie-import')

    expect(events.find((e) => e.kind === 'ce-master')?.detail).toBe('CE-123')
    expect(events.find((e) => e.kind === 'import')?.detail).toContain('CNTR')
    expect(events.find((e) => e.kind === 'ce-coverage')?.detail).toBe('2/2 B/Ls com CE')
  })

  it('ignora lotes sem data de upload e retorna lista vazia sem fontes', () => {
    expect(buildVoyageTimeline({ importBatches: [{ id: 9, filename: 'x', cargo_mode: 'container', uploaded_at: null }] })).toEqual([])
    expect(buildVoyageTimeline({})).toEqual([])
  })
})
