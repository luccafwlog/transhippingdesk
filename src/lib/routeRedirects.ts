export type RouteTarget = {
  pathname: string
  search: string
}

function withSearch(pathname: string, params: URLSearchParams): RouteTarget {
  const query = params.toString()
  return { pathname, search: query ? `?${query}` : '' }
}

/** Resolve the legacy billing URL without losing its query string. */
export function resolveLegacyFaturamentoRedirect(search: string): RouteTarget {
  const params = new URLSearchParams(search)
  if (params.get('tab') === 'demurrage') {
    params.delete('tab')
    return withSearch('/demurrage', params)
  }

  return { pathname: '/taxas-locais', search }
}

/** Keep table/override deep links on the table-cadastro sub-route. */
export function resolveTaxasLocaisRedirect(search: string): RouteTarget | null {
  const tab = new URLSearchParams(search).get('tab')
  if (tab !== 'overrides' && tab !== 'tabelas') return null

  return { pathname: '/taxas-locais/tabelas', search }
}

export function toRouteTarget(target: RouteTarget): string {
  return `${target.pathname}${target.search}`
}
