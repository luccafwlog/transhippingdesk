import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock, DollarSign, FileText, Pencil, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { InvoiceDocument } from '../components/demurrage/InvoiceDocument'
import { DemurragePaymentReversalModal } from '../components/demurrage/DemurragePaymentReversalModal'
import { DemurrageStatusBadge, InvoiceStatusBadge } from '../components/demurrage/DemurrageBadges'
import { listDemurrageContainers, updateContainerDates } from '../services/demurrage/demurrageContainers'
import {
  cancelDemurrageInvoice,
  createInvoiceForBL,
  getInvoiceDetail,
  listDemurrageInvoices,
  markInvoicePaid,
  recomputeDiscountedBrl,
  updateDemurrageInvoice,
} from '../services/demurrage/demurrageInvoices'
import { reverseDemurragePayment } from '../services/reconciliacao'
import { fetchDemurrageKPIs, fetchROE, fetchLatestRecalcDate, recalculateInvoicesManual, fetchCustomerDemurrageSummary, fetchCustomerDemurrageDetail } from '../services/demurrage/demurrageKpis'
import { CustomerSummaryReport } from '../components/demurrage/CustomerSummaryReport'
import { DEMURRAGE_INVOICE_TABS } from '../services/demurrage/demurrageInvoiceTabs'
import {
  DISCOUNT_TYPE_LABELS,
  DISPUTE_STATUS_LABELS,
  EMPTY_DISCOUNT,
  EMPTY_DISPUTE,
  type DiscountForm,
  type DisputeForm,
} from '../services/demurrage/demurrageForms'
import { effectiveDemurrage, fmtBRL, fmtUSD, groupByBl, lastBusinessDayISO } from '../services/demurrage/demurragePresentation'
import { demurrageDatesSchema, demurrageDiscountSchema, formatValidationError } from '../services/financialValidation'
import type { DemurrageContainerListItem, DemurrageInvoice, DemurrageInvoiceDetail, DemurrageInvoiceItem } from '../types/database'
import { describeActiveFilters, formatResultCount } from '../lib/operationalState'
import { formatDate } from '../lib/utils'

type DemurrageTab = 'containers' | 'clientes' | (typeof DEMURRAGE_INVOICE_TABS)[number]['key']



const TAB_LABELS: { key: DemurrageTab; label: string }[] = [
  { key: 'containers', label: 'Containers' },
  ...DEMURRAGE_INVOICE_TABS.map(({ key, label }) => ({ key, label })),
  { key: 'clientes', label: 'Por Cliente' },
]

const TAB_TO_STATUS = Object.fromEntries(
  DEMURRAGE_INVOICE_TABS.map(({ key, status }) => [key, status]),
) as Record<Exclude<DemurrageTab, 'containers' | 'clientes'>, NonNullable<DemurrageInvoice['status']>>

