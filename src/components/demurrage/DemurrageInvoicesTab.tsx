import { FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { InvoiceStatusBadge } from './DemurrageBadges'
import { fmtBRL, fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatResultCount } from '../../lib/operationalState'
import { formatDate } from '../../lib/utils'
import type { DemurrageInvoice } from '../../types/database'

type Props = {
  tab: string
  tabLabel: string
  invoices: DemurrageInvoice[] | undefined
  loading: boolean
  error: unknown
  onOpenDetail: (invoiceId: number) => void
  onOpenDiscount: (invoice: DemurrageInvoice) => void
  onOpenDispute: (invoice: DemurrageInvoice) => void
  onOpenPayment: (invoiceId: number) => void
  onOpenDocument: (invoiceId: number, type: 'invoice' | 'receipt') => void
  onCancel: (invoiceId: number) => void
  onReversePayment: (invoiceId: number) => void
}

export function DemurrageInvoicesTab({
  tab,
  tabLabel,
  invoices,
  loading,
  error,
  onOpenDetail,
  onOpenDiscount,
  onOpenDispute,
  onOpenPayment,
  onOpenDocument,
  onCancel,
  onReversePayment,
}: Props) {
  return (
    <>
      {loading && <Card>Carregando...</Card>}
      {error && <InlineError message="Erro ao carregar faturas." />}
      <div className="mb-3 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{formatResultCount(invoices?.length ?? 0, 'fatura visível', 'faturas visíveis')}</span>
        <span className="text-xs text-slate-400">Filtros ativos: Status {tabLabel}</span>
      </div>
      {!loading && !error && !invoices?.length && (
        <EmptyState icon={FileText} title="Nenhuma fatura" description={`Nenhuma fatura com status "${tab}".`} />
      )}

      {invoices && invoices.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table min-w-[1000px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="py-2">Nº Doc</th>
                  <th scope="col" className="py-2">BL</th>
                  <th scope="col" className="py-2">Cliente</th>
                  <th scope="col" className="py-2">Emissão</th>
                  <th scope="col" className="py-2">Total USD</th>
                  <th scope="col" className="py-2">Total BRL</th>
                  <th scope="col" className="py-2">Status</th>
                  <th scope="col" className="py-2">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {invoices.map((invoice) => {
                  const customer = (invoice as { customer?: { name?: string } }).customer
                  const hasDiscount = (invoice.discount_value ?? 0) > 0
                  const disputeActive = invoice.dispute_open
                  const disputePast = !invoice.dispute_open && invoice.dispute_status != null
                  return (
                    <tr key={invoice.id}>
                      <td className="py-2 font-mono text-xs text-white">{invoice.doc_number}</td>
                      <td className="py-2 text-blue-400">{invoice.bl_id}</td>
                      <td className="py-2">{customer?.name ?? '—'}</td>
                      <td className="py-2">{invoice.billed_at ? formatDate(invoice.billed_at) : '—'}</td>
                      <td className="py-2 font-semibold text-amber-400">{fmtUSD(invoice.total_usd)}</td>
                      <td className="py-2 font-semibold text-green-400">
                        {fmtBRL(invoice.current_total_brl)}
                        {invoice.roe_source === 'cached' && (
                          <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-xs text-amber-400" title="ROE via cache (BCB offline)">ROE cache</span>
                        )}
                      </td>
                      <td className="py-2"><InvoiceStatusBadge status={invoice.status} /></td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <Button variant="ghost" className="app-btn--sm" onClick={() => onOpenDetail(invoice.id)}>Detalhes</Button>
                          <Button variant="ghost" className={`app-btn--sm ${hasDiscount ? 'text-[var(--app-green)]' : ''}`} onClick={() => onOpenDiscount(invoice)}>Desconto</Button>
                          <Button variant="ghost" className={`app-btn--sm ${disputeActive ? 'text-[var(--app-gold)]' : disputePast ? 'text-[var(--app-muted)]' : ''}`} onClick={() => onOpenDispute(invoice)}>Disputa</Button>
                          {invoice.status === 'issued' && (
                            <>
                              <Button variant="secondary" className="app-btn--sm" onClick={() => onOpenPayment(invoice.id)}>Registrar Pgto</Button>
                              <Button variant="ghost" className="app-btn--sm" onClick={() => onOpenDocument(invoice.id, 'invoice')}>Fatura</Button>
                              <Button variant="ghost" className="app-btn--sm" onClick={() => onCancel(invoice.id)}>Cancelar</Button>
                            </>
                          )}
                          {invoice.status === 'paid' && (
                            <>
                              <Button variant="ghost" className="app-btn--sm" onClick={() => onOpenDocument(invoice.id, 'receipt')}>Recibo</Button>
                              <Button variant="ghost" className="app-btn--sm" onClick={() => onOpenDocument(invoice.id, 'invoice')}>Fatura</Button>
                              <Button variant="ghost" className="app-btn--sm" onClick={() => onReversePayment(invoice.id)}>Cancelar baixa</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
