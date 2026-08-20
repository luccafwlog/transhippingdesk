import { describe, expect, it } from 'vitest'
import { agencyReportAlertLink, formatAgencyReportAlertEntity } from '../alerts'

describe('formatAgencyReportAlertEntity', () => {
  it('formata voyageId::porto::departamento (migration 225) para leitura humana', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::equipamentos')).toBe('Viagem 10 · BRVIX · Equipamentos')
    expect(formatAgencyReportAlertEntity('10::BRVIX::documentacao')).toBe('Viagem 10 · BRVIX · Documentação')
  })

  it('ainda formata voyageId::porto::secao de alertas legados (pre-0029)', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::vazios_embarcados')).toBe('Viagem 10 · BRVIX · Embarque de vazios')
    expect(formatAgencyReportAlertEntity('10::BRVIX::ocorrencias')).toBe('Viagem 10 · BRVIX · Ocorrências')
  })

  it('formata a chave terminalizada voyageId::porto::terminal::departamento', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::TVV::equipamentos')).toBe('Viagem 10 · BRVIX · Terminal TVV · Equipamentos')
  })

  it('formata os agregados novos sem departamento no entity_id', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX')).toBe('Viagem 10 · BRVIX')
    expect(formatAgencyReportAlertEntity('10::BRVIX::TVV')).toBe('Viagem 10 · BRVIX · Terminal TVV')
  })

  it('gera o deep-link compartilhado do ADR e preserva o report_id terminalizado', () => {
    expect(agencyReportAlertLink('10::BRVIX')).toBe('/viagens/10?tab=adr&escala=BRVIX')
    expect(agencyReportAlertLink('10::BRVIX::TVV', { report_id: 'report-10' })).toBe('/viagens/10?tab=adr&escala=BRVIX&terminal=TVV&report=report-10')
    expect(agencyReportAlertLink('10::BRVIX::TVV::documentacao')).toBe('/viagens/10?tab=adr&escala=BRVIX&terminal=TVV')
  })

  // Seções aposentadas seguem legíveis na página Alertas: 'ocorrencias' saiu na
  // ADR 0030 e 'operacao_patio' na 0036, mas os alertas e audit_logs gravados
  // antes disso continuam existindo.
  it('formata a seção operacao_patio, aposentada pela ADR 0036', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::operacao_patio')).toBe('Viagem 10 · BRVIX · Operação de pátio')
  })

  it('cai para null quando o formato não é o composto do ADR', () => {
    expect(formatAgencyReportAlertEntity('qualquer-coisa')).toBeNull()
    expect(formatAgencyReportAlertEntity('')).toBeNull()
  })
})