export function Demurrage() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState<DemurrageTab>('containers')
  // ?busca= permite que alertas de demurrage abram a página já filtrada.
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('busca') ?? '')
  const [generatingBl, setGeneratingBl] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const [editingContainer, setEditingContainer] = useState<DemurrageContainerListItem | null>(null)
  const [editDischarge, setEditDischarge] = useState('')
  const [editReturn, setEditReturn] = useState('')

  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null)
  const [docType, setDocType] = useState<'invoice' | 'receipt'>('invoice')
  const [payingId, setPayingId] = useState<number | null>(null)
  const [reversingPaymentId, setReversingPaymentId] = useState<number | null>(null)
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

  const [ptaxModalOpen, setPtaxModalOpen] = useState(false)
  const [ptaxInput, setPtaxInput] = useState('')
  const [expandedCustomer, setExpandedCustomer] = useState<number | null>(null)
  const [customerReportOpen, setCustomerReportOpen] = useState(false)

  const { data: customerSummary } = useQuery({
    queryKey: ['demurrage-customer-summary'],
    queryFn: fetchCustomerDemurrageSummary,
    staleTime: 60_000,
    enabled: tab === 'clientes',
  })

  const { data: customerDetail } = useQuery({
    queryKey: ['demurrage-customer-detail', expandedCustomer],
    queryFn: () => fetchCustomerDemurrageDetail(expandedCustomer!),
    enabled: expandedCustomer != null,
  })

  const { data: latestRecalcDate } = useQuery({
    queryKey: ['demurrage-latest-recalc'],
    queryFn: fetchLatestRecalcDate,
    staleTime: 60_000,
  })

  // Banner de staleness: só interessa quando há faturas aguardando pagamento (BRL > 0)
  // e o último recálculo é anterior ao último dia útil (job falhou / BCB fora).
  const recalcStale =
    (kpis?.issuedInvoicesTotalBrl ?? 0) > 0 &&
    (latestRecalcDate == null || latestRecalcDate < lastBusinessDayISO())

  const recalcManualMutation = useMutation({
    mutationFn: (ptax: number) => recalculateInvoicesManual(ptax),
    onSuccess: (res) => {
      showToast(`PTAX aplicada — ${res.updated} fatura(s) recalculada(s).`, 'success')
      setPtaxModalOpen(false)
      setPtaxInput('')
      void queryClient.invalidateQueries({ queryKey: ['demurrage-latest-recalc'] })
      invalidateInvoices()
    },
    onError: (err) => showToast(err instanceof Error ? err.message : 'Falha ao recalcular.', 'error'),
  })

  const invoiceStatus = tab !== 'containers' && tab !== 'clientes' ? TAB_TO_STATUS[tab] : null
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

  const payMutation = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) => {
      const inv = invoices?.find((i) => i.id === id)
      let roe = inv?.current_roe ?? null
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
    mutationFn: ({ id, reason }: { id: number; reason: string }) => reverseDemurragePayment(id, reason),
    onSuccess: () => {
      invalidateInvoices()
      setReversingPaymentId(null)
      showToast('Baixa cancelada com auditoria.', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelDemurrageInvoice,
    onSuccess: () => { invalidateInvoices(); showToast('Invoice cancelada.', 'success') },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  async function handleCancelInvoice(invoiceId: number) {
    const ok = await confirm({
      title: 'Cancelar invoice',
      message: 'Cancelar esta invoice de demurrage?',
      confirmLabel: 'Cancelar invoice',
      tone: 'danger',
    })
    if (ok) cancelMutation.mutate(invoiceId)
  }

  const discountMutation = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: DiscountForm }) => {
      const validation = demurrageDiscountSchema.safeParse(form)
      if (!validation.success) {
        throw new Error(formatValidationError(validation.error, 'Desconto invalido.'))
      }
      const discount = validation.data
      await updateDemurrageInvoice(id, {
        discount_type: discount.discount_type,
        discount_value: discount.discount_value,
        discount_mode: discount.discount_mode,
        discount_justification: discount.discount_justification,
        discount_approver: discount.discount_approver,
      })
      // Reflete o desconto (USD) no BRL e no QR já, sem esperar o recálculo diário.
      await recomputeDiscountedBrl(id)
    },
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
    // Devolvido dentro do free time (sem demurrage) não é monitoramento operacional.
    if (c.demurrage_status === 'returned' && (effectiveDemurrage(c)?.total_usd ?? 0) <= 0) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.container_number.toLowerCase().includes(q) ||
      (c.bl_id ?? '').toLowerCase().includes(q) ||
      ((c.bl as { customer?: { name?: string } } | null)?.customer?.name ?? '').toLowerCase().includes(q)
    )
  })

  const grouped = groupByBl(filtered)
  const containerFilterDescription = describeActiveFilters([{ label: 'Busca', value: search }])

  const totalOverdueUSD = filtered.reduce((sum, c) => sum + (effectiveDemurrage(c)?.total_usd ?? 0), 0)

  return (
    <>
      <ContainerDatesImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal open={ptaxModalOpen} onClose={() => setPtaxModalOpen(false)} title="Informar PTAX manualmente">
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Use quando o BCB estiver indisponível ou o recálculo automático falhar. Informe a cotação de
            venda do dólar (PTAX, sem markup). O sistema recalcula todas as faturas emitidas e não pagas.
          </p>
          <Field label="PTAX (cotação de venda)">
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={ptaxInput}
              onChange={(e) => setPtaxInput(e.target.value)}
              placeholder="Ex.: 5.4321"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPtaxModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const ptax = parseFloat(ptaxInput.replace(',', '.'))
                if (!Number.isFinite(ptax) || ptax <= 0) {
                  showToast('Informe uma PTAX válida maior que zero.', 'error')
                  return
                }
                recalcManualMutation.mutate(ptax)
              }}
              disabled={recalcManualMutation.isPending}
            >
              {recalcManualMutation.isPending ? 'Recalculando…' : 'Recalcular'}
            </Button>
          </div>
        </div>
      </Modal>

      <PageHeader
        title="Demurrage"
        description="Rastreamento e faturamento de sobreestadia de containers"
        action={
          <>
            {isAdmin && (
              <Link to="/demurrage/taxas">
                <Button variant="secondary">
                  <DollarSign size={15} />
                  Tarifas
                </Button>
              </Link>
            )}
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              Importar Datas
            </Button>
            <Button variant="secondary" onClick={() => setPtaxModalOpen(true)}>
              <DollarSign size={15} />
              Informar PTAX
            </Button>
          </>
        }
      />

      {/* KPI bar — always visible */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-slate-400">Containers em atraso</div>
          <div className="text-2xl font-bold text-red-400">{kpis?.overdueContainers ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Total USD (visivel)</div>
          <div className="text-2xl font-bold text-amber-400">{fmtUSD(totalOverdueUSD)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-400">Aguardando pagamento (BRL)</div>
          <div className="text-2xl font-bold text-blue-400">
            {kpis ? fmtBRL(kpis.issuedInvoicesTotalBrl) : '—'}
          </div>
        </Card>
      </div>

      {/* Banner de staleness do recálculo diário */}
      {recalcStale ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} />
            PTAX de hoje não obtida do BCB. Os valores em BRL podem estar desatualizados.
          </span>
          <Button variant="secondary" onClick={() => setPtaxModalOpen(true)}>
            Informar PTAX
          </Button>
        </div>
      ) : null}

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

          <div className="mb-3 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-white">{formatResultCount(filtered.length, 'container visivel', 'containers visiveis')}</span>
            <span className="text-xs text-slate-400">{containerFilterDescription}</span>
          </div>

          {!containersLoading && !containersError && grouped.size === 0 && (
            <EmptyState icon={Clock} title="Nenhum container em demurrage" description="Nenhum container fora do free time (ainda fora ou devolvido com sobreestadia)." />
          )}

          {grouped.size > 0 ? (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="app-table app-table--compact min-w-[1100px] text-left text-sm">
                  <thead className="bg-[#0d1117] text-xs uppercase text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2">Container</th>
                      <th scope="col" className="py-2">Tipo</th>
                      <th scope="col" className="py-2">Descarga</th>
                      <th scope="col" className="py-2">Devolução</th>
                      <th scope="col" className="py-2">Free time</th>
                      <th scope="col" className="py-2">Dias excedidos</th>
                      <th scope="col" className="py-2">P1 / P2</th>
                      <th scope="col" className="py-2">Status</th>
                      <th scope="col" className="py-2">USD</th>
                      <th scope="col" className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]">
                    {Array.from(grouped.entries()).map(([blId, blContainers]) => {
                      const firstBl = blContainers[0].bl as { customer?: { name?: string } | null; voyage?: { voyage_number?: string; vessel?: { name?: string } | null } | null } | null
                      const customerName = firstBl?.customer?.name ?? blId
                      const voyageInfo = firstBl?.voyage?.voyage_number ? `${firstBl.voyage.voyage_number} — ${firstBl.voyage.vessel?.name ?? ''}` : ''
                      const hasOverdue = blContainers.some((c) => c.demurrage_status === 'overdue')
                      const blTotalUSD = blContainers.reduce((sum, c) => sum + (effectiveDemurrage(c)?.total_usd ?? 0), 0)

                      return [
                        <tr key={`${blId}-header`} className="bg-[var(--app-surface-muted)]">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-baseline gap-2">
                                <Link to={`/manifestos/${blId}`} className="font-semibold text-blue-400 hover:underline">{blId}</Link>
                                <span className="text-sm text-slate-400">{customerName}</span>
                                {voyageInfo && <span className="text-xs text-slate-500">{voyageInfo}</span>}
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
                                    {generatingBl === blId ? 'Gerando...' : 'Gerar Fatura'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>,
                        ...blContainers.map((c) => {
                          const calc = effectiveDemurrage(c)
                          const excessDays = calc ? Math.max(0, calc.total_days - calc.free_days) : 0
                          return (
                            <tr key={c.id}>
                              <td className="px-4 py-2 font-semibold text-white">{c.container_number}</td>
                              <td className="py-2">{c.type ?? '-'}</td>
                              <td className="py-2">{c.discharge_date ? formatDate(c.discharge_date) : '—'}</td>
                              <td className="py-2">{c.return_date ? formatDate(c.return_date) : <span className="text-slate-500">Pendente</span>}</td>
                              <td className="py-2">{calc ? calc.free_days : '—'}</td>
                              <td className="py-2">{calc ? excessDays : '—'}</td>
                              <td className="py-2 text-slate-400">{calc ? `${calc.days_p1} / ${calc.days_p2}` : '—'}</td>
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
                        }),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {/* ── Por Cliente: demurrage em aberto agregado por consignatário ── */}
      {tab === 'clientes' ? (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold text-white">
              {formatResultCount(customerSummary?.length ?? 0, 'consignatário', 'consignatários')}
            </span>
            <Button
              variant="secondary"
              disabled={!customerSummary?.length}
              onClick={() => setCustomerReportOpen(true)}
            >
              <FileText size={15} />
              Imprimir
            </Button>
          </div>
          {!customerSummary?.length ? (
            <EmptyState icon={FileText} title="Nada em aberto" description="Nenhuma fatura de demurrage emitida e não paga." />
          ) : (
            <div className="space-y-2">
              {customerSummary.map((c) => (
                <Card key={c.customer_id} className="overflow-hidden">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5"
                    onClick={() => setExpandedCustomer((id) => (id === c.customer_id ? null : c.customer_id))}
                  >
                    <span className="font-medium text-white">{c.customer_name}</span>
                    <span className="flex items-center gap-4 text-sm">
                      <span className="text-slate-400">{c.invoice_count} fat.</span>
                      <span className="font-semibold text-amber-400">{fmtUSD(c.total_usd)}</span>
                      <span className="font-semibold text-green-400">{fmtBRL(c.total_brl)}</span>
                    </span>
                  </button>
                  {expandedCustomer === c.customer_id && (
                    <div className="border-t border-[#30363d] px-4 py-2">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase text-slate-500">
                          <tr>
                            <th className="py-1 text-left">Nº Doc</th>
                            <th className="py-1 text-left">BL</th>
                            <th className="py-1 text-left">Emissão</th>
                            <th className="py-1 text-right">USD</th>
                            <th className="py-1 text-right">BRL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(customerDetail ?? []).map((d) => (
                            <tr key={d.id}>
                              <td className="py-1 font-mono text-xs">{d.doc_number}</td>
                              <td className="py-1 text-blue-400">{d.bl_id}</td>
                              <td className="py-1">{d.billed_at ? formatDate(d.billed_at) : '—'}</td>
                              <td className="py-1 text-right text-amber-400">{fmtUSD(d.total_usd)}</td>
                              <td className="py-1 text-right text-green-400">{fmtBRL(d.current_total_brl)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── Tabs: Faturas / Pagas / Canceladas ── */}
      {tab !== 'containers' && tab !== 'clientes' ? (
        <>
          {invoicesLoading && <Card>Carregando...</Card>}
          {invoicesError && <InlineError message="Erro ao carregar faturas." />}
          <div className="mb-3 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold text-white">{formatResultCount(invoices?.length ?? 0, 'fatura visivel', 'faturas visiveis')}</span>
            <span className="text-xs text-slate-400">Filtros ativos: Status {TAB_LABELS.find((item) => item.key === tab)?.label ?? tab}</span>
          </div>
          {!invoicesLoading && !invoicesError && !invoices?.length && (
            <EmptyState
              icon={FileText}
              title="Nenhuma fatura"
              description={`Nenhuma fatura com status "${tab}".`}
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
                      <th scope="col" className="py-2">Emissão</th>
                      <th scope="col" className="py-2">Total USD</th>
                      <th scope="col" className="py-2">Total BRL</th>
                      <th scope="col" className="py-2">Status</th>
                      <th scope="col" className="py-2">Ações</th>
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
                          <td className="py-2 font-semibold text-amber-400">{fmtUSD(inv.total_usd)}</td>
                          <td className="py-2 font-semibold text-green-400">
                            {fmtBRL(inv.current_total_brl)}
                            {inv.roe_source === 'cached' && (
                              <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-xs text-amber-400" title="ROE via cache (BCB offline)">ROE cache</span>
                            )}
                          </td>
                          <td className="py-2"><InvoiceStatusBadge status={inv.status} /></td>
                          <td className="py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <Button
                                variant="ghost"
                                className="app-btn--sm"
                                onClick={() => setDetailInvoiceId(inv.id)}
                              >
                                Detalhes
                              </Button>
                              <Button
                                variant="ghost"
                                className={`app-btn--sm ${hasDiscount ? 'text-[var(--app-green)]' : ''}`}
                                onClick={() => openDiscount(inv)}
                              >
                                Desconto
                              </Button>
                              <Button
                                variant="ghost"
                                className={`app-btn--sm ${disputeActive ? 'text-[var(--app-gold)]' : disputePast ? 'text-[var(--app-muted)]' : ''}`}
                                onClick={() => openDispute(inv)}
                              >
                                Disputa
                              </Button>
                              {inv.status === 'issued' && (
                                <>
                                  <Button variant="secondary" className="app-btn--sm" onClick={() => setPayingId(inv.id)}>Registrar Pgto</Button>
                                  <Button variant="ghost" className="app-btn--sm" onClick={() => { setViewInvoiceId(inv.id); setDocType('invoice') }}>Fatura</Button>
                                  <Button variant="ghost" className="app-btn--sm" onClick={() => void handleCancelInvoice(inv.id)}>Cancelar</Button>
                                </>
                              )}
                              {inv.status === 'paid' && (
                                <>
                                  <Button variant="ghost" className="app-btn--sm" onClick={() => { setViewInvoiceId(inv.id); setDocType('receipt') }}>Recibo</Button>
                                  <Button variant="ghost" className="app-btn--sm" onClick={() => { setViewInvoiceId(inv.id); setDocType('invoice') }}>Fatura</Button>
                                  <Button variant="ghost" className="app-btn--sm" onClick={() => setReversingPaymentId(inv.id)}>Cancelar baixa</Button>
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
            <div className="text-sm font-semibold text-[var(--app-text-strong)]">{editingContainer.container_number}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data de descarga" required>
                <Input type="date" value={editDischarge} onChange={(e) => setEditDischarge(e.target.value)} />
              </Field>
              <Field label="Data de devolução">
                <Input type="date" value={editReturn} onChange={(e) => setEditReturn(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button
                loading={containerDatesMutation.isPending}
                onClick={() => {
                  if (!editDischarge) return showToast('Data de descarga obrigatória.', 'error')
                  const validation = demurrageDatesSchema.safeParse({ discharge: editDischarge, ret: editReturn })
                  if (!validation.success) return showToast(formatValidationError(validation.error), 'error')
                  containerDatesMutation.mutate({
                    id: editingContainer.id,
                    discharge: validation.data.discharge,
                    ret: validation.data.ret,
                  })
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
                    <th scope="col" className="py-2">Devolução</th>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de desconto">
              <Select
                value={discountForm.discount_type ?? ''}
                onChange={(e) => setDiscountForm((f) => ({ ...f, discount_type: (e.target.value || null) as DemurrageInvoice['discount_type'] }))}
              >
                <option value="">Sem desconto</option>
                {(Object.entries(DISCOUNT_TYPE_LABELS) as [NonNullable<DemurrageInvoice['discount_type']>, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Modo">
              <Select
                value={discountForm.discount_mode}
                onChange={(e) => setDiscountForm((f) => ({ ...f, discount_mode: e.target.value as 'percent' | 'fixed' }))}
              >
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (USD)</option>
              </Select>
            </Field>
          </div>
          <Field label="Valor do desconto">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={discountForm.discount_value}
              onChange={(e) => setDiscountForm((f) => ({ ...f, discount_value: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-400">
              {discountForm.discount_mode === 'fixed'
                ? 'Valor em dólares (USD), descontado antes da conversão para BRL.'
                : 'Percentual sobre o total USD.'}
            </p>
          </Field>
          <Field label="Justificativa">
            <Textarea
              rows={2}
              value={discountForm.discount_justification}
              onChange={(e) => setDiscountForm((f) => ({ ...f, discount_justification: e.target.value }))}
            />
          </Field>
          <Field label="Aprovador">
            <Input
              type="text"
              value={discountForm.discount_approver}
              onChange={(e) => setDiscountForm((f) => ({ ...f, discount_approver: e.target.value }))}
            />
          </Field>
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
          <label className="flex items-center gap-2 text-sm text-[var(--app-text)]">
            <input
              type="checkbox"
              className="rounded"
              checked={disputeForm.dispute_open}
              onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_open: e.target.checked }))}
            />
            Disputa em aberto
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assunto">
              <Input
                type="text"
                value={disputeForm.dispute_subject}
                onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_subject: e.target.value }))}
              />
            </Field>
            <Field label="Status">
              <Select
                value={disputeForm.dispute_status ?? ''}
                onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_status: (e.target.value || null) as DemurrageInvoice['dispute_status'] }))}
              >
                <option value="">Sem status</option>
                {(Object.entries(DISPUTE_STATUS_LABELS) as [NonNullable<DemurrageInvoice['dispute_status']>, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Motivo">
            <Textarea
              rows={2}
              value={disputeForm.dispute_reason}
              onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_reason: e.target.value }))}
            />
          </Field>
          <Field label="Notas">
            <Textarea
              rows={2}
              value={disputeForm.dispute_notes}
              onChange={(e) => setDisputeForm((f) => ({ ...f, dispute_notes: e.target.value }))}
            />
          </Field>
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
          <Field label="Data do pagamento">
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => payingId && payMutation.mutate({ id: payingId, date: payDate })}>Confirmar</Button>
            <Button variant="ghost" onClick={() => setPayingId(null)}>Cancelar</Button>
          </div>
        </div>
      </Modal>

      {reversingPaymentId != null ? (
        <DemurragePaymentReversalModal
          open
          invoiceId={reversingPaymentId}
          loading={unpayMutation.isPending}
          onClose={() => setReversingPaymentId(null)}
          onSubmit={(reason) => unpayMutation.mutate({ id: reversingPaymentId, reason })}
        />
      ) : null}

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

      {/* Relatório de demurrage em aberto por consignatário */}
      {customerReportOpen && customerSummary && (
        <Modal open onClose={() => setCustomerReportOpen(false)} title="Demurrage em aberto por consignatário">
          <div className="p-2">
            <div className="mb-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => window.print()}>Imprimir</Button>
            </div>
            <CustomerSummaryReport rows={customerSummary} />
          </div>
        </Modal>
      )}
    </>
  )
}
