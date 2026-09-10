import { describe, expect, it } from 'vitest'
import { messagesToImportIssues, rowErrorsToImportIssues } from '../importValidation'

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

  it('preserva erro e aviso textuais sem misturar mensagens ao raw', () => {
    expect(messagesToImportIssues(['não encontrado'], 'error', { row: 4, field: 'document' })).toEqual([
      { row: 4, field: 'document', code: 'invalid_group', severity: 'error', message: 'não encontrado' },
    ])
    expect(messagesToImportIssues(['confira'], 'warning', { row: 1, field: 'document' })).toEqual([
      { row: 1, field: 'document', code: 'invalid_group', severity: 'warning', message: 'confira' },
    ])
  })
})
