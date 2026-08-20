import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCheck, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import { dismissAlertItem, formatAgencyReportAlertEntity, listAlerts, type AlertQueueRow, type AlertStatusFilter } from '../services/alerts'

const TYPE_LABELS: Record<string, string> = {
  invoice_overdue: 'Fatura vencida',
  invoice_payment_invalid: 'Pagamento inválido',
  invoice_cancel_blocked: 'Cancelamento bloqueado',
  portal_invoice_created: 'Fatura criada no portal',
  portal_consolidation_obsoleted: 'Consolidada obsoleta (portal)',
  demurrage: 'Demurrage',
  billing_calculation_blocked: 'Cálculo bloqueado',
  billing_auto_issue_failed: 'Falha de emissão automática',
  portal_pendencia_geral: 'Portal do Cliente — pendência geral',
  portal_excecao_critica_fatura: 'Portal do Cliente — exceção de fatura',
  portal_reprocessamento_falhou: 'Portal do Cliente — falha no reprocessamento',
  portal_convite_expirado: 'Portal do Cliente — convite expirado',
  portal_falha_envio: 'Portal do Cliente — falha de envio',
  portal_email_suprimido: 'Portal do Cliente — email suprimido',
  portal_abuso_login: 'Portal do Cliente — abuso de login',
  agency_report_department_pending: 'ADR — departamento pendente',
  agency_report_deadline_missed: 'ADR — prazo vencido',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: 'Fatura',
  container: 'Container',
  bl: 'B/L',
  agency_departure_report: 'ADR',
  voyage: 'Viagem',
}

const FILTER_TABS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'dismissed', label: 'Dispensados' },
]

