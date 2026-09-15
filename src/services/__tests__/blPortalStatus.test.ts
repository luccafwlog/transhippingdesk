import { describe, expect, it } from 'vitest'
import { computeBlPortalVisibility } from '../blPortalStatus'

describe('computeBlPortalVisibility', () => {
  it('visivel quando ha CE, cliente e prontidao canonica do Portal', () => {
    expect(computeBlPortalVisibility({ ceMercante: '123456789012345', customerId: 1, accountSituation: 'ativo', portalAccessReady: true })).toEqual({ visible: true, reasons: [] })
  })
  it('lista todos os motivos do bloqueio', () => {
    expect(computeBlPortalVisibility({ ceMercante: null, customerId: null, accountSituation: null, portalAccessReady: false }).reasons).toEqual(['Sem CE Mercante', 'Sem cliente vinculado', 'Conta do Portal não está ativa/provisionada'])
  })
  it('bloqueia mesmo com account_situation ativo quando a prontidao canonica e falsa', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'ativo', portalAccessReady: false })).toEqual({
      visible: false,
      reasons: ['Conta do Portal não está ativa/provisionada'],
    })
  })
  it('trata CE com apenas espacos como ausente', () => {
    expect(computeBlPortalVisibility({ ceMercante: '   ', customerId: 1, accountSituation: 'ativo', portalAccessReady: true })).toEqual({
      visible: false,
      reasons: ['Sem CE Mercante'],
    })
  })
  it('falha fechado quando a resposta ainda nao traz a prontidao canonica', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'ativo' })).toEqual({
      visible: false,
      reasons: ['Conta do Portal não está ativa/provisionada'],
    })
  })
})
