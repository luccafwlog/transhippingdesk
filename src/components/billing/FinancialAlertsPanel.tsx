import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { acknowledgeAlert, closeAlert, type Alert } from '../../services/alerts'

export function FinancialAlertsPanel({
  alerts,
  loading = false,
  onUpdate,
}: {
  alerts: Alert[]
  loading?: boolean
  onUpdate: () => void
}) {
  const { showToast } = useToast()
  const [acting, setActing] = useState<number | null>(null)

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

  async function handleAcknowledge(id: number) {
    setActing(id)
    try {
      await acknowledgeAlert(id)
      onUpdate()
    } catch {
      showToast('Falha ao reconhecer alerta.', 'error')
    } finally {
      setActing(null)
    }
  }

  async function handleClose(id: number) {
    setActing(id)
    try {
      await closeAlert(id)
      onUpdate()
    } catch {
      showToast('Falha ao fechar alerta.', 'error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-100">
        <AlertTriangle size={15} />
        {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} financeiro{alerts.length !== 1 ? 's' : ''} em aberto
      </div>
      <div className="grid gap-2">
        {alerts.slice(0, 5).map((alert) => (
          <div
            key={alert.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-[#0d1117]/60 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge tone={alert.status === 'acknowledged' ? 'blue' : 'yellow'}>
                {alert.status === 'acknowledged' ? 'Reconhecido' : 'Aberto'}
              </Badge>
              <span className="truncate text-xs text-slate-200">{alert.message}</span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {alert.status === 'open' ? (
                <Button variant="secondary" disabled={acting === alert.id} onClick={() => void handleAcknowledge(alert.id)}>
                  Reconhecer
                </Button>
              ) : null}
              <Button variant="secondary" disabled={acting === alert.id} onClick={() => void handleClose(alert.id)}>
                Fechar
              </Button>
            </div>
          </div>
        ))}
        {alerts.length > 5 ? (
          <div className="text-xs text-amber-300/70">
            + {alerts.length - 5} alerta{alerts.length - 5 !== 1 ? 's' : ''}. Veja todos em{' '}
            <a href="/alertas" className="underline hover:text-amber-200">
              /alertas
            </a>.
          </div>
        ) : null}
      </div>
    </div>
  )
}