export function Alertas() {
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all')
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', statusFilter],
    queryFn: () => listAlerts(statusFilter),
  })

  const dismissMutation = useMutation({
    mutationFn: ({ itemId, reason, reviewAt }: { itemId: number; reason: string; reviewAt: string }) =>
      dismissAlertItem(itemId, reason, reviewAt),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
      showToast('Item dispensado até a data de revisão.', 'success')
    },
    onError: () => showToast('Erro ao dispensar item.', 'error'),
  })

  function requestDismissal(alert: AlertQueueRow) {
    if (alert.item_id === null) {
      showToast('Este alerta legado ainda não possui item dispensável.', 'error')
      return
    }
    const reason = window.prompt('Informe o motivo da dispensa temporária.')?.trim()
    if (!reason) return
    const reviewInput = window.prompt('Informe a data/hora futura da revisão (ex.: 2026-08-21T09:00).')?.trim()
    if (!reviewInput) return
    const reviewAt = new Date(reviewInput)
    if (Number.isNaN(reviewAt.getTime()) || reviewAt <= new Date()) {
      showToast('A revisão deve ser uma data/hora futura válida.', 'error')
      return
    }
    dismissMutation.mutate({ itemId: alert.item_id, reason, reviewAt: reviewAt.toISOString() })
  }

  return (
    <>
      <PageHeader
        title="Alertas operacionais"
        description="Pendências coletivas que permanecem abertas até a origem ser resolvida."
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
          <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Gravidade</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Mensagem</th>
                <th scope="col" className="px-4 py-3">Entidade</th>
                <th scope="col" className="px-4 py-3">Criado em</th>
                <th scope="col" className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--app-muted)]">Carregando alertas...</td></tr>
              ) : null}
              {!isLoading && !data?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center gap-2 text-[var(--app-muted)]">
                      <CheckCheck size={28} className="text-emerald-500" />
                      <span>{statusFilter === 'dismissed' ? 'Nenhum item dispensado.' : 'Nenhum alerta ativo no momento.'}</span>
                    </div>
                  </td>
                </tr>
              ) : null}
              {data?.map((alert) => (
                <AlertRow
                  key={`${alert.id}:${alert.item_id ?? alert.type}`}
                  alert={alert}
                  isMutating={dismissMutation.isPending}
                  onDismiss={() => requestDismissal(alert)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function AlertRow({ alert, isMutating, onDismiss }: { alert: AlertQueueRow; isMutating: boolean; onDismiss: () => void }) {
  const isDismissed = Boolean(alert.dismissed_until && new Date(alert.dismissed_until) > new Date())
  return (
    <tr>
      <td className="px-4 py-3">
        <Badge tone={alert.severity === 'critical' ? 'red' : 'yellow'}>
          {alert.severity === 'critical' ? 'Crítico' : 'Normal'}
        </Badge>
        {isDismissed ? <div className="mt-1 text-[11px] text-[var(--app-muted)]">Revisão: {formatDate(alert.dismissed_until)}</div> : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
          <span className="text-xs text-[var(--app-text)]">{TYPE_LABELS[alert.type] ?? alert.type}</span>
        </div>
        {alert.department ? <div className="mt-1 text-[11px] text-[var(--app-muted)]">Responsável: {alert.department}</div> : null}
      </td>
      <td className="max-w-sm px-4 py-3 text-[var(--app-text)]">{alert.message}</td>
      <td className="px-4 py-3 text-[var(--app-muted)]">
        {alert.entity_type === 'agency_departure_report' && alert.entity_id && formatAgencyReportAlertEntity(alert.entity_id) ? (
          <span className="text-xs">{formatAgencyReportAlertEntity(alert.entity_id)}</span>
        ) : alert.entity_type ? (
          <span className="font-mono text-xs">{ENTITY_TYPE_LABELS[alert.entity_type] ?? alert.entity_type}{alert.entity_id ? ` ${alert.entity_id}` : ''}</span>
        ) : '-'}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[var(--app-muted)]">{formatDate(alert.created_at)}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          {alertEntityLink(alert) ? <Link to={alertEntityLink(alert) as string} className="app-table__action"><ExternalLink size={13} />{alertEntityLinkLabel(alert)}</Link> : null}
          {!isDismissed ? <Button variant="secondary" disabled={isMutating} onClick={onDismiss}>Dispensar</Button> : null}
        </div>
      </td>
    </tr>
  )
}

// O mesmo destino é usado pela fila e pelo sino; produtores não escolhem uma
// tela paralela nem gravam rotas na Notificação Interna.
function alertEntityLink(alert: { type: string; entity_type: string | null; entity_id: string | null }): string | null {
  if (!alert.entity_id) return null
  if (alert.type === 'portal_excecao_critica_fatura' && alert.entity_type === 'bl') {
    return `/manifestos/${encodeURIComponent(alert.entity_id)}?tab=faturamento`
  }
  if (alert.type === 'portal_reprocessamento_falhou' && alert.entity_type === 'bl') {
    return `/manifestos/${encodeURIComponent(alert.entity_id)}?tab=faturamento`
  }
  if (alert.type.startsWith('portal_')) {
    if (alert.entity_type === 'invoice') return /^\d+$/.test(alert.entity_id) ? `/taxas-locais?invoice=${encodeURIComponent(alert.entity_id)}` : '/taxas-locais'
    return `/clientes/portal?cliente=${encodeURIComponent(alert.entity_id)}`
  }
  if (alert.entity_type === 'invoice') return /^\d+$/.test(alert.entity_id) ? `/taxas-locais?invoice=${encodeURIComponent(alert.entity_id)}` : '/taxas-locais'
  if (alert.entity_type === 'container') return `/demurrage?busca=${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'bl') return `/manifestos/${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'agency_departure_report') {
    const [voyageId, port, terminalOrLegacyKey, terminalizedKey] = alert.entity_id.split('::')
    if (!/^\d+$/.test(voyageId)) return null
    const params = new URLSearchParams({ tab: 'adr', escala: port })
    if (terminalizedKey !== undefined) params.set('terminal', terminalOrLegacyKey)
    return `/viagens/${voyageId}?${params.toString()}`
  }
  if (alert.entity_type === 'voyage' && /^\d+$/.test(alert.entity_id)) return `/viagens/${alert.entity_id}`
  return null
}

function alertEntityLinkLabel(alert: { entity_type: string | null }) {
  if (alert.entity_type === 'invoice') return 'Ver Fatura'
  if (alert.entity_type === 'container') return 'Ver Demurrage'
  if (alert.entity_type === 'bl') return 'Abrir B/L'
  if (alert.entity_type === 'agency_departure_report' || alert.entity_type === 'voyage') return 'Abrir Viagem'
  return 'Abrir'
}
