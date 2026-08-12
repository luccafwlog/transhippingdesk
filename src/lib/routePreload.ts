import { matchPath } from 'react-router-dom'

export type RoutePreloadTable = Array<[string, () => void]>

export function matchRoutePreload(pathname: string, table: RoutePreloadTable) {
  return table.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname))?.[1]
}
