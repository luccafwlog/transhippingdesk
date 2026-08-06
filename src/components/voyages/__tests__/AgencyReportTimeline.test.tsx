import { describe, expect, it } from 'vitest'
import { buildDepartmentTimelineRows } from '../AgencyReportTimeline'

// Testa só a função pura de mapeamento (ADR 0039): não monta o componente,
// segue a mesma convenção de agencyReportDeadline.test.ts para lógica sem UI.

describe('buildDepartmentTimelineRows', () => {
  it('sem ATD: todos os departamentos ficam sem prazo, sem cor de veredito', () => {
    const rows = buildDepartmentTimelineRows({
      atd: null,
      omitted: false,
      now: '2026-08-06T12:00:00Z',
      departmentSignoffs: [],
      departmentEvents: [],
      actorNames: {},
    })

    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.state).toBe('no-deadline')
  })

  it('escala omitida: sem prazo mesmo com ATD e assinatura presentes', () => {
    const rows = buildDepartmentTimelineRows({
      atd: '2026-08-03',
      omitted: true,
      now: '2026-08-06T12:00:00Z',
      departmentSignoffs: [{ id: 'ds-1', department: 'operacoes', signed_by: 'u1', signed_at: '2026-08-10T09:00:00Z' } as never],
      departmentEvents: [],
      actorNames: {},
    })

    const operacoes = rows.find((row) => row.department === 'operacoes')!
    expect(operacoes.state).toBe('no-deadline')
  })

  it('departamento assinado no prazo fica on-time; departamento sem assinatura e prazo vencido fica overdue', () => {
    // ATD 2026-08-03 (segunda) -> prazo 2026-08-06 (quinta).
    const rows = buildDepartmentTimelineRows({
      atd: '2026-08-03',
      omitted: false,
      now: '2026-08-10T12:00:00Z',
      departmentSignoffs: [
        { id: 'ds-1', department: 'operacoes', signed_by: 'u1', signed_at: '2026-08-05T09:00:00Z' } as never,
      ],
      departmentEvents: [],
      actorNames: { u1: 'Ana Ribeiro' },
    })

    const operacoes = rows.find((row) => row.department === 'operacoes')!
    expect(operacoes.state).toBe('on-time')
    expect(operacoes.signedByName).toBe('Ana Ribeiro')

    const documentacao = rows.find((row) => row.department === 'documentacao')!
    expect(documentacao.state).toBe('overdue')
    expect(documentacao.signedAt).toBeNull()
  })

  it('reabertura (new_value=false) aparece com justificativa; (re)assinatura simples (new_value=true) não vira reabertura', () => {
    const rows = buildDepartmentTimelineRows({
      atd: '2026-08-03',
      omitted: false,
      now: '2026-08-10T12:00:00Z',
      departmentSignoffs: [],
      departmentEvents: [
        {
          id: 1, department: 'equipamentos', old_value: 'true', new_value: 'false',
          justification: 'Container avariado, corrigindo contagem.', changed_by: 'u2', changed_at: '2026-08-07T10:00:00Z',
        },
        {
          id: 2, department: 'equipamentos', old_value: 'false', new_value: 'true',
          justification: null, changed_by: 'u2', changed_at: '2026-08-08T10:00:00Z',
        },
        {
          id: 3, department: 'operacoes', old_value: 'true', new_value: 'false',
          justification: 'Outro motivo', changed_by: 'u3', changed_at: '2026-08-07T11:00:00Z',
        },
      ],
      actorNames: { u2: 'Bruno Alves' },
    })

    const equipamentos = rows.find((row) => row.department === 'equipamentos')!
    expect(equipamentos.reopenings).toHaveLength(1)
    expect(equipamentos.reopenings[0]).toEqual({
      changedAt: '2026-08-07T10:00:00Z',
      changedByName: 'Bruno Alves',
      justification: 'Container avariado, corrigindo contagem.',
    })

    const operacoes = rows.find((row) => row.department === 'operacoes')!
    expect(operacoes.reopenings).toHaveLength(1)
    expect(operacoes.reopenings[0].changedByName).toBe('u3')
  })
})
