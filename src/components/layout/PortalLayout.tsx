import { Outlet } from 'react-router-dom'
import { Building2, LogOut } from 'lucide-react'
import { Button } from '../ui/Button'
import { usePortalAuth } from '../../hooks/usePortalAuth'
import { formatCnpjCpf } from '../../lib/utils'

// Casca visual própria do portal do cliente. Reusa os tokens/classes do design
// system interno (app-shell, app-header, app-main) mas com navegação enxuta —
// sem expor itens operacionais internos. Tema padrão do sistema (sem toggle).
export function PortalLayout() {
  const { overview, signOut } = usePortalAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__content">
          <div className="app-header__brand">
            <img className="app-header__brand-logo" src="/branding/tr-logo.png" alt="Transhipping" />
            <div className="app-header__titles">
              <div className="app-header__eyebrow">Portal do cliente</div>
              <div className="app-header__subtitle">faturas e consolidação de B/Ls</div>
            </div>
          </div>

          <div className="app-header__actions">
            <div className="app-user-pill" title={formatCnpjCpf(overview?.customer_cnpj_cpf)}>
              <span className="app-user-pill__icon" aria-hidden="true">
                <Building2 size={14} />
              </span>
              <span className="app-user-pill__name">{overview?.customer_name ?? 'Cliente'}</span>
            </div>

            <Button className="app-header__logout" variant="ghost" onClick={() => void signOut()}>
              <LogOut size={16} />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
