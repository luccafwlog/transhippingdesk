import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, History } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import {
  alertEntityLink,
  alertEntityLinkLabel,
  dismissAlertItem,
  formatAgencyReportAlertEntity,
  formatAlertEntity,
  getAlertTypeLabel,
  getEffectiveAlertType,
  listAlerts,
  type AlertQueueRow,
  type AlertStatusFilter,
} from '../services/alerts'
import { AGENCY_REPORT_DEPARTMENT_LABELS } from '../services/agencyDepartureReport'

const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: 'Fatura',
  container: 'Container',
  bl: 'B/L',
  granite_bl: 'Granito',
  agency_departure_report: 'ADR',
  voyage: 'Viagem',
  voyage_pod_schedule: 'Escala',
  voyage_escala_terminal: 'Terminal da escala',
  customer: 'Cliente',
  demurrage_invoice: 'Invoice Demurrage',
  pix_transaction: 'Transação PIX',
}

const FILTER_TABS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'dismissed', label: 'Dispensados' },
]

export function Alertas() {
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all')
  const [page, setPage] = useState(0)
  const [dismissTarget, setDismissTarget] = useState<AlertQueueRow | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [reviewBy, setReviewBy] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })

  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const { data, isLoading, isError, error, refetch } = useQuery<AlertQueueRow[]>({
    queryKey: ['alerts', statusFilter, page],
    queryFn: () => listAlerts(statusFilter, undefined, page),
  })

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!dismissTarget?.item_id) {
        throw new Error('Alerta legado sem item não suporta dispensa estruturada.')
      }
      if (!dismissReason.trim()) {
        throw new Error('Informe o motivo da dispensa.')
      }
      if (!reviewBy) {
        throw new Error('Informe a data de revisão futura.')
      }
      await dismissAlertItem(
        dismissTarget.item_id,
        dismissReason.trim(),
        new Date(`${reviewBy}T23:59:59Z`).toISOString(),
      )
    },
    onSuccess: () => {
      showToast('Alerta dispensado temporariamente', 'success')
      setDismissTarget(null)
      setDismissReason('')
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Falha ao dispensar alerta.'
      showToast(message, 'error')
    },
  })

  const requestDismissal = (alert: AlertQueueRow) => {
    if (!alert.item_id) {
      showToast(
        'Alertas legados anteriores à migração 318 são históricos e saem da fila quando a pendência é sanada.',
        'error',
      )
      return
    }
    setDismissTarget(alert)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fila de Alertas Operacionais"
        description="Pendências de auditoria e operacionais com ações corretivas no sistema."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {FILTER_TABS.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? 'primary' : 'secondary'}
              onClick={() => { setStatusFilter(tab.value); setPage(0) }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => void refetch()} loading={isLoading}>
          Atualizar
        </Button>
      </div>

      <Card>
        {isError ? (
          <div className="p-4">
            <InlineError message={error instanceof Error ? error.message : 'Erro ao carregar fila de alertas.'} />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--app-border)] bg-[var(--app-card-bg)] text-[var(--app-muted)]">
                <th className="px-4 py-3 font-medium">Severidade</th>
                <th className="px-4 py-3 font-medium">Tipo / Responsável</th>
                <th className="px-4 py-3 font-medium">Mensagem</th>
                <th className="px-4 py-3 font-medium">Entidade</th>
                <th className="px-4 py-3 font-medium">Criação</th>
                <th className="px-4 py-3 font-medium">Status / Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-border)]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Carregando alertas...
                  </td>
                </tr>
              ) : null}
              {!isLoading && data?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Nenhum alerta encontrado no filtro selecionado.
                  </td>
                </tr>
              ) : null}
              {data?.map((alert) => (
                <AlertRow
                  key={`${alert.id}:${alert.item_id ?? getEffectiveAlertType(alert)}`}
                  alert={alert}
                  isMutating={dismissMutation.isPending}
                  onDismiss={() => requestDismissal(alert)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-[var(--app-muted)]">
        <span>Página {page + 1} · {data?.length ?? 0} itens carregados</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Anterior</Button>
          <Button variant="secondary" disabled={!data || data.length < 100} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
        </div>
      </div>

      {dismissTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-[var(--app-text)]">Dispensar alerta temporariamente</h2>
            <p className="mt-1 text-xs text-[var(--app-muted)]">{dismissTarget.message}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--app-muted)]">
                  Motivo da dispensa (obrigatório para auditoria)
                </label>
                <textarea
                  className="mt-1 w-full rounded border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-xs text-[var(--app-text)]"
                  rows={3}
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="Ex.: Aguardando retorno da agência marítima até sexta."
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--app-muted)]">
                  Revisar até (o alerta reaparece após esta data)
                </label>
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-xs text-[var(--app-text)]"
                  value={reviewBy}
                  onChange={(e) => setReviewBy(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDismissTarget(null)}
                disabled={dismissMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                onClick={() => dismissMutation.mutate()}
                loading={dismissMutation.isPending}
                disabled={!dismissReason.trim() || !reviewBy}
              >
                Confirmar dispensa
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function AlertRow({ alert, isMutating, onDismiss }: { alert: AlertQueueRow; isMutating: boolean; onDismiss: () => void }) {
  const isDismissed = Boolean(alert.dismissed_until && new Date(alert.dismissed_until) > new Date())
  const effectiveType = getEffectiveAlertType(alert)
  const link = alertEntityLink(alert)
  const linkLabel = alertEntityLinkLabel(alert)

  const entityFormatted = alert.entity_type && alert.entity_id
    ? (formatAlertEntity(alert.entity_type, alert.entity_id) ?? (alert.entity_type === 'agency_departure_report' ? formatAgencyReportAlertEntity(alert.entity_id) : null))
    : null

  return (
    <tr>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
            alert.severity === 'critical'
              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}
        >
          {alert.severity === 'critical' ? 'Crítico' : 'Normal'}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
          <span className="text-xs text-[var(--app-text)]">{getAlertTypeLabel(effectiveType)}</span>
        </div>
        {alert.department ? <div className="mt-1 text-[11px] text-[var(--app-muted)]">Responsável: {AGENCY_REPORT_DEPARTMENT_LABELS[alert.department] ?? alert.department}</div> : null}
      </td>
      <td className="max-w-sm px-4 py-3 text-[var(--app-text)]">{alert.message}</td>
      <td className="px-4 py-3 text-[var(--app-muted)]">
        {entityFormatted ? (
          <span className="text-xs">{entityFormatted}</span>
        ) : alert.entity_type ? (
          <span className="font-mono text-xs">{ENTITY_TYPE_LABELS[alert.entity_type] ?? alert.entity_type}{alert.entity_id ? ` ${alert.entity_id}` : ''}</span>
        ) : (
          <span className="text-[var(--app-muted)]">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[var(--app-muted)]">{formatDate(alert.created_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {link ? (
            <Link
              to={link}
              className="inline-flex items-center gap-1 text-xs text-[var(--app-primary)] hover:underline"
            >
              <span>{linkLabel}</span>
              <ExternalLink size={12} />
            </Link>
          ) : null}
          {isDismissed ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--app-muted)]" title={`Dispensado até ${formatDate(alert.dismissed_until)}: ${alert.dismissal_reason ?? ''}`}>
              <History size={12} />
              <span>Dispensado</span>
            </span>
          ) : alert.item_id ? (
            <Button
              variant="secondary"
              onClick={onDismiss}
              disabled={isMutating}
            >
              Dispensar
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
