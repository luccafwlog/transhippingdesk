import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, FileText, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { InvoiceDocument } from '../components/demurrage/InvoiceDocument'
import {
  calculateDemurrage,
  cancelDemurrageInvoice,
  createInvoiceForBL,
  fetchDemurrageKPIs,
  fetchROE,
  getInvoiceDetail,
  issueInvoice,
  listDemurrageContainers,
  listDemurrageInvoices,
  markInvoicePaid,
  unissueInvoice,
  unmarkInvoicePaid,
} from '../services/demurrage'
import type { DemurrageContainerListItem, DemurrageInvoice, DemurrageInvoiceDetail } from '../types/database'
import { formatDate } from '../lib/utils'

type DemurrageTab = 'containers' | 'rascunhos' | 'emitidas' | 'pagas'
type InvoiceStatus = 'draft' | 'issued' | 'paid'

function fmtUSD(v: number | null | undefined) {
  if (v == null) return '—'
  return '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtBRL(v: number | null | undefined) {
  if (v == null) return '—'
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function DemurrageStatusBadge({ status }: { status: string | null }) {
  if (status === 'returned') return <Badge tone="slate">Devolvido</Badge>
  if (status === 'overdue') return <Badge tone="red">Em atraso</Badge>
  return <Badge tone="green">Free time</Badge>
}

function InvoiceStatusBadge({ status }: { status: DemurrageInvoice['status'] }) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'issued') return <Badge tone="blue">Faturado</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelado</Badge>
  return <Badge tone="yellow">Rascunho</Badge>
}

function groupByBl(containers: DemurrageContainerListItem[]): Map<string, DemurrageContainerListItem[]> {
  const map = new Map<string, DemurrageContainerListItem[]>()
  for (const c of containers) {
    const blId = c.bl_id ?? 'unknown'
    if (!map.has(blId)) map.set(blId, [])
    map.get(blId)!.push(c)
  }
  return map
}

const TAB_LABELS: { key: DemurrageTab; label: string }[] = [
  { key: 'containers', label: 'Containers' },
  { key: 'rascunhos', label: 'Rascunhos' },
  { key: 'emitidas', label: 'Emitidas' },
  { key: 'pagas', label: 'Pagas' },
]

const TAB_TO_STATUS: Record<Exclude<DemurrageTab, 'containers'>, InvoiceStatus> = {
  rascunhos: 'draft',
  emitidas: 'issued',
  pagas: 'paid',
}

