import { describe, expect, it } from 'vitest'

import { routeTitle } from '../pageTitle'

describe('routeTitle (WCAG 2.4.2 — título por rota)', () => {
  it('antepõe o nome da tela e mantém o sufixo do produto', () => {
    expect(routeTitle('/painel')).toBe('Painel · Transhipping Desk')
    expect(routeTitle('/taxas-locais')).toBe('Taxas Locais · Transhipping Desk')
    expect(routeTitle('/taxas-locais/tabelas')).toBe('Tabelas de Taxas Locais · Transhipping Desk')
    expect(routeTitle('/faturamento')).toBe('Transhipping Desk')
  })

  it('prioriza rotas específicas sobre genéricas', () => {
    expect(routeTitle('/demurrage/taxas')).toBe('Tarifas de Demurrage · Transhipping Desk')
    expect(routeTitle('/demurrage')).toBe('Demurrage · Transhipping Desk')
    expect(routeTitle('/manifestos/COSU6401234501')).toBe('Detalhe do B/L · Transhipping Desk')
    expect(routeTitle('/manifestos')).toBe('BLs CNTR · Transhipping Desk')
    expect(routeTitle('/clientes/12.345.678/0001-90')).toBe('Ficha do Cliente · Transhipping Desk')
  })

  it('distingue portal de app interno', () => {
    expect(routeTitle('/portal')).toBe('Portal · Painel · Transhipping Desk')
    expect(routeTitle('/portal/billing')).toBe('Portal · Faturas · Transhipping Desk')
  })

  it('cai no nome do produto para rota desconhecida', () => {
    expect(routeTitle('/rota-inexistente')).toBe('Transhipping Desk')
  })
})
