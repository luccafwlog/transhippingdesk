import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { accountSituationLabel } from '../../lib/portalProvisioningViewModel'
import { useCustomerDemurrageInvoices, useCustomerPendingReconciliation, useCustomerRunningDemurrage, useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { buildConsolidatedBalance } from '../../services/customerFicha'
import { formatBRL, formatCnpjCpf, formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import type { FichaTabId } from './FichaTabs'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type VisaoGeralTabProps = { data: Data; onNavigateTab: (tab: FichaTabId) => void }

export function VisaoGeralTab({ data, onNavigateTab }: VisaoGeralTabProps) {
  const { data: portalRow } = usePortalProvisioningForCustomer(data.id)
  const { data: demurrage } = useCustomerDemurrageInvoices(data.id)
  const { data: pendingReconciliation } = useCustomerPendingReconciliation(data.id)
  const { data: runningDemurrage } = useCustomerRunningDemurrage(data.id)
  const { data: timeline } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  const financialDenied = data.invoices_access_denied || (demurrage?.denied ?? false)
  const balance = buildConsolidatedBalance(data.invoices ?? [], demurrage?.rows ?? [])
  const primaryContact = data.customer_contacts?.find((contact) => contact.is_primary) ?? data.customer_contacts?.[0]
  const today = new Date().toISOString().slice(0, 10)
  const overdueLocal = (data.invoices ?? []).filter((invoice) => invoice.status === 'overdue' || (invoice.status === 'issued' && invoice.due_date && invoice.due_date < today))
  const overdueDemurrage = (demurrage?.rows ?? []).filter((invoice) => invoice.status === 'overdue' || (invoice.status === 'issued' && invoice.due_date && invoice.due_date < today))
  const openDisputes = (demurrage?.rows ?? []).filter((invoice) => invoice.dispute_open || invoice.dispute_status === 'aberto')

  const pendencias: Array<{ key: string; label: string; onClick?: () => void; to?: string }> = []
  if ((pendingReconciliation?.length ?? 0) > 0) {
    pendencias.push({ key: 'reconciliacao', label: `${pendingReconciliation!.length} B/L(s) com reconciliação de cliente pendente`, onClick: () => onNavigateTab('operacional') })
  }
  if (portalRow && portalRow.account_situation !== 'ativo') {
    pendencias.push({ key: 'portal', label: `Portal não ativo: ${accountSituationLabel(portalRow.account_situation)}`, to: `/clientes/portal?cliente=${data.id}` })
  }
  if (!financialDenied && overdueLocal.length + overdueDemurrage.length > 0) {
    pendencias.push({ key: 'vencidas', label: `${overdueLocal.length + overdueDemurrage.length} invoice(s) vencida(s)`, onClick: () => onNavigateTab('financeiro') })
  }
  if (!financialDenied && openDisputes.length > 0) {
    pendencias.push({ key: 'disputas', label: `${openDisputes.length} disputa(s) de demurrage aberta(s)`, onClick: () => onNavigateTab('financeiro') })
  }
  if ((runningDemurrage?.length ?? 0) > 0) {
    pendencias.push({ key: 'correndo', label: `${runningDemurrage!.length} container(s) com demurrage correndo`, to: '/demurrage' })
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Saldo pendente (local + demurrage)" value={financialDenied ? 'Restrito' : formatBRL(balance.totalBrl)} tone="primary" />
        <MetricCard label="Local" value={financialDenied ? '—' : formatBRL(balance.localBrl)} />
        <MetricCard label="Demurrage" value={financialDenied ? '—' : formatBRL(balance.demurrageBrl)} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Identidade</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">CNPJ/CPF</dt><dd>{formatCnpjCpf(data.cnpj_cpf)}</dd></div>
            <div><dt className="text-xs text-slate-500">Cidade/UF</dt><dd>{[data.city, data.state].filter(Boolean).join(' / ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Contato principal</dt><dd>{primaryContact ? `${primaryContact.name ?? '—'} · ${primaryContact.email ?? primaryContact.phone ?? '—'}` : 'Nenhum contato'}</dd></div>
            <div><dt className="text-xs text-slate-500">Portal</dt><dd>{portalRow ? accountSituationLabel(portalRow.account_situation) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">B/Ls vinculados</dt><dd>{data.bls?.length ?? 0}</dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-white">Pendências</h2>
          {pendencias.length === 0 ? <div className="text-sm text-slate-400">Nenhuma pendência aberta.</div> : <ul className="grid gap-2 text-sm">{pendencias.map((item) => <li key={item.key} className="rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-amber-100">{item.to ? <Link className="hover:underline" to={item.to}>{item.label} →</Link> : <button type="button" className="text-left hover:underline" onClick={item.onClick}>{item.label} →</button>}</li>)}</ul>}
        </Card>
      </div>
      <Card className="mt-5">
        <h2 className="mb-4 text-lg font-semibold text-white">Atividade recente</h2>
        {(timeline ?? []).length === 0 ? <div className="text-sm text-slate-400">Sem eventos registrados.</div> : <ul className="grid gap-2 text-sm">{timeline!.slice(0, 5).map((event) => <li key={`${event.kind}-${event.sourceId}`} className="flex items-baseline gap-3"><span className="shrink-0 text-xs text-slate-500">{formatDate(event.at)}</span><span>{event.link ? <Link className="hover:underline" to={event.link}>{event.label}</Link> : event.label}</span></li>)}</ul>}
      </Card>
    </>
  )
}
