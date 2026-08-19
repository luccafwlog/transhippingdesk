import { describe, expect, it } from 'vitest'
import { buildVoyageTimeline } from '../voyageSummaries'

describe('timeline operacional de transbordo', () => {
  it('humaniza alterações de frentes e datas terminalizadas', () => {
    const events = buildVoyageTimeline({
      scheduleEvents: [
        { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', field_name: 'front_created', old_value: null, new_value: JSON.stringify({ modalidade: 'granito', terminal_id: 'terminal-1' }), changed_at: '2026-08-18T10:00:00Z' },
        { entity_type: 'voyage_pod_schedule', entity_id: '9::BRVIX', field_name: 'terminal_dates', old_value: null, new_value: JSON.stringify({ terminal_atb: '2026-08-20' }), changed_at: '2026-08-18T11:00:00Z' },
      ],
    })
    expect(events.map((event) => event.kind)).toEqual(['escala-terminal', 'escala-terminal'])
    expect(events.find((event) => event.title.includes('Frente granito'))?.title).toContain('Frente granito atribuída')
    expect(events.find((event) => event.title.includes('Datas do terminal'))?.title).toContain('Datas do terminal alteradas')
    expect(events.find((event) => event.title.includes('Frente granito'))?.detail).not.toContain('terminal-1')
  })

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

  it('exibe a correção como evento próprio após reverter uma omissão', () => {
    const events = buildVoyageTimeline({ auditEvents: [{
      entity_type: 'voyage', entity_id: '2', field_name: 'omissao_revertida',
      old_value: 'VITÓRIA', new_value: 'SANTOS', justification: 'POD informado incorretamente',
      changed_at: '2026-07-16T12:00:00Z',
    }] })

    expect(events[0].kind).toBe('omission')
    expect(events[0].title).toContain('Omissão de VITÓRIA revertida')
    expect(events[0].title).toContain('correção')
    expect(events[0].detail).toContain('Correção de omissão')
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

describe('fallback de importação de B/L', () => {
  it('exibe contagem e rota do lote quando os B/Ls ainda não estão carregados no detalhe', () => {
    const events = buildVoyageTimeline({
      importBatches: [{
        id: 11,
        filename: 'bl.xlsx',
        cargo_mode: 'container',
        uploaded_at: '2026-07-16T10:00:00Z',
        total_bls: 7,
        route: 'BRSSZ → BRVIX',
      }],
    })

    const event = events.find((item) => item.kind === 'import')
    expect(event?.title).toContain('7 B/Ls importados')
    expect(event?.title).toContain('BRSSZ')
    expect(event?.title).toContain('BRVIX')
    expect(event?.detail).toContain('CNTR')
  })

  it('mostra nome e setor do usuário que alterou o evento, congelado no próprio evento', () => {
    const events = buildVoyageTimeline({
      actorNames: { 'user-1': 'Ana Ribeiro' },
      auditEvents: [{
        entity_type: 'voyage', entity_id: '2', field_name: 'status',
        old_value: null, new_value: 'planning', changed_by: 'user-1', actor_role: 'operacoes',
        changed_at: '2026-07-16T12:00:00Z',
      }],
    })

    expect(events[0].detail).toContain('por Ana Ribeiro (Operações)')
  })

  it('não mistura o setor de um evento mais antigo do mesmo usuário', () => {
    const events = buildVoyageTimeline({
      actorNames: { 'user-1': 'Ana Ribeiro' },
      auditEvents: [
        {
          entity_type: 'voyage', entity_id: '2', field_name: 'status',
          old_value: null, new_value: 'planning', changed_by: 'user-1', actor_role: 'operacoes',
          changed_at: '2026-07-16T12:00:00Z',
        },
        {
          entity_type: 'voyage', entity_id: '2', field_name: 'voyage_number',
          old_value: null, new_value: '001', changed_by: 'user-1', actor_role: 'financeiro',
          changed_at: '2026-01-01T09:00:00Z',
        },
      ],
    })

    expect(events.some((event) => event.detail.includes('por Ana Ribeiro (Operações)'))).toBe(true)
    expect(events.some((event) => event.detail.includes('por Ana Ribeiro (Financeiro)'))).toBe(true)
  })
})
