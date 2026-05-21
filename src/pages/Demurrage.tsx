import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, FileText, Pencil, Upload } from 'lucide-react'
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
  updateContainerDates,
  updateDemurrageInvoice,
} from '../services/demurrage'
import type { DemurrageContainerListItem, DemurrageInvoice, DemurrageInvoiceDetail, DemurrageInvoiceItem } from '../types/database'
import { formatDate } from '../lib/utils'

type DemurrageTab = 'containers' | 'rascunhos' | 'emitidas' | 'pagas'
type InvoiceStatus = 'draft' | 'issued' | 'paid'

type DiscountForm = {
  discount_type: DemurrageInvoice['discount_type']
  discount_value: string
  discount_mode: 'percent' | 'fixed'
  discount_justification: string
  discount_approver: string
}

type DisputeForm = {
  dispute_open: boolean
  dispute_subject: string
  dispute_reason: string
  dispute_status: DemurrageInvoice['dispute_status']
  dispute_notes: string
}

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

const DISCOUNT_TYPE_LABELS: Record<NonNullable<DemurrageInvoice['discount_type']>, string> = {
  comercial: 'Comercial',
  datas: 'Datas',
  cortesia: 'Cortesia',
  acordo: 'Acordo',
  erro: 'Erro',
}

const DISPUTE_STATUS_LABELS: Record<NonNullable<DemurrageInvoice['dispute_status']>, string> = {
  aberto: 'Aberto',
  resolvido: 'Resolvido',
  cancelado: 'Cancelado',
}

const EMPTY_DISCOUNT: DiscountForm = {
  discount_type: null,
  discount_value: '',
  discount_mode: 'percent',
  discount_justification: '',
  discount_approver: '',
}

const EMPTY_DISPUTE: DisputeForm = {
  dispute_open: false,
  dispute_subject: '',
  dispute_reason: '',
  dispute_status: null,
  dispute_notes: '',
}

