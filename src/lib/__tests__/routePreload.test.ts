import { describe, expect, it, vi } from 'vitest'
import { matchRoutePreload } from '../routePreload'

describe('matchRoutePreload', () => {
  it('matches static and parameterized paths', () => {
    const staticLoad = vi.fn()
    const paramLoad = vi.fn()
    expect(matchRoutePreload('/painel', [['/painel', staticLoad]])).toBe(staticLoad)
    expect(matchRoutePreload('/viagens/42', [['/viagens/:voyageId', paramLoad]])).toBe(paramLoad)
  })

  it('requires an exact entry for the local-charge tables sub-route', () => {
    const tablesLoad = vi.fn()
    const operationLoad = vi.fn()
    const fallbackLoad = vi.fn()
    const table: Parameters<typeof matchRoutePreload>[1] = [
      ['/taxas-locais/tabelas', tablesLoad],
      ['/taxas-locais', operationLoad],
      ['*', fallbackLoad],
    ]

    expect(matchRoutePreload('/taxas-locais/tabelas', table)).toBe(tablesLoad)
    expect(matchRoutePreload('/taxas-locais', table)).toBe(operationLoad)
    expect(matchRoutePreload('/taxas-locais/tabelas/extra', table)).toBe(fallbackLoad)
  })

  it('returns undefined for an unknown path', () => {
    expect(matchRoutePreload('/nao-existe', [['/painel', vi.fn()]])).toBeUndefined()
  })

  it('matches root and wildcard fallback entries, root taking priority', () => {
    const rootLoad = vi.fn()
    const wildcardLoad = vi.fn()
    const table: Parameters<typeof matchRoutePreload>[1] = [
      ['/', rootLoad],
      ['*', wildcardLoad],
    ]
    expect(matchRoutePreload('/', table)).toBe(rootLoad)
    expect(matchRoutePreload('/rota-desconhecida', table)).toBe(wildcardLoad)
  })
})
