import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, LogOut, UserCircle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useExchangeRates } from '../../hooks/useExchangeRates'
import { useOperationalAlerts } from '../../hooks/useOperationalAlerts'
import type { UserProfileRole } from '../../types/database'

function formatRate(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
}

function roleLabel(role: UserProfileRole | null | undefined): string {
  switch (role) {
    case 'admin':
    case 'administrativo':
      return 'Administrativo'
    case 'financeiro':
      return 'Financeiro'
    case 'operacoes':
      return 'Operações'
    case 'operator':
    case 'documentacao':
      return 'Documentação'
    default:
      return ''
  }
}

export function HeaderInfoBar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const rates = useExchangeRates()
  const alerts = useOperationalAlerts()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userZoneRef = useRef<HTMLDivElement>(null)

  const hasDemurrage = alerts.demurrageOverdue > 0
  const hasGranite = alerts.granitePending > 0

  useEffect(() => {
    if (!userMenuOpen) return
    function handleOutside(e: MouseEvent) {
      if (userZoneRef.current && !userZoneRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [userMenuOpen])

  async function handleSignOut() {
    setUserMenuOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  const label = roleLabel(profile?.role)
  const commitSha = import.meta.env.VITE_APP_COMMIT_SHA
    ? String(import.meta.env.VITE_APP_COMMIT_SHA).substring(0, 7)
    : 'unknown'

  return (
    <div className="app-market-strip">
      <div className="app-market-strip__content">

        {/* Zona esquerda — alertas operacionais */}
        <div className="app-market-strip__left">
          {hasDemurrage && (
            <button
              type="button"
              className="hib-alert-btn"
              onClick={() => navigate('/demurrage')}
            >
              <AlertTriangle size={11} aria-hidden="true" />
              {alerts.demurrageOverdue} demurrage{alerts.demurrageOverdue !== 1 ? 's' : ''} vencido{alerts.demurrageOverdue !== 1 ? 's' : ''}
            </button>
          )}
          {hasDemurrage && hasGranite && (
            <span className="hib-sep" aria-hidden="true">·</span>
          )}
          {hasGranite && (
            <button
              type="button"
              className="hib-alert-btn"
              onClick={() => navigate('/granito')}
            >
              {alerts.granitePending} Granite pendente{alerts.granitePending !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Zona central — câmbio do dia (oculta em mobile) */}
        <div className="app-market-strip__center">
          <span className="hib-currency-label">USD</span>
          <span className="hib-currency-value">R$ {formatRate(rates.usd)}</span>
          <span className="hib-sep" aria-hidden="true">·</span>
          <span className="hib-currency-label">CNY</span>
          <span className="hib-currency-value">R$ {formatRate(rates.cny)}</span>
        </div>

        {/* Zona direita — usuário logado */}
        <div className="app-market-strip__right" ref={userZoneRef} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {commitSha !== 'unknown' && (
            <>
              <span 
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--app-font-mono)',
                  color: 'rgba(255, 255, 255, 0.38)',
                  fontWeight: 500
                }} 
                title={`Commit: ${String(import.meta.env.VITE_APP_COMMIT_SHA)}`}
              >
                {commitSha}
              </span>
              <span className="hib-sep" aria-hidden="true">·</span>
            </>
          )}
          <button
            type="button"
            className="hib-user-btn"
            onClick={() => setUserMenuOpen((o) => !o)}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
          >
            <UserCircle size={13} aria-hidden="true" />
            <span className="hib-user-name">{profile?.full_name ?? '—'}</span>
            {label && (
              <>
                <span className="hib-sep" aria-hidden="true">·</span>
                <span className="hib-user-role">{label}</span>
              </>
            )}
          </button>

          {userMenuOpen && (
            <div className="hib-user-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="hib-user-menu__item"
                onClick={() => void handleSignOut()}
              >
                <LogOut size={13} aria-hidden="true" />
                Sair
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
