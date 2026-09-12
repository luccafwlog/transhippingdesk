// Abas da Administração. Vivem fora do componente porque a rota (`/admin/:tab`)
// e os testes precisam do catálogo sem arrastar a página inteira — e porque o
// eslint de fast-refresh exige que um arquivo de componente só exporte componentes.

export const ADMIN_TABS = [
  { slug: 'usuarios', label: 'Usuários' },
  { slug: 'falhas', label: 'Falhas de Roteamento' },
  { slug: 'logs', label: 'Log de Ações' },
  { slug: 'metricas', label: 'Métricas' },
  { slug: 'prazo-adr', label: 'Relatório SLA ADR' },
] as const

export type AdminTab = (typeof ADMIN_TABS)[number]['slug']

export const DEFAULT_ADMIN_TAB: AdminTab = 'usuarios'

export function isAdminTab(value: string | undefined): value is AdminTab {
  return ADMIN_TABS.some((entry) => entry.slug === value)
}
