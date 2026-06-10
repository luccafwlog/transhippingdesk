import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { SkeletonTable } from '../ui/Skeleton'
import {
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
  type InvoiceListBl,
  type InvoiceListRow,
} from '../../services/billing'
import { invoiceStatusLabel, invoiceStatusTone } from '../../pages/faturamentoInvoiceStatus'
import { formatBRL, formatDate } from '../../lib/utils'

type InvoicesTableProps = {
  invoices: InvoiceListRow[]
  isLoading: boolean
  error: unknown
  totalCount: number
  filterDescription: string
  emptyState: { title: string; description?: string }
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onSelectInvoice: (invoiceId: number) => void
}

export function InvoicesTable({
  invoices,
  isLoading,
  error,
  totalCount,
  filterDescription,
  emptyState,
  page,
  totalPages,
  onPageChange,
  onSelectInvoice,
}: InvoicesTableProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{totalCount} fatura(s) retornada(s)</span>
        <span className="text-xs text-slate-400">{filterDescription}</span>
      </div>
      {error ? <InlineError message="Erro ao carregar faturamento." /> : null}
      <div className="app-table-scroll app-table-scroll--sticky">
        <table className="app-table app-table--compact min-w-[1200px] text-left text-sm">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-4 py-3">Número do BL</th><th scope="col" className="px-4 py-3">Fatura</th><th scope="col" className="px-4 py-3">Tipo</th><th scope="col" className="px-4 py-3">Navio / Viagem · POD</th><th scope="col" className="px-4 py-3">Emissão</th><th scope="col" className="px-4 py-3">Pagamento</th><th scope="col" className="px-4 py-3">Financeiro</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Ações</th></tr></thead>
          <tbody className="divide-y divide-[#30363d]">
            {isLoading ? <tr><td colSpan={9} className="p-0"><SkeletonTable rows={6} cols={9} /></td></tr> : null}
            {!isLoading && invoices.length === 0 ? <tr><td colSpan={9} className="p-0"><EmptyState title={emptyState.title} description={emptyState.description} /></td></tr> : null}
            {invoices.map((invoice) => {
              const bls = getInvoiceBls(invoice)
              const consolidated = isConsolidatedInvoice(invoice)
              const paymentDate = getInvoicePaymentDate(invoice)
              return (
              <tr key={invoice.id}>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#58a6ff]">{formatBlIds(bls)}</span>
                      <Badge tone={consolidated ? 'blue' : 'slate'}>{bls.length} B/L{bls.length === 1 ? '' : 's'}</Badge>
                    </div>
                    {consolidated ? <div className="app-table__cell-meta">Consolidada · {bls.length} BLs agrupados</div> : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="font-semibold text-white">{invoice.invoice_number ?? `INV-${invoice.id}`}</div>
                    <div className="app-table__cell-value">
                      <span className="app-table__truncate app-table__truncate--xl" title={invoice.customer?.name ?? '-'}>
                        {invoice.customer?.name ?? '-'}
                      </span>
                    </div>
                    <div className="app-table__cell-meta">{invoice.customer?.cnpj_cpf ?? 'Cliente não identificado'}</div>
                  </div>
                </td>
                <td className="px-4 py-3"><Badge tone={consolidated ? 'blue' : 'slate'}>{consolidated ? 'Consolidada' : 'Único BL'}</Badge></td>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="app-table__cell-value">
                      <span className="app-table__truncate app-table__truncate--xl" title={formatVesselVoyage(bls)}>{formatVesselVoyage(bls)}</span>
                    </div>
                    <div className="app-table__cell-meta">POD {formatPodList(bls)}</div>
                  </div>
                </td>
                <td className="px-4 py-3">{formatDate(invoice.issued_at)}</td>
                <td className="px-4 py-3">{paymentDate ? formatDate(paymentDate) : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="app-table__cell-stack">
                    <div className="app-table__cell-value app-table__cell-value--financial">Total {formatBRL(invoice.total_brl)}</div>
                    <div className="app-table__cell-meta">Pago {formatBRL(invoice.total_paid_brl)}</div>
                    <div className="app-table__cell-meta">Saldo {formatBRL(invoice.balance_brl)}</div>
                  </div>
                </td>
                <td className="px-4 py-3">{renderInvoiceStatus(invoice.status)}</td>
                <td className="px-4 py-3"><Button variant="secondary" onClick={() => onSelectInvoice(invoice.id)}>Detalhes</Button></td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="app-table__footer"><span>Pagina {page} de {totalPages} · {totalCount} registros</span><div className="app-table__footer-controls"><Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Anterior</Button><Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>Proxima</Button></div></div>
    </Card>
  )
}

function renderInvoiceStatus(status: string | null) {
  return <Badge tone={invoiceStatusTone(status)}>{invoiceStatusLabel(status)}</Badge>
}

function formatBlIds(bls: InvoiceListBl[]) {
  const ids = bls.map((bl) => bl.bl_id)
  if (ids.length === 0) return 'Sem B/L'
  if (ids.length <= 2) return ids.join(' • ')
  return `${ids.slice(0, 2).join(' • ')} +${ids.length - 2}`
}

function formatVesselVoyage(bls: InvoiceListBl[]) {
  const labels = Array.from(
    new Set(
      bls
        .map((bl) => [bl.vessel_name, bl.voyage_number].filter(Boolean).join(' · '))
        .filter((label) => label.length > 0),
    ),
  )
  if (labels.length === 0) return '—'
  if (labels.length === 1) return labels[0]
  return `${labels[0]} +${labels.length - 1}`
}

function formatPodList(bls: InvoiceListBl[]) {
  const pods = Array.from(new Set(bls.map((bl) => bl.pod).filter((pod): pod is string => Boolean(pod))))
  if (pods.length === 0) return '—'
  if (pods.length === 1) return pods[0]
  return `${pods[0]} +${pods.length - 1}`
}
