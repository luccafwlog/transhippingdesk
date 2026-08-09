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
      {!loading && !error && !invoices?.length && (
        <EmptyState icon={FileText} title="Nenhuma fatura" description={`Nenhuma fatura com status "${tab}".`} />
      )}

      {invoices && invoices.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="billing-table__head flex flex-col gap-1 border-b px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-white">{formatResultCount(invoices.length, 'fatura visível', 'faturas visíveis')}</span>
            <span className="text-xs">Filtros ativos: Status {tabLabel}</span>
          </div>
          <div className="app-table-scroll app-table-scroll--sticky">
            <table className="app-table app-table--compact min-w-[1200px] text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3">Documento / BL</th><th scope="col" className="px-4 py-3">Cliente</th><th scope="col" className="px-4 py-3">Emissão</th><th scope="col" className="px-4 py-3">Financeiro</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const customer = (invoice as { customer?: { name?: string } }).customer
                  const hasDiscount = (invoice.discount_value ?? 0) > 0
                  const disputeActive = invoice.dispute_open
                  const disputePast = !invoice.dispute_open && invoice.dispute_status != null
                  return (
                    <tr key={invoice.id}>
                      <td className="px-4 py-3"><div className="app-table__cell-stack" data-testid="demurrage-invoice-context"><div className="font-semibold text-white">{invoice.doc_number}</div><div className="app-table__cell-value text-blue-400">{invoice.bl_id}</div></div></td>
                      <td className="px-4 py-3"><div className="app-table__cell-stack"><div className="app-table__cell-value app-table__truncate app-table__truncate--xl" title={customer?.name ?? '—'}>{customer?.name ?? '—'}</div><div className="app-table__cell-meta">{(invoice as { customer?: { cnpj_cpf?: string } }).customer?.cnpj_cpf ?? 'Cliente não identificado'}</div></div></td>
                      <td className="px-4 py-3">{invoice.billed_at ? formatDate(invoice.billed_at) : <span className="text-slate-500">—</span>}</td>
                      <td className="px-4 py-3"><div className="app-table__cell-stack" data-testid="demurrage-invoice-financial"><div className="app-table__cell-value app-table__cell-value--financial">USD {fmtUSD(invoice.total_usd)}</div><div className="app-table__cell-meta text-green-400">BRL {fmtBRL(invoice.current_total_brl)}</div>
                        {invoice.roe_source === 'cached' && (
                          <div className="app-table__cell-meta">ROE via cache</div>
                        )}
                      </div></td>
                      <td className="px-4 py-3"><InvoiceStatusBadge status={invoice.status} /></td>
                      <td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2">
                        <div data-testid="demurrage-invoice-primary-action"><Button variant="secondary" onClick={() => onOpenDetail(invoice.id)}>Detalhes</Button></div>
                        <div className="flex flex-wrap items-center gap-1" data-testid="demurrage-invoice-secondary-actions">
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
                        </div></div>
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
