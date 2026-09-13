import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (relativePath: string) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('fronteiras dos builds Vela e FWLog', () => {
  it('declara duas entradas HTML, React e roteador independentes', () => {
    for (const relativePath of [
      'portal.html',
      'src/portal-main.tsx',
      'src/AppInterno.tsx',
      'src/AppPortal.tsx',
      'src/components/PortalErrorBoundary.tsx',
      'src/lib/portalQueryClient.ts',
      'public/portal.webmanifest',
    ]) {
      expect(existsSync(path.join(repositoryRoot, relativePath)), relativePath).toBe(true)
    }

    expect(read('index.html')).toContain('/src/main.tsx')
    expect(read('portal.html')).toContain('/src/portal-main.tsx')
    expect(read('src/main.tsx')).not.toContain('PortalAuthProvider')
    expect(read('src/portal-main.tsx')).not.toContain("from './hooks/useAuth'")
    expect(read('src/portal-main.tsx')).toContain("from './components/PortalErrorBoundary'")
    expect(read('src/portal-main.tsx')).toContain("from './lib/portalQueryClient'")
    expect(read('src/portal-main.tsx')).not.toContain("from './components/ErrorBoundary'")
    expect(read('src/portal-main.tsx')).not.toContain("from './lib/queryClient'")
  })

  it('não inclui rotas da outra superfície em cada mapa de rotas', () => {
    const internalRoutes = read('src/AppInterno.tsx')
    const portalRoutes = read('src/AppPortal.tsx')

    expect(internalRoutes).toContain('path="/painel"')
    expect(internalRoutes).not.toContain('path="/portal/login"')
    expect(portalRoutes).toContain('path="/portal/login"')
    expect(portalRoutes).not.toContain('path="/painel"')
    expect(portalRoutes).not.toContain('path="/admin"')
  })
})
