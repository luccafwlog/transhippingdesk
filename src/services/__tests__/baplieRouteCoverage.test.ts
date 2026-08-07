import { describe, expect, it } from 'vitest'
import { hasCompleteBaplieRouteCoverage } from '../baplieReconciliation'

describe('cobertura de rotas EDI antes da conciliação', () => {
  const ediRoutes = [
    { pol: 'NANSHA', pod: 'BRVIX' },
    { pol: 'NANSHA', pod: 'BRSSZ' },
    { pol: 'SHANGHAI', pod: 'BRVIX' },
  ]

  it('aguarda até a última rota ter pelo menos um BL', () => {
    expect(hasCompleteBaplieRouteCoverage(ediRoutes, [])).toBe(false)
    expect(hasCompleteBaplieRouteCoverage(ediRoutes, [ediRoutes[0], ediRoutes[1]])).toBe(false)
    expect(hasCompleteBaplieRouteCoverage(ediRoutes, ediRoutes)).toBe(true)
  })

  it('normaliza maiúsculas e espaços sem confundir rotas', () => {
    expect(hasCompleteBaplieRouteCoverage([{ pol: ' nansha ', pod: 'brvix' }], [{ pol: 'NANSHA', pod: 'BRVIX' }])).toBe(true)
  })
})
