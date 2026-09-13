export const DEFAULT_PORTAL_URL = 'https://portalfwlog.com.br'
export const DEFAULT_PORTAL_SUPPORT_EMAIL = 'suporte@portalfwlog.com.br'

/**
 * Normaliza e constrói URLs canônicas para o Portal Fwlog.
 * Garante que caminhos nunca fiquem relativos (o que quebraria links em clientes de e-mail),
 * remove barras duplicadas e garante o prefixo canônico /portal.
 */
export function canonicalPortalUrl(subpath = ''): string {
  const envUrl = typeof Deno !== 'undefined' ? Deno.env.get('PORTAL_URL') : undefined
  const raw = (envUrl ?? DEFAULT_PORTAL_URL).trim().replace(/\/+$/, '')
  const base = raw || DEFAULT_PORTAL_URL
  const domain = base.replace(/\/portal(?:\/billing)?$/, '')
  const cleanSub = subpath.replace(/^\/portal/, '').replace(/^\//, '')
  return cleanSub ? `${domain}/portal/${cleanSub}` : `${domain}/portal`
}

export function portalSupportEmail(): string {
  const email = typeof Deno !== 'undefined' ? Deno.env.get('PORTAL_SUPPORT_EMAIL') : undefined
  return (email ?? DEFAULT_PORTAL_SUPPORT_EMAIL).trim() || DEFAULT_PORTAL_SUPPORT_EMAIL
}
