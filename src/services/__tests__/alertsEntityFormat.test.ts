import { describe, expect, it } from 'vitest'
import { formatAgencyReportAlertEntity } from '../alerts'

describe('formatAgencyReportAlertEntity', () => {
  it('formata voyageId::porto::secao para leitura humana', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::vazios_embarcados')).toBe('Viagem 10 · BRVIX · Vazios embarcados')
    expect(formatAgencyReportAlertEntity('10::BRVIX::ocorrencias')).toBe('Viagem 10 · BRVIX · Ocorrências')
  })

  it('cai para null quando o formato não é o composto do ADR', () => {
    expect(formatAgencyReportAlertEntity('qualquer-coisa')).toBeNull()
    expect(formatAgencyReportAlertEntity('')).toBeNull()
  })
})
