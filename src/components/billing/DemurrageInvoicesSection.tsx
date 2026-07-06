import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { InvoiceDocument as DemurrageInvoiceDoc } from '../demurrage/InvoiceDocument'
import { listDemurrageInvoices, getInvoiceDetail as getDemurrageInvoiceDetail } from '../../services/demurrage/demurrageInvoices'
import type { DemurrageInvoiceDetail } from '../../types/database'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { SkeletonTable } from '../ui/Skeleton'
import { Modal } from '../ui/Modal'
import { formatBRL, formatDate, formatUSD } from '../../lib/utils'

type DemurrageInvoicesPanelProps = {
  query: { data?: Awaited<ReturnType<typeof listDemurrageInvoices>>; isLoading: boolean; error: unknown }
  onOpenDetail: (id: number) => void
}

export function DemurrageInvoicesSection({ active }: { active: boolean }) {
  const [demurrageInvoiceId, setDemurrageInvoiceId] = useState<number | null>(null)

  const demurrageInvoicesQuery = useQuery({
    queryKey: ['demurrage-invoices', 'faturamento'],
    queryFn: () => listDemurrageInvoices(),
    staleTime: 30_000,
    enabled: active,
  })

  const demurrageDetailQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', 'faturamento', demurrageInvoiceId],
    queryFn: () => getDemurrageInvoiceDetail(demurrageInvoiceId!),
    enabled: demurrageInvoiceId != null,
  })

  return (
    <>
      {active ? (
        <DemurrageInvoicesPanel
          query={demurrageInvoicesQuery}
          onOpenDetail={(id) => setDemurrageInvoiceId(id)}
        />
      ) : null}

      <Modal
        open={demurrageInvoiceId != null}
        onClose={() => setDemurrageInvoiceId(null)}
        title={`Fatura Demurrage ${demurrageDetailQuery.data?.invoice?.doc_number ?? ''}`}
      >
        <div className="p-2">
          {demurrageDetailQuery.isLoading ? (
            <div className="p-4 text-sm text-slate-400">Carregando...</div>
          ) : demurrageDetailQuery.data ? (
            <>
              <div className="mb-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => window.print()}>
                  <Printer size={16} />Imprimir
                </Button>
              </div>
              <div className="invoice-print-content">
                <DemurrageInvoiceDoc
                  detail={demurrageDetailQuery.data as unknown as DemurrageInvoiceDetail}
                  type={demurrageDetailQuery.data.invoice?.status === 'paid' ? 'receipt' : 'invoice'}
                />
              </div>
            </>
          ) : (
            <div className="p-4 text-sm text-slate-400">Falha ao carregar.</div>
          )}
        </div>
      </Modal>
    </>
  )
}

function DemurrageInvoicesPanel({ query, onOpenDetail }: DemurrageInvoicesPanelProps) {
  const invoices = useMemo(() => query.data ?? [], [query.data])
  const summary = useMemo(() => {
    const open = invoices.filter((row) => row.status === 'issued' || row.status === 'overdue')
    const openBalance = open.reduce((sum, row) => sum + Number(row.current_total_brl ?? 0), 0)
    const totalUsd = invoices.reduce((sum, row) => sum + Number(row.total_usd ?? 0), 0)
    return {
      total: invoices.length,
      openCount: open.length,
      openBalance,
      totalUsd,
    }
  }, [invoices])

  return (
    <>
      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="Faturas demurrage" value={String(summary.total)} />
        <MetricCard label="Em aberto" value={String(summary.openCount)} />
        <MetricCard label="Saldo aberto (BRL)" value={formatBRL(summary.openBalance)} />
        <MetricCard label="Total USD" value={formatUSD(summary.totalUsd)} />
      </div>

      <Card className="mb-3 border border-blue-900/40 bg-blue-950/20 p-4 text-sm text-slate-300">
        Faturas de demurrage sao geradas e gerenciadas em <a className="text-blue-400 underline" href="/demurrage">/demurrage</a>.
        Esta visao agrega para acompanhamento financeiro unificado.
      </Card>

      <Card className="overflow-hidden p-0">
        {query.error ? <InlineError message="Erro ao carregar invoices de demurrage." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[980px] table-fixed text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="w-[18%] px-4 py-3">Nº Doc</th>
                <th scope="col" className="w-[12%] px-4 py-3">B/L</th>
                <th scope="col" className="w-[22%] px-4 py-3">Cliente</th>
                <th scope="col" className="w-[12%] px-4 py-3">Emissão</th>
                <th scope="col" className="w-[12%] px-4 py-3">Vencimento</th>
                <th scope="col" className="w-[10%] px-4 py-3">Total USD</th>
                <th scope="col" className="w-[10%] px-4 py-3">Total BRL</th>
                <th scope="col" className="w-[8%] px-4 py-3">Status</th>
                <th scope="col" className="w-[8%] px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {query.isLoading ? <tr><td colSpan={9} className="p-0"><SkeletonTable rows={6} cols={9} /></td></tr> : null}
              {!query.isLoading && invoices.length === 0 ? (
                <tr><td colSpan={9} className="p-0"><EmptyState title="Nenhuma fatura de demurrage." description="Gere em /demurrage quando containers ficarem em atraso." /></td></tr>
              ) : null}
              {invoices.map((inv) => {
                const customerName = (inv as { customer?: { name?: string | null } }).customer?.name ?? '-'
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 font-mono text-xs text-white">{inv.doc_number}</td>
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]">{inv.bl_id}</td>
                    <td className="px-4 py-3">{customerName}</td>
                    <td className="px-4 py-3">{inv.billed_at ? formatDate(inv.billed_at) : '-'}</td>
                    <td className="px-4 py-3">{inv.due_date ? formatDate(inv.due_date) : '-'}</td>
                    <td className="px-4 py-3 text-amber-400">{formatUSD(Number(inv.total_usd ?? 0))}</td>
                    <td className="px-4 py-3 text-green-400">{formatBRL(Number(inv.current_total_brl ?? 0))}</td>
                    <td className="px-4 py-3">{renderDemurrageStatus(inv.status)}</td>
                    <td className="px-4 py-3"><Button variant="secondary" onClick={() => onOpenDetail(inv.id)}>Detalhes</Button></td>
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

function renderDemurrageStatus(status: string | null | undefined) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'issued') return <Badge tone="blue">Emitida</Badge>
  if (status === 'overdue') return <Badge tone="yellow">Vencida</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelada</Badge>
  return <Badge tone="yellow">Draft</Badge>
}
