import { describe, expect, it } from 'vitest'
import { formatAgencyReportAlertEntity } from '../alerts'

describe('formatAgencyReportAlertEntity', () => {
  it('formata voyageId::porto::departamento (migration 225) para leitura humana', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::equipamentos')).toBe('Viagem 10 · BRVIX · Equipamentos')
    expect(formatAgencyReportAlertEntity('10::BRVIX::documentacao')).toBe('Viagem 10 · BRVIX · Documentação')
  })

  it('ainda formata voyageId::porto::secao de alertas legados (pre-0029)', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::vazios_embarcados')).toBe('Viagem 10 · BRVIX · Vazios embarcados')
    expect(formatAgencyReportAlertEntity('10::BRVIX::ocorrencias')).toBe('Viagem 10 · BRVIX · Ocorrências')
  })

  it('cai para null quando o formato não é o composto do ADR', () => {
    expect(formatAgencyReportAlertEntity('qualquer-coisa')).toBeNull()
    expect(formatAgencyReportAlertEntity('')).toBeNull()
  })
})
