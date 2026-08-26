import { describe, expect, it } from 'vitest'
import { agencyReportAlertLink, formatAgencyReportAlertEntity, formatAlertEntity } from '../alerts'

describe('formatAgencyReportAlertEntity', () => {
  it('formata voyageId::porto::departamento (migration 225) para leitura humana', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::equipamentos')).toBe('Viagem 10 · BRVIX · Equipamentos')
    expect(formatAgencyReportAlertEntity('10::BRVIX::documentacao')).toBe('Viagem 10 · BRVIX · Documentação')
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

  it('formata a chave terminalizada voyageId::porto::terminal::departamento', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::TVV::equipamentos')).toBe('Viagem 10 · BRVIX · Terminal TVV · Equipamentos')
  })

  it('formata a seção operacao_patio, aposentada pela ADR 0036', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::operacao_patio')).toBe('Viagem 10 · BRVIX · Operação de pátio')
  })

  it('não interpreta uma seção histórica desconhecida como terminal', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::secao_historica')).toBe('Viagem 10 · BRVIX · secao_historica')
    expect(agencyReportAlertLink('10::BRVIX::secao_historica')).toBe('/viagens/10?tab=adr&escala=BRVIX')
  })

  it('cai para null quando o formato não é o composto do ADR', () => {
    expect(formatAgencyReportAlertEntity('qualquer-coisa')).toBeNull()
    expect(formatAgencyReportAlertEntity('')).toBeNull()
  })
})

describe('formatAlertEntity', () => {
  it('formata entidades de viagem, escala e terminal', () => {
    expect(formatAlertEntity('voyage', '42')).toBe('Viagem 42')
    expect(formatAlertEntity('voyage_pod_schedule', '42::BRSSZ')).toBe('Viagem 42 · Escala BRSSZ')
    expect(formatAlertEntity('voyage_escala_terminal', '42::BRSSZ::BTP')).toBe('Viagem 42 · BRSSZ · Terminal BTP')
  })

  it('delega agency_departure_report para formatAgencyReportAlertEntity', () => {
    expect(formatAlertEntity('agency_departure_report', '10::BRVIX::equipamentos')).toBe('Viagem 10 · BRVIX · Equipamentos')
  })

  it('retorna null para tipos ou ids nulos/desconhecidos', () => {
    expect(formatAlertEntity(null, null)).toBeNull()
    expect(formatAlertEntity('desconhecido', '123')).toBeNull()
  })

  it('troca o id surrogate pelo rótulo humano quando ele foi resolvido', () => {
    const labels = {
      'voyage:42': 'MSC LUCIA / 24W',
      'invoice:7': 'FAT-2026-0007',
      'customer:3': 'Pedreira Granito Ltda',
    }

    expect(formatAlertEntity('voyage', '42', labels)).toBe('Viagem MSC LUCIA / 24W')
    expect(formatAlertEntity('voyage_pod_schedule', '42::BRSSZ', labels)).toBe('Viagem MSC LUCIA / 24W · Escala BRSSZ')
    expect(formatAlertEntity('voyage_escala_terminal', '42::BRSSZ::BTP', labels))
      .toBe('Viagem MSC LUCIA / 24W · BRSSZ · Terminal BTP')
    expect(formatAlertEntity('agency_departure_report', '42::BRVIX::equipamentos', labels))
      .toBe('Viagem MSC LUCIA / 24W · BRVIX · Equipamentos')
    expect(formatAlertEntity('invoice', '7', labels)).toBe('Fatura FAT-2026-0007')
    expect(formatAlertEntity('customer', '3', labels)).toBe('Cliente Pedreira Granito Ltda')
  })

  it('cai no id quando o rótulo daquela entidade não foi resolvido', () => {
    const labels = { 'voyage:42': 'MSC LUCIA / 24W' }

    expect(formatAlertEntity('voyage', '99', labels)).toBe('Viagem 99')
    expect(formatAlertEntity('invoice', '7', labels)).toBe('Fatura 7')
  })
})
