import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CheckCheck, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import { acknowledgeAlert, closeAlert, listAlerts, type AlertStatusFilter } from '../services/alerts'

const STATUS_LABELS: Record<string, { label: string; tone: 'yellow' | 'blue' | 'slate' }> = {
  open: { label: 'Aberto', tone: 'yellow' },
  acknowledged: { label: 'Reconhecido', tone: 'blue' },
  closed: { label: 'Fechado', tone: 'slate' },
}

const TYPE_LABELS: Record<string, string> = {
  invoice_overdue: 'Fatura vencida',
  portal_invoice_created: 'Fatura criada no portal',
  portal_consolidation_obsoleted: 'Consolidada obsoleta (portal)',
  demurrage: 'Demurrage',
  billing: 'Faturamento',
  review: 'Revisão',
}

const FILTER_TABS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos os abertos' },
  { value: 'open', label: 'Novos' },
  { value: 'acknowledged', label: 'Reconhecidos' },
]

export function Alertas() {
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all')
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', statusFilter],
    queryFn: () => listAlerts(statusFilter),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('Alerta reconhecido.', 'success')
    },
    onError: () => showToast('Erro ao reconhecer alerta.', 'error'),
  })

  const closeMutation = useMutation({
    mutationFn: closeAlert,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showToast('Alerta fechado.', 'success')
    },
    onError: () => showToast('Erro ao fechar alerta.', 'error'),
  })

  const isMutating = acknowledgeMutation.isPending || closeMutation.isPending

  return (
    <>
      <PageHeader
        title="Alertas operacionais"
        description="Eventos criticos e pendencias registradas automaticamente pelo sistema."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`app-tab ${statusFilter === tab.value ? 'app-tab--active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar alertas." /> : null}

        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[780px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Mensagem</th>
                <th scope="col" className="px-4 py-3">Entidade</th>
                <th scope="col" className="px-4 py-3">Data</th>
                <th scope="col" className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Carregando alertas...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center gap-2 text-[var(--app-muted)]">
                      <CheckCheck size={28} className="text-emerald-500" />
                      <span>Nenhum alerta aberto no momento.</span>
                    </div>
                  </td>
                </tr>
              ) : null}
              {data?.map((alert) => {
                const statusMeta = STATUS_LABELS[alert.status] ?? STATUS_LABELS.open
                return (
                  <tr key={alert.id}>
                    <td className="px-4 py-3">
                      <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                        <span className="text-xs text-[var(--app-text)]">{TYPE_LABELS[alert.type] ?? alert.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-sm text-[var(--app-text)]">{alert.message}</td>
                    <td className="px-4 py-3 text-[var(--app-muted)]">
                      {alert.entity_type ? (
                        <span className="font-mono text-xs">
                          {alert.entity_type}
                          {alert.entity_id ? ` / ${alert.entity_id}` : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--app-muted)] whitespace-nowrap">
                      {formatDate(alert.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {alertEntityLink(alert) ? (
                          <Link to={alertEntityLink(alert) as string} className="app-table__action">
                            <ExternalLink size={13} />
                            {alertEntityLinkLabel(alert)}
                          </Link>
                        ) : null}
                        {alert.status === 'open' ? (
                          <Button
                            variant="secondary"
                            disabled={isMutating}
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                          >
                            <Bell size={14} />
                            Reconhecer
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          disabled={isMutating}
                          onClick={() => closeMutation.mutate(alert.id)}
                        >
                          Fechar
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// Leva o usuário direto à entidade do alerta em vez de obrigar navegação manual.
function alertEntityLink(alert: { type: string; entity_type: string | null; entity_id: string | null }): string | null {
  if (!alert.entity_id) return null
  if (alert.entity_type === 'invoice') {
    // entity_id pode ser o id numérico (abre o detalhe via ?invoice=) ou o
    // número da fatura (ex: FAT-2026-0016) — nesse caso só leva à página.
    return /^\d+$/.test(alert.entity_id)
      ? `/faturamento?invoice=${encodeURIComponent(alert.entity_id)}`
      : '/faturamento'
  }
  if (alert.entity_type === 'container') return `/demurrage?busca=${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'bl') return `/manifestos/${encodeURIComponent(alert.entity_id)}`
  return null
}

function alertEntityLinkLabel(alert: { entity_type: string | null }) {
  if (alert.entity_type === 'invoice') return 'Ver Fatura'
  if (alert.entity_type === 'container') return 'Ver Demurrage'
  if (alert.entity_type === 'bl') return 'Abrir B/L'
  return 'Abrir'
}
