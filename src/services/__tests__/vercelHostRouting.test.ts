import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Route = {
  src?: string
  dest?: string
  handle?: string
  has?: Array<{ type?: string; value?: string }>
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const vercelConfig = JSON.parse(readFileSync(path.join(repositoryRoot, 'vercel.json'), 'utf8')) as {
  routes?: Route[]
  rewrites?: unknown[]
}

const routeMatches = (route: Route, host: string, pathname: string) => {
  const hostMatcher = route.has?.find((condition) => condition.type === 'host')?.value
  return Boolean(
    route.src &&
      hostMatcher &&
      new RegExp(route.src).test(pathname) &&
      new RegExp(hostMatcher).test(host),
  )
}

describe('roteamento por hostname no Vercel', () => {
  it('seleciona a entrada correta antes da precedência do filesystem', () => {
    const routes = vercelConfig.routes ?? []
    const internalHost = 'vela-git-claude-dreamy-keller-cyegz4-luccafwlogs-projects.vercel.app'
    const portalHost = 'fwlog-portal-e7j6ij3x8-luccafwlogs-projects.vercel.app'

    expect(vercelConfig.rewrites).toBeUndefined()
    expect(routes.some((route) => route.handle === 'filesystem')).toBe(true)
    expect(
      routes.some(
        (route) => route.dest === '/index.html' && routeMatches(route, internalHost, '/'),
      ),
    ).toBe(true)
    expect(
      routes.some(
        (route) => route.dest === '/portal.html' && routeMatches(route, portalHost, '/'),
      ),
    ).toBe(true)
    expect(
      routes.some(
        (route) => route.dest === '/portal.html' && routeMatches(route, portalHost, '/portal/login'),
      ),
    ).toBe(true)
    expect(
      routes.some(
        (route) => route.dest === '/index.html' && routeMatches(route, internalHost, '/clientes'),
      ),
    ).toBe(true)
  })
})
