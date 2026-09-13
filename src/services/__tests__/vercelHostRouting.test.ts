import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Route = {
  source?: string
  destination?: string
  has?: Array<{ type?: string; value?: string }>
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const vercelConfig = JSON.parse(readFileSync(path.join(repositoryRoot, 'vercel.json'), 'utf8')) as {
  routes?: unknown[]
  rewrites?: Route[]
  redirects?: Route[]
}

const routeMatches = (route: Route, host: string, pathname: string) => {
  const hostMatcher = route.has?.find((condition) => condition.type === 'host')?.value
  return Boolean(
    route.source &&
    hostMatcher &&
      new RegExp(route.source).test(pathname) &&
      new RegExp(hostMatcher).test(host),
  )
}

describe('roteamento por hostname no Vercel', () => {
  it('seleciona a entrada correta e preserva o tratamento dos arquivos estáticos', () => {
    const rewrites = vercelConfig.rewrites ?? []
    const internalHost = 'vela-git-claude-dreamy-keller-cyegz4-luccafwlogs-projects.vercel.app'
    const portalHost = 'fwlog-portal-e7j6ij3x8-luccafwlogs-projects.vercel.app'

    expect(vercelConfig.routes).toBeUndefined()
    expect(
      rewrites.some(
        (route) => route.destination === '/index.html' && routeMatches(route, internalHost, '/'),
      ),
    ).toBe(true)
    expect(
      rewrites.some(
        (route) => route.destination === '/portal.html' && routeMatches(route, portalHost, '/'),
      ),
    ).toBe(true)
    expect(
      rewrites.some(
        (route) => route.destination === '/portal.html' && routeMatches(route, portalHost, '/portal/login'),
      ),
    ).toBe(true)
    expect(
      rewrites.some(
        (route) => route.destination === '/index.html' && routeMatches(route, internalHost, '/clientes'),
      ),
    ).toBe(true)

    const spaRewrite = rewrites.find(
      (route) => route.destination === '/index.html' && route.source?.includes('((?!'),
    )
    expect(spaRewrite?.source).toContain('((?!')
    expect(spaRewrite?.source).toContain('assets')
    expect(spaRewrite?.source).toContain('branding')
    expect(spaRewrite?.source).toContain('.*\\.[^/]+$')
    expect(routeMatches(spaRewrite!, internalHost, '/assets/app.js')).toBe(false)
    expect(routeMatches(spaRewrite!, internalHost, '/branding/vela.svg')).toBe(false)
    expect(routeMatches(spaRewrite!, internalHost, '/favicon.ico')).toBe(false)
  })

  it('redireciona rotas /portal acessadas no host interno Vela para o Portal Fwlog', () => {
    const redirects = vercelConfig.redirects ?? []
    const internalHost = 'vela.app.br'

    const portalRedirect = redirects.find((route) => route.source === '/portal')
    expect(portalRedirect).toBeDefined()
    expect(portalRedirect?.destination).toBe('https://portalfwlog.com.br/portal')
    expect(routeMatches(portalRedirect!, internalHost, '/portal')).toBe(true)

    const nestedRedirect = redirects.find((route) => route.source === '/portal/(.*)')
    expect(nestedRedirect).toBeDefined()
    expect(nestedRedirect?.destination).toBe('https://portalfwlog.com.br/portal/$1')
    expect(routeMatches(nestedRedirect!, internalHost, '/portal/login')).toBe(true)
  })
})
