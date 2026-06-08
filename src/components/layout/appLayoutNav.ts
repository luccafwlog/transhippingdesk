import type { ComponentType } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  Car,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Home,
  Mountain,
  Package,
  ReceiptText,
  RefreshCw,
  Ship,
  ShieldCheck,
  Users,
} from 'lucide-react'
import type { OperationalCounts } from '../../hooks/useOperationalCounts'

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<{ size?: number }>
  badge?: number
  alert?: boolean
}

export const importNavItems: NavItem[] = [
  { to: '/baplie', label: 'Baplie EDI', icon: FileSpreadsheet },
  { to: '/manifestos', label: 'Manifestos CNTR', icon: FileSpreadsheet },
  { to: '/carga-solta', label: 'Manifestos BB', icon: FileSpreadsheet },
  { to: '/containers', label: 'Containers', icon: Boxes },
  { to: '/veiculos', label: 'Veículos', icon: Car },
  { to: '/vazios-importacao', label: 'Vazios IMP', icon: Package },
  { to: '/revisao', label: 'Revisão', icon: AlertTriangle },
]

export const exportNavItems: NavItem[] = [
  { to: '/granito', label: 'Granito', icon: Mountain },
  { to: '/embarquevazios', label: 'Vazios EXP', icon: Package },
]

export const primaryNavItems: NavItem[] = [
  { to: '/painel', label: 'Painel', icon: Home },
  { to: '/viagens', label: 'Viagens', icon: Ship },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/alertas', label: 'Alertas', icon: Bell },
]

export const adminNavItems: NavItem[] = [
  { to: '/admin/usuarios', label: 'Usuários', icon: ShieldCheck },
]

export const financialNavItems: NavItem[] = [
  { to: '/faturamento', label: 'Faturamento', icon: DollarSign },
  { to: '/taxas-locais', label: 'Taxas locais', icon: ReceiptText },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/demurrage', label: 'Demurrage', icon: Clock },
  { to: '/reconciliacao', label: 'Conciliação PIX', icon: RefreshCw },
]

export function buildFinancialNavItemsForCounts(counts: OperationalCounts): NavItem[] {
  return financialNavItems.map((item) => {
    if (item.to === '/taxas-locais') return { ...item, badge: counts.chargeReviewRequired || undefined }
    if (item.to === '/faturamento') return { ...item, alert: counts.chargeReviewRequired > 0 }
    return item
  })
}

export function getNavIndicator(items: NavItem[]): { type: 'none' } | { type: 'alert' } | { type: 'badge'; count: number } {
  if (items.some((item) => item.alert)) return { type: 'alert' }
  const totalBadge = items.reduce((sum, item) => sum + (item.badge ?? 0), 0)
  return totalBadge > 0 ? { type: 'badge', count: totalBadge } : { type: 'none' }
}
