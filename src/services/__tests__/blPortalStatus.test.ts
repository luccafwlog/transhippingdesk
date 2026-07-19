import { describe, expect, it } from 'vitest'
import { computeBlPortalVisibility } from '../blPortalStatus'

describe('computeBlPortalVisibility', () => {
  it('visivel quando ha CE, cliente e conta ativa', () => {
    expect(computeBlPortalVisibility({ ceMercante: '123456789012345', customerId: 1, accountSituation: 'ativo' })).toEqual({ visible: true, reasons: [] })
  })
  it('lista todos os motivos do bloqueio', () => {
    expect(computeBlPortalVisibility({ ceMercante: null, customerId: null, accountSituation: null }).reasons).toEqual(['Sem CE Mercante', 'Sem cliente vinculado', 'Cliente sem Conta de Portal ativa'])
  })
  it('conta suspensa bloqueia', () => {
    expect(computeBlPortalVisibility({ ceMercante: 'x', customerId: 1, accountSituation: 'suspenso' }).visible).toBe(false)
  })
})
