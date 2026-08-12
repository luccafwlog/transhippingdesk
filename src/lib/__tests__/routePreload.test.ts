import { describe, expect, it, vi } from 'vitest'
import { matchRoutePreload } from '../routePreload'

describe('matchRoutePreload', () => {
  it('matches static and parameterized paths', () => {
    const staticLoad = vi.fn()
    const paramLoad = vi.fn()
    expect(matchRoutePreload('/painel', [['/painel', staticLoad]])).toBe(staticLoad)
    expect(matchRoutePreload('/viagens/42', [['/viagens/:voyageId', paramLoad]])).toBe(paramLoad)
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
