import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import {
  cancelDemurrageInvoice,
  fetchROE,
  getInvoiceDetail,
  issueInvoice,
  listDemurrageInvoices,
  markInvoicePaid,
  unissueInvoice,
  unmarkInvoicePaid,
} from '../services/demurrage'
import { InvoiceDocument } from '../components/demurrage/InvoiceDocument'
import type { DemurrageInvoice, DemurrageInvoiceDetail } from '../types/database'
import { formatDate } from '../lib/utils'

type Tab = 'draft' | 'issued' | 'paid'

function fmtUSD(v: number | null | undefined) {
  if (v == null) return '—'
  return '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtBRL(v: number | null | undefined) {
  if (v == null) return '—'
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatusBadge({ status }: { status: DemurrageInvoice['status'] }) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'issued') return <Badge tone="blue">Faturado</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelado</Badge>
  return <Badge tone="yellow">Rascunho</Badge>
}

export function DemurrageInvoices() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('draft')
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null)
  const [docType, setDocType] = useState<'invoice' | 'receipt'>('invoice')
  const [payingId, setPayingId] = useState<number | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [roeOfflineWarning, setRoeOfflineWarning] = useState<string | null>(null)

  const { data: invoices, isLoading, error } = useQuery({
    queryKey: ['demurrage-invoices', tab],
    queryFn: () => listDemurrageInvoices({ status: tab }),
    staleTime: 30_000,
  })

  const { data: invoiceDetail } = useQuery({
    queryKey: ['demurrage-invoice-detail', viewInvoiceId],
    queryFn: () => getInvoiceDetail(viewInvoiceId!),
    enabled: viewInvoiceId != null,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
  }

  const issueMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await fetchROE()
      if (result.offline) setRoeOfflineWarning(result.cachedAt)
      await issueInvoice(id, result.roe)
    },
    onSuccess: () => { invalidate(); showToast('Fatura emitida. Valores congelados.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const unissueMutation = useMutation({
    mutationFn: unissueInvoice,
    onSuccess: () => { invalidate(); showToast('Emissao revertida.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const payMutation = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) => {
      const inv = invoices?.find((i) => i.id === id)
      let roe = inv?.frozen_roe ?? null
      if (!roe) {
        const result = await fetchROE()
        if (result.offline) setRoeOfflineWarning(result.cachedAt)
        roe = result.roe
      }
      await markInvoicePaid(id, date, roe)
    },
    onSuccess: () => { invalidate(); setPayingId(null); showToast('Pagamento registrado.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const unpayMutation = useMutation({
    mutationFn: unmarkInvoicePaid,
    onSuccess: () => { invalidate(); showToast('Pagamento desmarcado.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelDemurrageInvoice,
    onSuccess: () => { invalidate(); showToast('Invoice cancelada.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const tabs: { key: Tab; label: string }[] = [
    { key: 'draft', label: 'Rascunhos' },
    { key: 'issued', label: 'Faturados' },
    { key: 'paid', label: 'Pagos' },
  ]

  return (
    <>
      <PageHeader title="Invoices D&D" description="Faturamento de sobreestadia de containers" />

      {roeOfflineWarning ? (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          BCB offline — usando PTAX em cache de {new Date(roeOfflineWarning).toLocaleString('pt-BR')}. Verifique a taxa antes de emitir faturas.
        </div>
      ) : null}

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-[#30363d]">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <Card>Carregando...</Card>}
      {error && <InlineError message="Erro ao carregar invoices." />}
      {!isLoading && !error && !invoices?.length && (
        <EmptyState icon={FileText} title="Nenhuma invoice" description={`Nenhuma invoice com status "${tab}".`} />
      )}

      {invoices && invoices.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="app-table min-w-[900px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Nº Doc</th>
                  <th className="py-2">BL</th>
                  <th className="py-2">Cliente</th>
                  <th className="py-2">Emissao</th>
                  <th className="py-2">Vencimento</th>
                  <th className="py-2">Total USD</th>
                  <th className="py-2">Total BRL</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {invoices.map((inv) => {
                  const customer = (inv as { customer?: { name?: string } }).customer
                  return (
                    <tr key={inv.id}>
                      <td className="py-2 font-mono text-xs text-white">{inv.doc_number}</td>
                      <td className="py-2 text-blue-400">{inv.bl_id}</td>
                      <td className="py-2">{customer?.name ?? '—'}</td>
                      <td className="py-2">{inv.billed_at ? formatDate(inv.billed_at) : '—'}</td>
                      <td className="py-2">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                      <td className="py-2 font-semibold text-amber-400">{fmtUSD(inv.total_usd)}</td>
                      <td className="py-2 font-semibold text-green-400">{fmtBRL(inv.frozen_total_brl)}</td>
                      <td className="py-2"><StatusBadge status={inv.status} /></td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {inv.status === 'draft' && (
                            <>
                              <Button variant="secondary" onClick={() => issueMutation.mutate(inv.id)}>Emitir</Button>
                              <Button variant="ghost" onClick={() => cancelMutation.mutate(inv.id)}>Cancelar</Button>
                            </>
                          )}
                          {inv.status === 'issued' && (
                            <>
                              <Button variant="secondary" onClick={() => setPayingId(inv.id)}>Registrar Pgto</Button>
                              <Button variant="ghost" onClick={() => unissueMutation.mutate(inv.id)}>Desemitir</Button>
                              <Button variant="ghost" onClick={() => { setViewInvoiceId(inv.id); setDocType('invoice') }}>Fatura</Button>
                            </>
                          )}
                          {inv.status === 'paid' && (
                            <>
                              <Button variant="ghost" onClick={() => { setViewInvoiceId(inv.id); setDocType('receipt') }}>Recibo</Button>
                              <Button variant="ghost" onClick={() => { setViewInvoiceId(inv.id); setDocType('invoice') }}>Fatura</Button>
                              <Button variant="ghost" onClick={() => unpayMutation.mutate(inv.id)}>Desmarcar</Button>
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

      {/* Payment modal */}
      <Modal open={payingId != null} onClose={() => setPayingId(null)} title="Registrar Pagamento">
        <div className="space-y-4 p-4">
          <label className="block text-sm text-slate-300">
            Data do pagamento
            <input type="date" className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button onClick={() => payingId && payMutation.mutate({ id: payingId, date: payDate })}>Confirmar</Button>
            <Button variant="ghost" onClick={() => setPayingId(null)}>Cancelar</Button>
          </div>
        </div>
      </Modal>

      {/* Invoice/receipt viewer */}
      {viewInvoiceId && invoiceDetail && (
        <Modal open onClose={() => setViewInvoiceId(null)} title={docType === 'invoice' ? 'Fatura de Demurrage' : 'Recibo de Quitacao'}>
          <div className="p-2">
            <div className="mb-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>
            </div>
            <InvoiceDocument detail={invoiceDetail as unknown as DemurrageInvoiceDetail} type={docType} />
          </div>
        </Modal>
      )}
    </>
  )
}
