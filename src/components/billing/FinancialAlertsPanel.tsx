import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { getAlertTypeLabel, getEffectiveAlertType, type AlertQueueRow } from '../../services/alerts'

export function FinancialAlertsPanel({
  alerts,
  loading = false,
}: {
  alerts: AlertQueueRow[]
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="mb-5 rounded-xl border border-[#30363d] bg-[#161b22] p-4">
        <div className="mb-3 h-4 w-48 rounded bg-slate-700/60" />
        <div className="grid gap-2">
          <div className="h-9 rounded-lg bg-slate-800/80" />
          <div className="h-9 rounded-lg bg-slate-800/60" />
        </div>
      </div>
    )
  }

  if (!alerts.length) return null

  return (
    <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-100">
        <AlertTriangle size={15} />
        {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} financeiro{alerts.length !== 1 ? 's' : ''} em aberto
      </div>
      <div className="grid gap-2">
        {alerts.slice(0, 5).map((alert) => (
          <div
            key={alert.item_id ?? alert.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/20 bg-[#0d1117]/60 px-3 py-2 sm:gap-3"
          >
            <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
              <Badge tone="yellow">
                Aberto
              </Badge>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-amber-200">{getAlertTypeLabel(getEffectiveAlertType(alert))}</div>
                <span className="block break-words text-xs text-slate-200">{alert.message}</span>
              </div>
            </div>
          </div>
        ))}
        {alerts.length > 5 ? (
          <div className="text-xs text-amber-300/70">
            + {alerts.length - 5} alerta{alerts.length - 5 !== 1 ? 's' : ''}. Veja todos em{' '}
            <Link to="/alertas" className="underline hover:text-amber-200">
              /alertas
            </Link>.
          </div>
        ) : null}
      </div>
    </div>
  )
}
