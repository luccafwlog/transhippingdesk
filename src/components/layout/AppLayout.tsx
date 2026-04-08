import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  FileSpreadsheet,
  Home,
  LogOut,
  Receipt,
  Settings,
  Ship,
  Tv,
  Users,
  WalletCards,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { cn } from '../../lib/utils'

const navItems = [
  { to: '/painel', label: 'Painel', icon: Home },
  { to: '/viagens', label: 'Viagens', icon: Ship },
  { to: '/manifestos', label: 'Manifestos', icon: FileSpreadsheet },
  { to: '/revisao', label: 'Revisao', icon: AlertTriangle },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/taxas-locais', label: 'Taxas locais', icon: WalletCards },
  { to: '/faturamento', label: 'Faturamento', icon: Receipt },
  { to: '/alertas', label: 'Alertas', icon: Bell },
  { to: '/relatorios', label: 'Relatorios', icon: BarChart3 },
  { to: '/line-up-tv', label: 'Line up TV', icon: Tv },
]

const adminItems = [
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { to: '/admin/tarifas', label: 'Tarifas', icon: Settings },
]

export function AppLayout() {
  const navigate = useNavigate()
  const { profile, isAdmin, signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-[#30363d] bg-[#161b22]/95 p-4 lg:block">
        <div className="mb-8">
          <div className="text-lg font-bold text-white">Transhipping Desk</div>
          <div className="text-xs uppercase tracking-[0.24em] text-[#1f6feb]">Shared v2</div>
        </div>

        <nav className="grid gap-1">
          {navItems.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </nav>

        {isAdmin ? (
          <div className="mt-8 border-t border-[#30363d] pt-4">
            <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Admin</div>
            <nav className="grid gap-1">
              {adminItems.map((item) => (
                <SidebarLink key={item.to} {...item} />
              ))}
            </nav>
          </div>
        ) : null}
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-[#30363d] bg-[#0d1117]/90 px-4 backdrop-blur md:px-8">
          <div className="lg:hidden">
            <div className="font-semibold">Transhipping Desk</div>
            <div className="text-xs text-slate-500">Menu completo no desktop</div>
          </div>
          <div className="hidden text-sm text-slate-400 lg:block">Operacao interna de agenciamento maritimo</div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-white">{profile?.full_name ?? 'Usuario'}</div>
              <div className="text-xs capitalize text-slate-500">{profile?.role ?? 'operator'}</div>
            </div>
            <Button variant="secondary" onClick={handleSignOut}>
              <LogOut size={16} />
              Sair
            </Button>
          </div>
        </header>

        <main className="px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarLink({
  to,
  label,
  icon: Icon,
}: {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number }>
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-[#21262d] hover:text-white',
          isActive && 'bg-[#1f6feb]/15 text-white ring-1 ring-[#1f6feb]/30',
        )
      }
    >
      <Icon size={18} />
      {label}
    </NavLink>
  )
}
