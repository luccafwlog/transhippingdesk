import { describe, expect, it } from 'vitest'
import { alertEntityLink, alertEntityLinkLabel, formatAlertEntity } from '../alerts'

describe('alertEntityLink & alertEntityLinkLabel — roteador de destino compartilhado', () => {
  it('roteia entidade customer para o portal do cliente', () => {
    const link = alertEntityLink({
      type: 'portal_pendencia_geral',
      entity_type: 'customer',
      entity_id: 'cust-123',
    })
    expect(link).toBe('/clientes/portal?cliente=cust-123')
    expect(alertEntityLinkLabel({ type: 'portal_pendencia_geral', entity_type: 'customer' })).toBe('Abrir Portal')
  })

  it('roteia customer mesmo sem prefixo portal_', () => {
    const link = alertEntityLink({
      type: 'demurrage',
      entity_type: 'customer',
      entity_id: 'cust-456',
    })
    expect(link).toBe('/clientes/portal?cliente=cust-456')
  })

  it('roteia voyage_pod_schedule com escala', () => {
    const link = alertEntityLink({
      type: 'voyage_schedule_date_pending',
      entity_type: 'voyage_pod_schedule',
      entity_id: '100::BRSSZ',
    })
    expect(link).toBe('/viagens/100?escala=BRSSZ')
    expect(alertEntityLinkLabel({ type: 'voyage_schedule_date_pending', entity_type: 'voyage_pod_schedule' })).toBe('Abrir Viagem')
  })

  it('roteia voyage_escala_terminal com escala e terminal', () => {
    const link = alertEntityLink({
      type: 'voyage_terminal_date_pending',
      entity_type: 'voyage_escala_terminal',
      entity_id: '100::BRSSZ::BTP',
    })
    expect(link).toBe('/viagens/100?escala=BRSSZ&terminal=BTP')
    expect(alertEntityLinkLabel({ type: 'voyage_terminal_date_pending', entity_type: 'voyage_escala_terminal' })).toBe('Abrir Viagem')
  })

  it('roteia agency_departure_report terminalizado e legado com query params', () => {
    const linkLegacy = alertEntityLink({
      type: 'agency_report_department_pending',
      entity_type: 'agency_departure_report',
      entity_id: '10::BRVIX::documentacao',
    })
    expect(linkLegacy).toBe('/viagens/10?tab=adr&escala=BRVIX')

    const linkTerminalized = alertEntityLink({
      type: 'agency_report_department_pending',
      entity_type: 'agency_departure_report',
      entity_id: '10::BRVIX::TVV::documentacao',
      metadata: { report_id: 'rep-99' },
    })
    expect(linkTerminalized).toBe('/viagens/10?tab=adr&escala=BRVIX&terminal=TVV&report=rep-99')
  })

  it('roteia dispute de demurrage quando dispute_id está no metadata', () => {
    const link = alertEntityLink({
      type: 'portal_dispute_opened',
      entity_type: 'demurrage_invoice',
      entity_id: 'inv-1',
      metadata: { dispute_id: 42 },
    })
    expect(link).toBe('/demurrage?dispute=42')
  })

  it('roteia pix_transaction para reconciliacao', () => {
    const link = alertEntityLink({
      type: 'pix_unreconciled',
      entity_type: 'pix_transaction',
      entity_id: 'tx-123',
    })
    expect(link).toBe('/reconciliacao')
  })

  it('rebaixa destination a fallback quando o roteador não deriva rota', () => {
    const fallbackLink = alertEntityLink({
      type: 'unknown_type',
      entity_type: null,
      entity_id: null,
      destination: '/fallback-route',
    })
    expect(fallbackLink).toBe('/fallback-route')
  })

  it('formata adequadamente o label de exibição de entidades conhecidas', () => {
    expect(formatAlertEntity('customer', '123')).toBe('Cliente 123')
    expect(formatAlertEntity('bl', 'BL001')).toBe('B/L BL001')
    expect(formatAlertEntity('voyage_pod_schedule', '50::BRSSZ')).toBe('Viagem 50 · Escala BRSSZ')
    expect(formatAlertEntity('voyage_escala_terminal', '50::BRSSZ::DPW')).toBe('Viagem 50 · BRSSZ · Terminal DPW')
  })
})
