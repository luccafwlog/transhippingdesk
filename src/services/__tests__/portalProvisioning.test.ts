import { describe, expect, it } from 'vitest'
import { effectiveSituation } from '../portalProvisioning'

describe('effectiveSituation', () => {
  it('rebaixa convite pendente vencido na leitura', () => {
    expect(effectiveSituation('convite_pendente', new Date(Date.now() - 60_000).toISOString())).toBe('convite_expirado')
  })
  it('mantém convite pendente dentro do prazo', () => {
    expect(effectiveSituation('convite_pendente', new Date(Date.now() + 60_000).toISOString())).toBe('convite_pendente')
  })
  it('não altera demais situações', () => {
    expect(effectiveSituation('ativo', null)).toBe('ativo')
    expect(effectiveSituation('sem_conta', null)).toBe('sem_conta')
  })
})