export function Demurrage() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [tab, setTab] = useState<DemurrageTab>('containers')
  const [search, setSearch] = useState('')
  const [generatingBl, setGeneratingBl] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Invoice panel state
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null)
  const [docType, setDocType] = useState<'invoice' | 'receipt'>('invoice')
  const [payingId, setPayingId] = useState<number | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [roeOfflineWarning, setRoeOfflineWarning] = useState<string | null>(null)

  const { data: containers, isLoading: containersLoading, error: containersError } = useQuery({
    queryKey: ['demurrage-containers'],
    queryFn: () => listDemurrageContainers(),
    staleTime: 60_000,
    enabled: tab === 'containers',
  })

  const { data: kpis } = useQuery({
    queryKey: ['demurrage-kpis'],
    queryFn: fetchDemurrageKPIs,
    staleTime: 60_000,
  })

  const invoiceStatus = tab !== 'containers' ? TAB_TO_STATUS[tab] : null
  const { data: invoices, isLoading: invoicesLoading, error: invoicesError } = useQuery({
    queryKey: ['demurrage-invoices', invoiceStatus],
    queryFn: () => listDemurrageInvoices({ status: invoiceStatus! }),
    staleTime: 30_000,
    enabled: invoiceStatus != null,
  })

  const { data: invoiceDetail } = useQuery({
    queryKey: ['demurrage-invoice-detail', viewInvoiceId],
    queryFn: () => getInvoiceDetail(viewInvoiceId!),
    enabled: viewInvoiceId != null,
  })

  function invalidateInvoices() {
    void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
  }

  const generateMutation = useMutation({
    mutationFn: (blId: string) => createInvoiceForBL(blId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] })
      invalidateInvoices()
      showToast('Invoice de demurrage criada com sucesso.', 'success')
    },
    onError: (err: Error) => showToast(err.message ?? 'Erro ao gerar invoice.', 'error'),
    onSettled: () => setGeneratingBl(null),
  })

  const issueMutation = useMutation({
    mutationFn: async (id: number) => {
      const result = await fetchROE()
      if (result.offline) setRoeOfflineWarning(result.cachedAt)
      await issueInvoice(id, result.roe)
    },
    onSuccess: () => { invalidateInvoices(); showToast('Fatura emitida. Valores congelados.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const unissueMutation = useMutation({
    mutationFn: unissueInvoice,
    onSuccess: () => { invalidateInvoices(); showToast('Emissao revertida.', 'success') },
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
    onSuccess: () => { invalidateInvoices(); setPayingId(null); showToast('Pagamento registrado.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const unpayMutation = useMutation({
    mutationFn: unmarkInvoicePaid,
    onSuccess: () => { invalidateInvoices(); showToast('Pagamento desmarcado.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelDemurrageInvoice,
    onSuccess: () => { invalidateInvoices(); showToast('Invoice cancelada.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const filtered = (containers ?? []).filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.container_number.toLowerCase().includes(q) ||
      (c.bl_id ?? '').toLowerCase().includes(q) ||
      ((c.bl as { customer?: { name?: string } } | null)?.customer?.name ?? '').toLowerCase().includes(q)
    )
  })

  const grouped = groupByBl(filtered)

  const totalOverdueUSD = filtered.reduce((sum, c) => {
    if (!c.discharge_date || !c.return_date) return sum
    const bl = c.bl as { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null
    return sum + calculateDemurrage(c.type, c.discharge_date, c.return_date, bl?.free_time_override, bl?.demurrage_rate_override_p1_usd, bl?.demurrage_rate_override_p2_usd).total_usd
  }, 0)

  return (
    <>
      <ContainerDatesImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      <PageHeader
        title="Demurrage"
        description="Rastreamento e faturamento de sobreestadia de containers"
        action={
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload size={15} />
            Importar Datas
          </Button>
        }
      />

      {/* KPI bar — always visible */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-slate-400">Containers em atraso</div>
          <div className="text-2xl font-bold text-red-400">{kpis?.overdueContainers ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Total USD (visivel)</div>
          <div className="text-2xl font-bold text-amber-400">{fmtUSD(totalOverdueUSD)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Invoices draft (USD)</div>
          <div className="text-2xl font-bold text-slate-300">{kpis ? fmtUSD(kpis.draftInvoicesTotalUsd) : '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Aguard. pagamento (BRL)</div>
          <div className="text-2xl font-bold text-blue-400">
            {kpis ? fmtBRL(kpis.issuedInvoicesTotalBrl) : '—'}
          </div>
        </Card>
      </div>

      {/* ROE offline warning */}
      {roeOfflineWarning ? (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          BCB offline — usando PTAX em cache de {new Date(roeOfflineWarning).toLocaleString('pt-BR')}. Verifique a taxa antes de emitir faturas.
        </div>
      ) : null}

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-[#30363d]">
        {TAB_LABELS.map((t) => (
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

      {/* ── Tab: Containers ── */}
      {tab === 'containers' ? (
        <>
          <Card className="mb-4 p-4">
            <Field label="Buscar">
              <Input placeholder="Container, BL ou cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
          </Card>

          {containersLoading && <Card>Carregando...</Card>}
          {containersError && <InlineError message="Erro ao carregar containers." />}

          {!containersLoading && !containersError && grouped.size === 0 && (
            <EmptyState icon={Clock} title="Nenhum container ativo" description="Todos os containers foram devolvidos ou nao ha descargas registradas." />
          )}

          {Array.from(grouped.entries()).map(([blId, blContainers]) => {
            const firstBl = blContainers[0].bl as { customer?: { name?: string } | null; voyage?: { voyage_number?: string; vessel?: { name?: string } | null } | null } | null
            const customerName = firstBl?.customer?.name ?? blId
            const voyageInfo = firstBl?.voyage?.voyage_number ? `${firstBl.voyage.voyage_number} — ${firstBl.voyage.vessel?.name ?? ''}` : ''
            const hasOverdue = blContainers.some((c) => c.demurrage_status === 'overdue')
            const blTotalUSD = blContainers.reduce((sum, c) => {
              if (!c.discharge_date || !c.return_date) return sum
              const blData = c.bl as { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null
              return sum + calculateDemurrage(c.type, c.discharge_date, c.return_date, blData?.free_time_override, blData?.demurrage_rate_override_p1_usd, blData?.demurrage_rate_override_p2_usd).total_usd
            }, 0)

            return (
              <Card key={blId} className="mb-4">
                <div className="flex items-start justify-between gap-4 border-b border-[#30363d] p-4">
                  <div>
                    <Link to={`/manifestos/${blId}`} className="font-semibold text-blue-400 hover:underline">{blId}</Link>
                    <div className="text-sm text-slate-400">{customerName}</div>
                    {voyageInfo && <div className="text-xs text-slate-500">{voyageInfo}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    {blTotalUSD > 0 && <span className="text-sm font-semibold text-amber-400">{fmtUSD(blTotalUSD)}</span>}
                    {hasOverdue && (
                      <Button
                        variant="secondary"
                        disabled={generatingBl === blId}
                        onClick={() => { setGeneratingBl(blId); generateMutation.mutate(blId) }}
                      >
                        <FileText size={14} />
                        {generatingBl === blId ? 'Gerando...' : 'Gerar Invoice'}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="app-table app-table--compact min-w-[820px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2">Container</th>
                        <th className="py-2">Tipo</th>
                        <th className="py-2">Descarga</th>
                        <th className="py-2">Devolucao</th>
                        <th className="py-2">Dias totais</th>
                        <th className="py-2">Status</th>
                        <th className="py-2">USD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {blContainers.map((c) => {
                        const blData = c.bl as { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null
                        const calc = c.discharge_date && c.return_date ? calculateDemurrage(c.type, c.discharge_date, c.return_date, blData?.free_time_override, blData?.demurrage_rate_override_p1_usd, blData?.demurrage_rate_override_p2_usd) : null
                        return (
                          <tr key={c.id}>
                            <td className="py-2 font-semibold text-white">{c.container_number}</td>
                            <td className="py-2">{c.type ?? '-'}</td>
                            <td className="py-2">{c.discharge_date ? formatDate(c.discharge_date) : '—'}</td>
                            <td className="py-2">{c.return_date ? formatDate(c.return_date) : <span className="text-slate-500">Pendente</span>}</td>
                            <td className="py-2">{calc ? calc.total_days : '—'}</td>
                            <td className="py-2"><DemurrageStatusBadge status={c.demurrage_status} /></td>
                            <td className="py-2 font-semibold text-amber-400">{calc && calc.total_usd > 0 ? fmtUSD(calc.total_usd) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          })}
        </>
      ) : null}

      {/* ── Tabs: Rascunhos / Emitidas / Pagas ── */}
      {tab !== 'containers' ? (
        <>
          {invoicesLoading && <Card>Carregando...</Card>}
          {invoicesError && <InlineError message="Erro ao carregar invoices." />}
          {!invoicesLoading && !invoicesError && !invoices?.length && (
            <EmptyState
              icon={FileText}
              title="Nenhuma invoice"
              description={
                tab === 'rascunhos'
                  ? 'Nenhum rascunho. Faturas geradas por importacao sao emitidas automaticamente — rascunhos aparecem apenas quando a BCB esta offline.'
                  : `Nenhuma invoice com status "${tab}".`
              }
            />
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
                          <td className="py-2"><InvoiceStatusBadge status={inv.status} /></td>
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
        </>
      ) : null}

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
