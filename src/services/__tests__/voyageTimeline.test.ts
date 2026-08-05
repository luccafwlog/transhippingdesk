import { describe, expect, it } from 'vitest'
import { buildVoyageTimeline } from '../voyageSummaries'

describe('timeline operacional de transbordo', () => {
  it('consolida importações de B/L por lote e rota', () => {
    const events = buildVoyageTimeline({
      importBatches: [{
        id: 10,
        filename: 'bl.xlsx',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
        routes: [
          { pol: 'TAICANG', pod: 'VITÓRIA', blCount: 4 },
          { pol: 'TAICANG', pod: 'VITÓRIA', blCount: 5 },
        ],
      }],
    })

    expect(events.filter((event) => event.kind === 'import')).toHaveLength(1)
    expect(events.find((event) => event.kind === 'import')?.title).toBe('9 B/Ls importados · TAICANG → VITÓRIA')
  })

  it('formata omissão com motivo e sem motivo', () => {
    const withReason = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'escala_omitida',
      old_value: 'VITÓRIA', new_value: 'SANTOS', justification: 'congestionamento portuário',
      changed_at: '2026-07-16T11:00:00Z',
    }] })
    const withoutReason = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'escala_omitida',
      old_value: 'VITÓRIA', new_value: 'SANTOS', justification: 'Omissao de escala',
      changed_at: '2026-07-16T11:00:00Z',
    }] })

    expect(withReason[0].title).toBe('Escala de VITÓRIA omitida · Porto de Transbordo — SANTOS · motivo: congestionamento portuário')
    expect(withoutReason[0].title).toBe('Escala de VITÓRIA omitida · Porto de Transbordo — SANTOS')
  })

  it('mostra complementação do registro global', () => {
    const events = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'transshipment_info',
      old_value: null, new_value: 'Informacoes de Transbordo complementadas',
      changed_at: '2026-07-16T12:00:00Z',
    }] })

    expect(events[0].title).toBe('Informações de Transbordo complementadas')
  })

  it('não emite cobertura de CE para valores numéricos não comparáveis', () => {
    const events = buildVoyageTimeline({
      ceCoverage: { filled: Number.NaN, total: Number.NaN },
      importBatches: [{
        id: 1,
        filename: 'manifesto.edi',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
      }],
    })

    expect(events.some((event) => event.kind === 'ce-coverage')).toBe(false)
  })
})

describe('fallback de importaÃ§Ã£o de B/L', () => {
  it('exibe contagem e rota do lote quando os B/Ls ainda nÃ£o estÃ£o carregados no detalhe', () => {
    const events = buildVoyageTimeline({
      importBatches: [{
        id: 11,
        filename: 'bl.xlsx',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
        total_bls: 7,
        route: 'BRSSZ â†’ BRVIX',
      }],
    })

    const event = events.find((item) => item.kind === 'import')
    expect(event?.title).toContain('7 B/Ls importados')
    expect(event?.title).toContain('BRSSZ')
    expect(event?.title).toContain('BRVIX')
    expect(event?.detail).toContain('CNTR')
  })
})
