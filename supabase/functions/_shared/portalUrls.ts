export const DEFAULT_PORTAL_URL = 'https://portalfwlog.com.br'
export const DEFAULT_PORTAL_SUPPORT_EMAIL = 'suporte@portalfwlog.com.br'

interface DenoGlobal {
  env: {
    get(key: string): string | undefined
  }
}

function getDenoEnv(key: string): string | undefined {
  const deno = (globalThis as unknown as { Deno?: DenoGlobal }).Deno
  return deno?.env?.get(key)
}

/**
 * Retorna a origem canônica do Portal Fwlog (esquema + host, sem /portal nem barra final),
 * apropriada para carregar assets estáticos (ex: /branding/tr-logo.png) ou compor URLs base.
 */
export function canonicalPortalOrigin(): string {
  const envUrl = getDenoEnv('PORTAL_URL')
  const raw = (envUrl ?? DEFAULT_PORTAL_URL).trim().replace(/\/+$/, '')
  const base = raw || DEFAULT_PORTAL_URL
  return base.replace(/\/portal(?:\/.*)?$/, '')
}

/**
 * Normaliza e constrói URLs canônicas para o Portal Fwlog.
 * Garante que caminhos nunca fiquem relativos (o que quebraria links em clientes de e-mail),
 * remove barras duplicadas e garante o prefixo canônico /portal.
 */
export function canonicalPortalUrl(subpath = ''): string {
  const domain = canonicalPortalOrigin()
  const cleanSub = subpath.replace(/^\/portal/, '').replace(/^\//, '')
  return cleanSub ? `${domain}/portal/${cleanSub}` : `${domain}/portal`
}

export function portalSupportEmail(): string {
  const email = getDenoEnv('PORTAL_SUPPORT_EMAIL')
  return (email ?? DEFAULT_PORTAL_SUPPORT_EMAIL).trim() || DEFAULT_PORTAL_SUPPORT_EMAIL
}
