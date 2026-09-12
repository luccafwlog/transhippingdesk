import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useOperationalAlerts } from '../../hooks/useOperationalAlerts'
import { useRoeHeaderRate } from '../../hooks/useRoeHeaderRate'
import { AppVersionBadge } from './AppVersionBadge'

function formatRate(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })
}

function formatEffectiveDate(value: string | null): string {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}


export function HeaderInfoBar() {
  const navigate = useNavigate()
  const rates = useRoeHeaderRate()
  const alerts = useOperationalAlerts()

  const hasDemurrage = alerts.demurrageOverdue > 0

  const ratesHint = rates.unavailable
    ? 'Cotação PTAX indisponível no momento — tente atualizar mais tarde.'
    : rates.offline && rates.cachedAt
      ? `Cotação em cache de ${new Intl.DateTimeFormat('pt-BR').format(new Date(rates.cachedAt))}.`
      : 'Cotação PTAX Venda mais recente do Banco Central e ROE com spread fixo de 1,065.'

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
        </div>

        {/* Zona central — câmbio do dia (oculta em mobile) */}
        <div className="app-market-strip__center" title={ratesHint}>
          {rates.loading ? (
            <span className="hib-currency-label">Carregando câmbio…</span>
          ) : rates.unavailable ? (
            <span className="hib-currency-label" style={{ color: '#f0b429' }}>Câmbio indisponível</span>
          ) : (
            <>
              <span className="hib-currency-label">PTAX Venda</span>
              <span className="hib-currency-value">R$ {formatRate(rates.ptax)}</span>
              <span className="hib-sep" aria-hidden="true">→</span>
              <span className="hib-currency-label">PTAX × 1,065 = ROE</span>
              <span className="hib-currency-value">R$ {formatRate(rates.roe)} ({formatEffectiveDate(rates.effectiveDate)})</span>
              {rates.offline ? (
                <span className="hib-currency-label" style={{ color: '#f0b429' }}>em cache</span>
              ) : null}
            </>
          )}
          <button
            type="button"
            className="hib-alert-btn app-market-refresh"
            aria-label="Atualizar cotação PTAX"
            onClick={() => void rates.refresh()}
          >
            <RefreshCw size={11} aria-hidden="true" />
          </button>
        </div>

        {/* Zona direita — identidade da build.
            O menu de usuário vive no cabeçalho principal (AppLayout); esta
            zona ficou anos com `display: none` carregando uma cópia morta
            dele. Agora ela mostra a versão publicada, visível em toda tela. */}
        <div className="app-market-strip__right">
          <AppVersionBadge />
        </div>

      </div>
    </div>
  )
}
