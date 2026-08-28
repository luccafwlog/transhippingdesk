import { describe, expect, it } from 'vitest'
import { computeBaplieRouteCoverage, hasCompleteBaplieRouteCoverage } from '../baplieReconciliation'

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

  it('normaliza variações e apelidos de portos como Taicang (CNTAC / CNTAI / CNTAG / TAIKANG)', () => {
    expect(hasCompleteBaplieRouteCoverage(
      [{ pol: 'CNTAG', pod: 'BRVIX' }, { pol: 'QINGDAO', pod: 'BRVIX' }],
      [{ pol: 'CNTAC', pod: 'BRVIX' }, { pol: 'CNTAO', pod: 'BRVIX' }],
    )).toBe(true)
    expect(hasCompleteBaplieRouteCoverage(
      [{ pol: 'CNTAI', pod: 'BRVIX' }],
      [{ pol: 'TAICANG', pod: 'BRVIX' }],
    )).toBe(true)
  })

  it('ignora rotas de containers vazios na verificação de B/L quando filtradas', () => {
    const stagedWithEmpty = [
      { pol: 'CNSHA', pod: 'BRVIX', status: 'full' },
      { pol: 'CNTAC', pod: 'BRVIX', status: 'empty' },
    ]
    const fullOnly = stagedWithEmpty.filter((c) => c.status !== 'empty')
    // A rota vazia (CNTAC) não tem BL comercial; como filtramos fullOnly, deve dar coberta apenas com CNSHA
    expect(hasCompleteBaplieRouteCoverage(fullOnly, [{ pol: 'CNSHA', pod: 'BRVIX' }])).toBe(true)
  })
})

describe('cobertura POR ROTA (gate por rota, #604)', () => {
  it('trata Zhoushan (CNZOS) do Baplie como Ningbo (CNNGB) do B/L — mesmo complexo portuário', () => {
    const { covered, pending } = computeBaplieRouteCoverage(
      [{ pol: 'CNZOS', pod: 'BRVIX' }],
      [{ pol: 'CNNGB', pod: 'BRVIX' }],
    )
    expect([...covered]).toEqual(['CNNGB::BRVIX'])
    expect(pending).toEqual([])
  })

  it('concilia as rotas cobertas e deixa pendente apenas a rota sem B/L', () => {
    const { covered, pending } = computeBaplieRouteCoverage(
      [
        { pol: 'CNTAC', pod: 'BRVIX' },
        { pol: 'CNTAO', pod: 'BRVIX' },
        { pol: 'CNSHA', pod: 'BRVIX' },
      ],
      [
        { pol: 'CNTAC', pod: 'BRVIX' },
        { pol: 'CNTAO', pod: 'BRVIX' },
      ],
    )
    expect([...covered].sort()).toEqual(['CNTAC::BRVIX', 'CNTAO::BRVIX'])
    expect(pending).toEqual(['CNSHA::BRVIX'])
  })

  it('B/L sem containers não cobre rota: o chamador filtra e a rota segue pendente', () => {
    // reconcileBaplieWithManifest só passa B/Ls com containers; aqui a lista chega vazia.
    const { covered, pending } = computeBaplieRouteCoverage([{ pol: 'CNTAC', pod: 'BRVIX' }], [])
    expect(covered.size).toBe(0)
    expect(pending).toEqual(['CNTAC::BRVIX'])
  })
})
