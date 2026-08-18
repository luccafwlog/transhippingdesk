import { describe, expect, it } from 'vitest'
import { resolveLegacyFaturamentoRedirect, resolveTaxasLocaisRedirect, toRouteTarget } from '../routeRedirects'

describe('redirects de rotas financeiras', () => {
  it.each([
    ['?invoice=73', '/taxas-locais?invoice=73'],
    ['?tab=pendencias&invoice=73', '/taxas-locais?tab=pendencias&invoice=73'],
  ])('mantém a query ao levar %s para a operação de Taxas Locais', (search, expected) => {
    expect(toRouteTarget(resolveLegacyFaturamentoRedirect(search))).toBe(expected)
  })

  it('consome tab=demurrage e preserva os demais parâmetros', () => {
    expect(toRouteTarget(resolveLegacyFaturamentoRedirect('?tab=demurrage&invoice=73&cliente=ACME')))
      .toBe('/demurrage?invoice=73&cliente=ACME')
  })

  it.each(['overrides', 'tabelas'])('leva o deep link %s para a sub-rota preservando a query', (tab) => {
    const search = `?tab=${tab}&cliente=ACME%20EXPORTS`
    expect(toRouteTarget(resolveTaxasLocaisRedirect(search)!)).toBe(`/taxas-locais/tabelas${search}`)
  })

  it('não redireciona a rota pai sem uma aba de cadastro', () => {
    expect(resolveTaxasLocaisRedirect('?tab=pendencias&invoice=73')).toBeNull()
  })
})
