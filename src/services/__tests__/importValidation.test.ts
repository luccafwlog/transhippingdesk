import { describe, expect, it } from 'vitest'
import {
  IsoDateSchema,
  isValidCalendarDate,
  rowErrorsToImportIssues,
} from '../importValidation'

describe('adaptação segura dos relatórios de importação', () => {
  it('converte erros de linha sem carregar o raw para o relatório', () => {
    const issues = rowErrorsToImportIssues([
      { row: 2, message: 'Container ABC123: formato ISO esperado.', raw: { email: 'operador@example.com' } },
      { row: 3, message: 'POL XYZ não reconhecido como LOCODE.', raw: { documento: 'confidencial' } },
    ])

    expect(issues).toEqual([
      {
        row: 2,
        field: 'container_number',
        code: 'invalid_iso',
        severity: 'error',
        message: 'Container ABC123: formato ISO esperado.',
      },
      {
        row: 3,
        field: 'pol',
        code: 'unknown_port',
        severity: 'error',
        message: 'POL XYZ não reconhecido como LOCODE.',
      },
    ])
    expect(issues[0]).not.toHaveProperty('raw')
  })

  it('valida datas de calendário reais e rejeita dias/meses inválidos', () => {
    expect(isValidCalendarDate('2026-01-31')).toBe(true)
    expect(isValidCalendarDate('2024-02-29')).toBe(true) // bissexto válido
    expect(isValidCalendarDate('2025-02-29')).toBe(false) // não bissexto
    expect(isValidCalendarDate('2026-02-31')).toBe(false) // dia inexistente
    expect(isValidCalendarDate('2026-04-31')).toBe(false) // abril tem 30 dias
    expect(isValidCalendarDate('2026-13-01')).toBe(false) // mês inválido
    expect(isValidCalendarDate('0001-01-01')).toBe(true) // Date.UTC trata anos 1–99 como 1901–1999
  })

  it('IsoDateSchema valida formato e calendário', () => {
    expect(IsoDateSchema.safeParse('2026-05-15').success).toBe(true)
    expect(IsoDateSchema.safeParse('2026-02-31').success).toBe(false)
    expect(IsoDateSchema.safeParse('15/05/2026').success).toBe(false)
    expect(IsoDateSchema.safeParse('not-a-date').success).toBe(false)
  })
})