export function Demurrage() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [tab, setTab] = useState<DemurrageTab>('containers')
  const [search, setSearch] = useState('')
  const [generatingBl, setGeneratingBl] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const [editingContainer, setEditingContainer] = useState<DemurrageContainerListItem | null>(null)
  const [editDischarge, setEditDischarge] = useState('')
  const [editReturn, setEditReturn] = useState('')

  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null)
  const [docType, setDocType] = useState<'invoice' | 'receipt'>('invoice')
  const [payingId, setPayingId] = useState<number | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [roeOfflineWarning, setRoeOfflineWarning] = useState<string | null>(null)

  const [detailInvoiceId, setDetailInvoiceId] = useState<number | null>(null)
  const [discountInvoiceId, setDiscountInvoiceId] = useState<number | null>(null)
  const [discountForm, setDiscountForm] = useState<DiscountForm>(EMPTY_DISCOUNT)
  const [disputeInvoiceId, setDisputeInvoiceId] = useState<number | null>(null)
  const [disputeForm, setDisputeForm] = useState<DisputeForm>(EMPTY_DISPUTE)

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

  const { data: breakdownDetail } = useQuery({
    queryKey: ['demurrage-invoice-detail', detailInvoiceId],
    queryFn: () => getInvoiceDetail(detailInvoiceId!),
    enabled: detailInvoiceId != null,
  })

  function invalidateInvoices() {
    void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
  }

  function openEditContainer(c: DemurrageContainerListItem) {
    setEditingContainer(c)
    setEditDischarge(c.discharge_date ?? '')
    setEditReturn(c.return_date ?? '')
  }

  function openDiscount(inv: DemurrageInvoice) {
    setDiscountForm({
      discount_type: inv.discount_type,
      discount_value: inv.discount_value != null ? String(inv.discount_value) : '',
      discount_mode: inv.discount_mode ?? 'percent',
      discount_justification: inv.discount_justification ?? '',
      discount_approver: inv.discount_approver ?? '',
    })
    setDiscountInvoiceId(inv.id)
  }

  function openDispute(inv: DemurrageInvoice) {
    setDisputeForm({
      dispute_open: inv.dispute_open ?? false,
      dispute_subject: inv.dispute_subject ?? '',
      dispute_reason: inv.dispute_reason ?? '',
      dispute_status: inv.dispute_status,
      dispute_notes: inv.dispute_notes ?? '',
    })
    setDisputeInvoiceId(inv.id)
  }

  const containerDatesMutation = useMutation({
    mutationFn: ({ id, discharge, ret }: { id: number; discharge: string; ret: string | null }) =>
      updateContainerDates(id, discharge, ret),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] })
      setEditingContainer(null)
      showToast('Datas atualizadas.', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

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
      await issueInvoice(id, result.roe, result.source)
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

  const discountMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: DiscountForm }) =>
      updateDemurrageInvoice(id, {
        discount_type: form.discount_type,
        discount_value: form.discount_value !== '' ? parseFloat(form.discount_value) : null,
        discount_mode: form.discount_mode,
        discount_justification: form.discount_justification || null,
        discount_approver: form.discount_approver || null,
      }),
    onSuccess: () => {
      invalidateInvoices()
      setDiscountInvoiceId(null)
      showToast('Desconto atualizado.', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const disputeMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: DisputeForm }) =>
      updateDemurrageInvoice(id, {
        dispute_open: form.dispute_open,
        dispute_subject: form.dispute_subject || null,
        dispute_reason: form.dispute_reason || null,
        dispute_status: form.dispute_status,
        dispute_notes: form.dispute_notes || null,
      }),
    onSuccess: () => {
      invalidateInvoices()
      setDisputeInvoiceId(null)
      showToast('Disputa atualizada.', 'success')
    },
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
            <EmptyState icon={Clock} title="Nenhum container ativo" description="Todos os containers foram devolvidos ou não há descargas registradas." />
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
                  <table className="app-table app-table--compact min-w-[900px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                      <tr>
                        <th scope="col" className="py-2">Container</th>
                        <th scope="col" className="py-2">Tipo</th>
                        <th scope="col" className="py-2">Descarga</th>
                        <th scope="col" className="py-2">Devolucao</th>
                        <th scope="col" className="py-2">Dias totais</th>
                        <th scope="col" className="py-2">Status</th>
                        <th scope="col" className="py-2">USD</th>
                        <th scope="col" className="py-2"></th>
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
                            <td className="py-2">
                              <button
                                type="button"
                                className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
                                title="Editar datas"
                                onClick={() => openEditContainer(c)}
                              >
                                <Pencil size={14} />
                              </button>
                            </td>
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
                  ? 'Nenhum rascunho. Faturas geradas por importação são emitidas automaticamente — rascunhos aparecem apenas quando a BCB está offline.'
                  : `Nenhuma invoice com status "${tab}".`
              }
            />
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
                      <th scope="col" className="py-2">Emissao</th>
                      <th scope="col" className="py-2">Vencimento</th>
                      <th scope="col" className="py-2">Total USD</th>
                      <th scope="col" className="py-2">Total BRL</th>
                      <th scope="col" className="py-2">Status</th>
                      <th scope="col" className="py-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {invoices.map((inv) => {
                      const customer = (inv as { customer?: { name?: string } }).customer
                      const hasDiscount = (inv.discount_value ?? 0) > 0
                      const disputeActive = inv.dispute_open
                      const disputePast = !inv.dispute_open && inv.dispute_status != null
                      return (
                        <tr key={inv.id}>
                          <td className="py-2 font-mono text-xs text-white">{inv.doc_number}</td>
                          <td className="py-2 text-blue-400">{inv.bl_id}</td>
                          <td className="py-2">{customer?.name ?? '—'}</td>
                          <td className="py-2">{inv.billed_at ? formatDate(inv.billed_at) : '—'}</td>
                          <td className="py-2">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                          <td className="py-2 font-semibold text-amber-400">{fmtUSD(inv.total_usd)}</td>
                          <td className="py-2 font-semibold text-green-400">
                            {fmtBRL(inv.frozen_total_brl)}
                            {inv.roe_source === 'cached' && (
                              <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-xs text-amber-400" title="ROE via cache (BCB offline)">ROE cache</span>
                            )}
                          </td>
                          <td className="py-2"><InvoiceStatusBadge status={inv.status} /></td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-1">
                              <Button
                                variant="ghost"
                                onClick={() => setDetailInvoiceId(inv.id)}
                              >
                                Detalhes
                              </Button>
                              <Button
                                variant="ghost"
                                className={hasDiscount ? 'text-green-400' : ''}
                                onClick={() => openDiscount(inv)}
                              >
                                Desconto
                              </Button>
                              <Button
                                variant="ghost"
                                className={disputeActive ? 'text-amber-400' : disputePast ? 'text-slate-400' : ''}
                                onClick={() => openDispute(inv)}
                              >
                                Disputa
                              </Button>
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

      {/* ── Modal: Editar datas do container ── */}
      <Modal open={editingContainer != null} onClose={() => setEditingContainer(null)} title="Editar datas do container">
        {editingContainer && (
          <div className="space-y-4 p-4">
            <div className="text-sm font-semibold text-white">{editingContainer.container_number}</div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm text-slate-300">
                Data de descarga
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
                  value={editDischarge}
                  onChange={(e) => setEditDischarge(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-300">
                Data de devolução
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
                  value={editReturn}
                  onChange={(e) => setEditReturn(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                loading={containerDatesMutation.isPending}
                onClick={() => {
                  if (!editDischarge) return showToast('Data de descarga obrigatória.', 'error')
                  containerDatesMutation.mutate({ id: editingContainer.id, discharge: editDischarge, ret: editReturn || null })
                }}
              >
                Salvar
              </Button>
              <Button variant="ghost" onClick={() => setEditingContainer(null)}>Cancelar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal: Breakdown da invoice ── */}
      <Modal open={detailInvoiceId != null} onClose={() => setDetailInvoiceId(null)} title="Detalhes da invoice">
        {breakdownDetail ? (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm text-slate-400">
                {breakdownDetail.invoice.doc_number} — {fmtUSD(breakdownDetail.invoice.total_usd)}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="app-table app-table--compact min-w-[700px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="py-2">Container</th>
                    <th scope="col" className="py-2">Tipo</th>
                    <th scope="col" className="py-2">Descarga</th>
                    <th scope="col" className="py-2">Devolucao</th>
                    <th scope="col" className="py-2">Dias</th>
                    <th scope="col" className="py-2">Free</th>
                    <th scope="col" className="py-2">P1</th>
                    <th scope="col" className="py-2">P2</th>
                    <th scope="col" className="py-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {(breakdownDetail.items as DemurrageInvoiceItem[]).map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 font-semibold text-white">{item.container_number}</td>
                      <td className="py-2">{item.container_type}</td>
                      <td className="py-2">{formatDate(item.discharge_date)}</td>
                      <td className="py-2">{formatDate(item.return_date)}</td>
                      <td className="py-2">{item.total_days}d</td>
                      <td className="py-2 text-slate-400">{item.free_days}d</td>
                      <td className="py-2">
                        {item.days_p1 > 0 ? (
                          <span className="text-amber-400">{item.days_p1}d @ ${item.rate_p1_usd}</span>
                        ) : '—'}
                      </td>
                      <td className="py-2">
                        {item.days_p2 > 0 ? (
                          <span className="text-red-400">{item.days_p2}d @ ${item.rate_p2_usd}</span>
                        ) : '—'}
                      </td>
                      <td className="py-2 font-semibold text-amber-400">{fmtUSD(item.subtotal_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end text-sm font-semibold text-amber-400">
              Total: {fmtUSD(breakdownDetail.invoice.total_usd)}
            </div>
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-400">Carregando...</div>
        )}
      </Modal>

      {/* ── Modal: Desconto ── */}
      <Modal open={discountInvoiceId != null} onClose={() => setDiscountInvoiceId(null)} title="Desconto">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm text-slate-300">
              Tipo de desconto
              <select
                className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
                value={discountForm.discount_type ?? ''}
                onChange={(e) => setDiscountForm((f) => ({ ...f, discount_type: (e.target.value || null) as DemurrageInvoice['discount_type'] }))}
              >
                <option value="">Sem desconto</option>
                {(Object.entries(DISCOUNT_TYPE_LABELS) as [NonNullable<DemurrageInvoice['discount_type']>, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Modo
              <select
                className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
                value={discountForm.discount_mode}
                onChange={(e) => setDiscountForm((f) => ({ ...f, discount_mode: e.target.value as 'percent' | 'fixed' }))}
              >
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (BRL)</option>
              </select>
            </label>
          </div>
          <label className="block text-sm text-slate-300">
            Valor do desconto
            <input
              type="number"
              min="0"
              step="0.01"
              className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
              value={discountForm.discount_value}
              onChange={(e) => setDiscountForm((f) => ({ ...f, discount_value: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Justificativa
            <textarea
              rows={2}
              className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
              value={discountForm.discount_justification}
              onChange={(e) => setDiscountForm((f) => ({ ...f, discount_justification: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Aprovador
            <input
              type="text"
              className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
              value={discountForm.discount_approver}
              onChange={(e) => setDiscountForm((f) => ({ ...f, discount_approver: e.target.value }))}
            />
          </label>
          <div className="flex gap-2">
            <Button
              loading={discountMutation.isPending}
              onClick={() => discountInvoiceId && discountMutation.mutate({ id: discountInvoiceId, form: discountForm })}
            >
              Salvar
            </Button>
            <Button variant="ghost" onClick={() => setDiscountInvoiceId(null)}>Cancelar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Disputa ── */}
      <Modal open={disputeInvoiceId != null} onClose={() => setDisputeInvoiceId(null)} title="Disputa">
        <div className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="rounded"
              checked={disputeForm.dispute_open}
              onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_open: e.target.checked }))}
            />
            Disputa em aberto
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm text-slate-300">
              Assunto
              <input
                type="text"
                className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
                value={disputeForm.dispute_subject}
                onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_subject: e.target.value }))}
              />
            </label>
            <label className="block text-sm text-slate-300">
              Status
              <select
                className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
                value={disputeForm.dispute_status ?? ''}
                onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_status: (e.target.value || null) as DemurrageInvoice['dispute_status'] }))}
              >
                <option value="">Sem status</option>
                {(Object.entries(DISPUTE_STATUS_LABELS) as [NonNullable<DemurrageInvoice['dispute_status']>, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm text-slate-300">
            Motivo
            <textarea
              rows={2}
              className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
              value={disputeForm.dispute_reason}
              onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_reason: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Notas
            <textarea
              rows={2}
              className="mt-1 w-full rounded border border-[#30363d] bg-[#161b22] p-2 text-white"
              value={disputeForm.dispute_notes}
              onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_notes: e.target.value }))}
            />
          </label>
          <div className="flex gap-2">
            <Button
              loading={disputeMutation.isPending}
              onClick={() => disputeInvoiceId && disputeMutation.mutate({ id: disputeInvoiceId, form: disputeForm })}
            >
              Salvar
            </Button>
            <Button variant="ghost" onClick={() => setDisputeInvoiceId(null)}>Cancelar</Button>
          </div>
        </div>
      </Modal>

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
