import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  Car,
  ChevronDown,
  DollarSign,
  FileSpreadsheet,
  Home,
  LogOut,
  Menu,
  ReceiptText,
  Ship,
  Users,
  X,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { useOperationalCounts } from '../../hooks/useOperationalCounts'
import { cn } from '../../lib/utils'

type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  badge?: number
}

const importNavItems: NavItem[] = [
  { to: '/manifestos', label: 'Manifestos CNTR', icon: FileSpreadsheet },
  { to: '/containers', label: 'Containers', icon: Boxes },
  { to: '/carga-solta', label: 'Manifestos BB', icon: FileSpreadsheet },
  { to: '/veiculos', label: 'Veiculos', icon: Car },
  { to: '/revisao', label: 'Revisao', icon: AlertTriangle },
]

const primaryNavItems: NavItem[] = [
  { to: '/painel', label: 'Painel', icon: Home },
  { to: '/viagens', label: 'Viagens', icon: Ship },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/alertas', label: 'Alertas', icon: Bell },
]

const financialNavItems: NavItem[] = [
  { to: '/taxas-locais', label: 'Taxas locais', icon: ReceiptText },
  { to: '/faturamento', label: 'Faturamento', icon: DollarSign },
  { to: '/relatorios', label: 'Relatorios', icon: BarChart3 },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const counts = useOperationalCounts()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [mobileImportOpen, setMobileImportOpen] = useState(false)
  const [desktopImportOpen, setDesktopImportOpen] = useState(false)
  const [mobileFinancialOpen, setMobileFinancialOpen] = useState(false)
  const [desktopFinancialOpen, setDesktopFinancialOpen] = useState(false)
  const [isMobileNav, setIsMobileNav] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
  )
  const currentDate = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date())
  const currentTime = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
  const primaryNavItemsWithBadges: NavItem[] = primaryNavItems.map((item) =>
    item.to === '/alertas' ? { ...item, badge: counts.openAlerts || undefined } : item,
  )
  const importNavItemsWithBadges: NavItem[] = importNavItems.map((item) =>
    item.to === '/revisao' ? { ...item, badge: counts.pendingReview || undefined } : item,
  )
  const financialNavItemsWithBadges: NavItem[] = financialNavItems.map((item) => {
    if (item.to === '/taxas-locais') return { ...item, badge: counts.chargeReviewRequired || undefined }
    if (item.to === '/faturamento') return { ...item, badge: counts.readyForBilling || undefined }
    return item
  })

  const isImportSectionActive = importNavItems.some((item) => isPathActive(location.pathname, item.to))
  const isFinancialSectionActive = financialNavItems.some((item) => isPathActive(location.pathname, item.to))

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncMobileState = (matches: boolean) => {
      setIsMobileNav(matches)
      if (!matches) {
        setMobileNavOpen(false)
        setMobileImportOpen(false)
        setMobileFinancialOpen(false)
      } else {
        setDesktopImportOpen(false)
        setDesktopFinancialOpen(false)
      }
    }

    syncMobileState(mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => syncMobileState(event.matches)
    mediaQuery.addEventListener('change', handleChange)

    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  function closeMobileMenus() {
    setMobileNavOpen(false)
    setMobileImportOpen(false)
    setDesktopImportOpen(false)
    setMobileFinancialOpen(false)
    setDesktopFinancialOpen(false)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <div className="app-market-strip">
        <div className="app-market-strip__content">
          <div className="app-market-strip__left">
            <span className="app-market-chip">Operacao interna</span>
            <strong className="app-market-value">Transhipping Desk</strong>
            <span className="app-market-separator">•</span>
            <span className="app-market-meta">{currentDate}</span>
          </div>
          <div className="app-market-strip__right">
            <span className="app-market-meta">Ultimo acesso: {currentTime}</span>
            <span className="app-market-divider" />
            <span className="app-market-meta">Fonte: base operacional</span>
          </div>
        </div>
      </div>

      <header className="app-header">
        <div className="app-header__content">
          <button className="app-header__brand" onClick={() => navigate('/painel')} type="button">
            <img className="app-header__brand-logo" src="/branding/tr-logo.png" alt="Transhipping" />
            <div className="app-header__titles">
              <div className="app-header__eyebrow">Desk Operacional</div>
              <div className="app-header__subtitle">by ljuliatti</div>
            </div>
          </button>

          <div className="app-header__actions">
            <div className="app-user-pill" title={profile?.role ?? 'operator'}>
              <span className="app-user-pill__icon" aria-hidden="true">
                👤
              </span>
              <span className="app-user-pill__name">{profile?.full_name ?? 'Usuario'}</span>
            </div>

            <Button className="app-header__logout" variant="ghost" onClick={handleSignOut}>
              <LogOut size={16} />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="app-nav-bar">
        <div className="app-nav-mobile-bar">
          <button
            type="button"
            className="app-nav-toggle"
            aria-expanded={mobileNavOpen}
            aria-controls="app-primary-navigation"
            onClick={() => setMobileNavOpen((current) => !current)}
          >
            {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            Menu
          </button>
        </div>

        <nav id="app-primary-navigation" className={cn('app-nav-scroll', mobileNavOpen && 'app-nav-scroll--open')}>
  {primaryNavItemsWithBadges.slice(0, 2).map((item) => (
    <TopNavLink key={item.to} {...item} onNavigate={closeMobileMenus} />
  ))}

  <TopNavDropdownMenu
    label="Importacao"
    icon={FileSpreadsheet}
    items={importNavItemsWithBadges}
    isActive={isImportSectionActive}
    isMobile={isMobileNav}
    desktopOpen={desktopImportOpen}
    mobileOpen={mobileImportOpen}
    onOpenDesktop={() => setDesktopImportOpen(true)}
    onCloseDesktop={() => setDesktopImportOpen(false)}
    onToggleMobile={() => setMobileImportOpen((current) => !current)}
    onNavigate={closeMobileMenus}
  />

  <TopNavDropdownMenu
    label="Financeiro"
    icon={DollarSign}
    items={financialNavItemsWithBadges}
    isActive={isFinancialSectionActive}
    isMobile={isMobileNav}
    desktopOpen={desktopFinancialOpen}
    mobileOpen={mobileFinancialOpen}
    onOpenDesktop={() => setDesktopFinancialOpen(true)}
    onCloseDesktop={() => setDesktopFinancialOpen(false)}
    onToggleMobile={() => setMobileFinancialOpen((current) => !current)}
    onNavigate={closeMobileMenus}
  />

  {primaryNavItemsWithBadges.slice(2).map((item) => (
    <TopNavLink key={item.to} {...item} onNavigate={closeMobileMenus} />
  ))}
</nav>  
      </div>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

function TopNavLink({
  to,
  label,
  icon: Icon,
  badge,
  onNavigate,
}: {
  to: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  badge?: number
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) => cn('app-nav-link', isActive && 'active')}
    >
      <Icon size={18} />
      {label}
      {badge ? <NavBadge count={badge} /> : null}
    </NavLink>
  )
}

function TopNavDropdownMenu({
  label,
  icon: Icon,
  items,
  isActive,
  isMobile,
  desktopOpen,
  mobileOpen,
  onOpenDesktop,
  onCloseDesktop,
  onToggleMobile,
  onNavigate,
}: {
  label: string
  icon: React.ComponentType<{ size?: number }>
  items: NavItem[]
  isActive: boolean
  isMobile: boolean
  desktopOpen: boolean
  mobileOpen: boolean
  onOpenDesktop: () => void
  onCloseDesktop: () => void
  onToggleMobile: () => void
  onNavigate?: () => void
}) {
  const isOpen = isMobile ? mobileOpen : desktopOpen
  const totalBadge = items.reduce((sum, item) => sum + (item.badge ?? 0), 0)

  return (
    <div
      className={cn('app-nav-dropdown', isActive && 'active', isOpen && 'open')}
      onMouseEnter={() => {
        if (!isMobile) onOpenDesktop()
      }}
      onMouseLeave={() => {
        if (!isMobile) onCloseDesktop()
      }}
      onFocusCapture={() => {
        if (!isMobile) onOpenDesktop()
      }}
      onBlurCapture={(event) => {
        if (isMobile) return
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        onCloseDesktop()
      }}
    >
      <button
        type="button"
        className={cn('app-nav-link', 'app-nav-link--button', (isActive || isOpen) && 'active')}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => {
          if (isMobile) {
            onToggleMobile()
          } else {
            onCloseDesktop()
          }
        }}
      >
        <Icon size={18} />
        {label}
        {totalBadge > 0 && <NavBadge count={totalBadge} />}
        <ChevronDown size={16} className="app-nav-dropdown__chevron" />
      </button>

      <div className="app-nav-dropdown__menu" role="menu" aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            role="menuitem"
            onClick={onNavigate}
            className={({ isActive }) => cn('app-nav-dropdown__item', isActive && 'active')}
          >
            <item.icon size={16} />
            {item.label}
            {item.badge ? <NavBadge count={item.badge} /> : null}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

function isPathActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`)
}
