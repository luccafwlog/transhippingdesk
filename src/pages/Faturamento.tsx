import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, DollarSign, Download, FilePlus2, Printer } from 'lucide-react'
import { InvoiceDocumentLocal } from '../components/billing/InvoiceDocumentLocal'
import { ConsolidatedInvoiceModal } from '../components/billing/ConsolidatedInvoiceModal'
import { ValidacaoTab } from '../components/billing/ValidacaoTab'
import { InvoiceDocument as DemurrageInvoiceDoc } from '../components/demurrage/InvoiceDocument'
import { listDemurrageInvoices, getInvoiceDetail as getDemurrageInvoiceDetail } from '../services/demurrage/demurrageInvoices'
import type { DemurrageInvoiceDetail } from '../types/database'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import {
  useBatchCalculateLocalCharges,
  useLocalChargeOperations,
} from '../hooks/useLocalCharges'
import type { LocalChargeOperationalRow } from '../services/charges/chargeOperationsService'
import {
  useCancelInvoice,
  useInvoiceDetail,
  useInvoices,
  useRegisterInvoicePayment,
} from '../hooks/useBilling'
import { useRegisterLedgerInvoicePayment } from '../hooks/useBillingLedger'
import {
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
  type InvoiceListBl,
  listBillingCustomers,
  listBlSuggestions,
  listInvoiceNumberSuggestions,
  listInvoicesForExport,
  listPodSuggestions,
  listVoyageSuggestions,
  type InvoiceStatusFilter,
  type InvoiceTypeFilter,
} from '../services/billing'
import { exportInvoicesWorkbook } from '../services/exports'
import { Combobox, type ComboOption } from '../components/ui/Combobox'
import {
  acknowledgeAlert,
  closeAlert,
  createAlert,
  detectOverdueInvoices,
  listFinancialAlerts,
  type Alert,
} from '../services/alerts'
import { logOperationalEvent } from '../services/operationalEvents'
import { formatBRL, formatDate } from '../lib/utils'
import { isLedgerInvoicePayable } from './faturamentoLedgerPayment'
import { INVOICE_STATUS_FILTER_OPTIONS, invoiceStatusLabel, invoiceStatusTone } from './faturamentoInvoiceStatus'

function extractMessage(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const msg = (error as { message?: string }).message
    if (msg) return msg
  }
  return fallback
}

const pageSizes = [20, 50, 100]
type PaymentMethod = 'pix' | 'ted' | 'doc' | 'boleto' | 'outros'

type Filters = {
  search: string
  customerId: string
  status: InvoiceStatusFilter
  invoiceType: InvoiceTypeFilter
  blSearch: string
  voyageSearch: string
  pod: string
  dateFrom: string
  dateTo: string
  paidFrom: string
  paidTo: string
  page: number
  pageSize: number
}

const FILTER_KEYS: (keyof Filters)[] = [
  'search',
  'customerId',
  'status',
  'invoiceType',
  'blSearch',
  'voyageSearch',
  'pod',
  'dateFrom',
  'dateTo',
  'paidFrom',
  'paidTo',
]

export function Faturamento() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  const [filters, setFilters] = useState<Filters>({
    search: '',
    customerId: searchParams.get('customer') ?? '',
    status: '',
    invoiceType: '',
    blSearch: searchParams.get('bl') ?? '',
    voyageSearch: '',
    pod: '',
    dateFrom: '',
    dateTo: '',
    paidFrom: '',
    paidTo: '',
    page: 1,
    pageSize: 20,
  })
  const [filterResetKey, setFilterResetKey] = useState(0)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(Number(searchParams.get('invoice') ?? '') || null)
  const [activeTab, setActiveTab] = useState<'validacao' | 'pendencias' | 'invoices' | 'demurrage'>(
    searchParams.get('tab') === 'demurrage'
      ? 'demurrage'
      : searchParams.get('tab') === 'validacao'
        ? 'validacao'
        : searchParams.get('tab') === 'pendencias'
          ? 'pendencias'
          : 'invoices'
  )
  const [exporting, setExporting] = useState(false)
  const [demurrageInvoiceId, setDemurrageInvoiceId] = useState<number | null>(null)
  const [consolidatedOpen, setConsolidatedOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [cancelReason, setCancelReason] = useState('')

  const { data, isLoading, error } = useInvoices(filters)

  const demurrageInvoicesQuery = useQuery({
    queryKey: ['demurrage-invoices', 'faturamento'],
    queryFn: () => listDemurrageInvoices(),
    staleTime: 30_000,
    enabled: activeTab === 'demurrage',
  })

  const demurrageDetailQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', 'faturamento', demurrageInvoiceId],
    queryFn: () => getDemurrageInvoiceDetail(demurrageInvoiceId!),
    enabled: demurrageInvoiceId != null,
  })

  const financialAlertsQuery = useQuery({
    queryKey: ['financial-alerts'],
    queryFn: listFinancialAlerts,
    staleTime: 60_000,
  })

  useEffect(() => {
    // Fire-and-forget: detecta invoices vencidas ao abrir a tela
    void detectOverdueInvoices().then(() => {
      void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detailQuery = useInvoiceDetail(selectedInvoiceId)
  const detailInvoice = detailQuery.data?.invoice ?? null
  // Ledger-payable local documents are settled through the transactional ledger RPC.
  const isLedgerPayable = isLedgerInvoicePayable(detailInvoice)
  const registerPaymentMutation = useRegisterInvoicePayment()
  const registerLedgerPaymentMutation = useRegisterLedgerInvoicePayment()
  const cancelInvoiceMutation = useCancelInvoice()

  const ledgerBalance = Number(detailInvoice?.balance_brl ?? detailInvoice?.total_brl ?? 0)
  useEffect(() => {
    // Ledger invoices are settled in full; prefill and lock the amount field.
    if (isLedgerPayable) {
      setPaymentAmount(ledgerBalance ? String(ledgerBalance) : '')
    }
     
  }, [selectedInvoiceId, isLedgerPayable, ledgerBalance])

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const invoices = useMemo(() => data?.rows ?? [], [data?.rows])

  const summary = useMemo(() => {
    const paidStatuses = new Set(['paid', 'covered'])
    const cancelledStatuses = new Set(['cancelled', 'obsolete'])
    const open = invoices.filter((row) => !paidStatuses.has(row.status ?? '') && !cancelledStatuses.has(row.status ?? ''))
    return {
      count: data?.count ?? 0,
      openBalance: open.reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0),
      paidCount: invoices.filter((row) => paidStatuses.has(row.status ?? '')).length,
      consolidatedCount: invoices.filter((row) => isConsolidatedInvoice(row)).length,
    }
  }, [data?.count, invoices])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  const activeFilterCount = FILTER_KEYS.filter((key) => String(filters[key] ?? '').trim() !== '').length

  function clearFilters() {
    setFilters((current) => ({
      ...current,
      search: '',
      customerId: '',
      status: '',
      invoiceType: '',
      blSearch: '',
      voyageSearch: '',
      pod: '',
      dateFrom: '',
      dateTo: '',
      paidFrom: '',
      paidTo: '',
      page: 1,
    }))
    setFilterResetKey((key) => key + 1)
  }

  async function handleRegisterPayment() {
    if (!selectedInvoiceId) return
    const parsedAmount = Number(paymentAmount.replace(',', '.'))
    if (!isLedgerPayable && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      showToast('Valor de pagamento invalido.', 'error')
      return
    }
    try {
      if (isLedgerPayable) {
        await registerLedgerPaymentMutation.mutateAsync({
          invoiceId: selectedInvoiceId,
          amountBrl: ledgerBalance,
          method: paymentMethod,
          paidAt: paymentDate ? new Date(`${paymentDate}T12:00:00`).toISOString() : null,
          source: 'manual',
          notes: paymentNotes.trim() || null,
        })
      } else {
        await registerPaymentMutation.mutateAsync({
          invoiceId: selectedInvoiceId,
          amountBrl: parsedAmount,
          paymentMethod,
          paidAt: paymentDate ? new Date(`${paymentDate}T12:00:00`).toISOString() : null,
          notes: paymentNotes.trim() || null,
          actorId: user?.id ?? null,
        })
      }
      setPaymentAmount('')
      setPaymentDate('')
      setPaymentNotes('')
      showToast('Pagamento registrado.', 'success')
    } catch (error) {
      const msg = extractMessage(error, 'Falha ao registrar pagamento.')
      showToast(msg, 'error')
      void createAlert({ type: 'invoice_payment_invalid', entityType: 'invoice', entityId: String(selectedInvoiceId ?? ''), message: msg })
      void logOperationalEvent({ code: 'invoice_payment_invalid', message: msg, changedBy: user?.id ?? null, entityId: String(selectedInvoiceId ?? '') })
      void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
    }
  }

  async function handleCancelInvoice() {
    if (!selectedInvoiceId) return
    try {
      await cancelInvoiceMutation.mutateAsync({
        invoiceId: selectedInvoiceId,
        reason: cancelReason.trim() || null,
        actorId: user?.id ?? null,
      })
      setCancelReason('')
      showToast('Invoice cancelada.', 'success')
    } catch (error) {
      const msg = extractMessage(error, 'Falha ao cancelar invoice.')
      showToast(msg, 'error')
      void createAlert({ type: 'invoice_cancel_blocked', entityType: 'invoice', entityId: String(selectedInvoiceId ?? ''), message: msg })
      void logOperationalEvent({ code: 'invoice_cancel_blocked', message: msg, changedBy: user?.id ?? null, entityId: String(selectedInvoiceId ?? '') })
      void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
    }
  }

  function handlePrintInvoice() {
    if (!detailQuery.data) return
    setPrintOpen(true)
  }

  function closeDetails() {
    setSelectedInvoiceId(null)
    const next = new URLSearchParams(searchParams)
    next.delete('invoice')
    setSearchParams(next)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await listInvoicesForExport(filters)
      if (rows.length === 0) {
        showToast('Nenhuma fatura para exportar com os filtros atuais.', 'info')
        return
      }
      await exportInvoicesWorkbook(rows)
      showToast(`Relatório exportado (${rows.length} fatura(s)).`, 'success')
    } catch (error) {
      showToast(extractMessage(error, 'Falha ao exportar relatório.'), 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Faturamento"
        description="Emissão de consolidadas por cliente, com baixa integral via ledger e cancelamento."
        action={
          <Button onClick={() => setConsolidatedOpen(true)}><FilePlus2 size={16} />Nova Consolidada</Button>
        }
      />

      <ConsolidatedInvoiceModal open={consolidatedOpen} onClose={() => setConsolidatedOpen(false)} />

      <FinancialAlertsPanel
        alerts={financialAlertsQuery.data ?? []}
        onUpdate={() => {
          void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
          void queryClient.invalidateQueries({ queryKey: ['op-count'] })
        }}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <TabButton active={activeTab === 'invoices'} label="Faturas" onClick={() => setActiveTab('invoices')} />
        <TabButton active={activeTab === 'validacao'} label="Validação" onClick={() => setActiveTab('validacao')} />
        <TabButton active={activeTab === 'pendencias'} label="Pendências" onClick={() => setActiveTab('pendencias')} />
        <TabButton active={activeTab === 'demurrage'} label="Demurrage" onClick={() => setActiveTab('demurrage')} />
      </div>

      {activeTab === 'validacao' ? (
        <ValidacaoTab userId={user?.id ?? null} />
      ) : null}

      {activeTab === 'pendencias' ? (
        <PendenciasFaturamentoTab userId={user?.id ?? null} />
      ) : null}

      {activeTab === 'demurrage' ? (
        <DemurrageInvoicesPanel
          query={demurrageInvoicesQuery}
          onOpenDetail={(id) => setDemurrageInvoiceId(id)}
        />
      ) : null}

      {activeTab === 'invoices' ? (
        <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="app-panel__title">Faturas</h2>
        <Button variant="secondary" loading={exporting} onClick={() => void handleExport()}>
          <Download size={16} />Exportar Relatório
        </Button>
      </div>
      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Combobox
            key={`bl-${filterResetKey}`}
            label="Número do BL"
            placeholder="Filtro principal"
            initialValue={filters.blSearch}
            onValueChange={(value) => updateFilter('blSearch', value)}
            fetchOptions={async (q) => (await listBlSuggestions(q)).map((id): ComboOption => ({ value: id, label: id }))}
            onSelectOption={(option) => updateFilter('blSearch', option.value)}
          />
          <Combobox
            key={`inv-${filterResetKey}`}
            label="Número da Fatura"
            initialValue={filters.search}
            onValueChange={(value) => updateFilter('search', value)}
            fetchOptions={async (q) => (await listInvoiceNumberSuggestions(q)).map((n): ComboOption => ({ value: n, label: n }))}
            onSelectOption={(option) => updateFilter('search', option.value)}
          />
          <Combobox
            key={`cli-${filterResetKey}`}
            label="Cliente"
            placeholder="Nome ou CNPJ"
            onValueChange={(value) => { if (!value.trim()) updateFilter('customerId', '') }}
            fetchOptions={async (q) =>
              (await listBillingCustomers(q)).map((c): ComboOption => ({ value: String(c.id), label: c.name, meta: c.cnpj_cpf }))
            }
            onSelectOption={(option) => updateFilter('customerId', option.value)}
          />
          <Combobox
            key={`voy-${filterResetKey}`}
            label="Navio / Viagem"
            initialValue={filters.voyageSearch}
            onValueChange={(value) => updateFilter('voyageSearch', value)}
            fetchOptions={async (q) => (await listVoyageSuggestions(q)).map((v): ComboOption => ({ value: v.voyageNumber, label: v.label }))}
            onSelectOption={(option) => updateFilter('voyageSearch', option.value)}
          />
          <Combobox
            key={`pod-${filterResetKey}`}
            label="POD"
            initialValue={filters.pod}
            onValueChange={(value) => updateFilter('pod', value)}
            fetchOptions={async (q) => (await listPodSuggestions(q)).map((p): ComboOption => ({ value: p, label: p }))}
            onSelectOption={(option) => updateFilter('pod', option.value)}
          />
          <Field label="Tipo de Fatura"><Select value={filters.invoiceType} onChange={(event) => updateFilter('invoiceType', event.target.value as InvoiceTypeFilter)}><option value="">Todos</option><option value="single">Único BL</option><option value="consolidated">Consolidada</option></Select></Field>
          <Field label="Status"><Select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as InvoiceStatusFilter)}><option value="">Todos</option>{INVOICE_STATUS_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
          <Field label="Itens por página"><Select value={filters.pageSize} onChange={(event) => updateFilter('pageSize', Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}/pág.</option>)}</Select></Field>
          <Field label="Emissão de"><Input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></Field>
          <Field label="Emissão até"><Input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></Field>
          <Field label="Pagamento de"><Input type="date" value={filters.paidFrom} onChange={(event) => updateFilter('paidFrom', event.target.value)} /></Field>
          <Field label="Pagamento até"><Input type="date" value={filters.paidTo} onChange={(event) => updateFilter('paidTo', event.target.value)} /></Field>
        </div>
      </FilterBar>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Faturas filtradas" value={String(summary.count)} />
        <MetricCard label="Saldo aberto" value={formatBRL(summary.openBalance)} />
        <MetricCard label="Pagas (página)" value={String(summary.paidCount)} />
        <MetricCard label="Consolidadas (página)" value={String(summary.consolidatedCount)} />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar faturamento." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1200px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-4 py-3">Número do BL</th><th scope="col" className="px-4 py-3">Fatura</th><th scope="col" className="px-4 py-3">Tipo</th><th scope="col" className="px-4 py-3">Navio / Viagem · POD</th><th scope="col" className="px-4 py-3">Emissão</th><th scope="col" className="px-4 py-3">Pagamento</th><th scope="col" className="px-4 py-3">Financeiro</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Ações</th></tr></thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? <tr><td colSpan={9} className="p-0"><SkeletonTable rows={6} cols={9} /></td></tr> : null}
              {!isLoading && invoices.length === 0 ? <tr><td colSpan={9} className="p-0"><EmptyState title="Nenhuma fatura encontrada." description="Emita uma nova fatura ou ajuste os filtros." /></td></tr> : null}
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
                  <td className="px-4 py-3"><Button variant="secondary" onClick={() => setSelectedInvoiceId(invoice.id)}>Detalhes</Button></td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="app-table__footer"><span>Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros</span><div className="app-table__footer-controls"><Button variant="secondary" disabled={filters.page <= 1} onClick={() => updateFilter('page', Math.max(1, filters.page - 1))}>Anterior</Button><Button variant="secondary" disabled={filters.page >= totalPages} onClick={() => updateFilter('page', Math.min(totalPages, filters.page + 1))}>Proxima</Button></div></div>
      </Card>
        </>
      ) : null}

      <Modal open={Boolean(selectedInvoiceId)} onClose={closeDetails} title={`Detalhe Invoice ${detailQuery.data?.invoice?.invoice_number ?? selectedInvoiceId ?? ''}`}>
        <div className="grid gap-5">
          {detailQuery.isLoading ? <div className="p-4"><SkeletonTable rows={3} cols={3} /></div> : null}
          {detailQuery.error ? <div className="text-sm text-red-200">Falha ao carregar detalhe.</div> : null}
          {detailQuery.data?.invoice ? (
            <>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={handlePrintInvoice}>
                  <Printer size={16} />Imprimir PDF
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                <MetricCard label="Total" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                <MetricCard label="Pago" value={formatBRL(detailQuery.data.invoice.total_paid_brl)} />
                <MetricCard label="Saldo" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                <MetricCard label="B/Ls" value={String(detailQuery.data.bls.length)} />
              </div>
              <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                <Card className="border border-[#30363d] bg-[#0d1117]">
                  <h2 className="text-base font-semibold text-white">Contexto da invoice</h2>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <SelectionMetric label="Cliente" value={detailQuery.data.invoice.customer_name ?? '-'} />
                    <SelectionMetric label="Documento" value={detailQuery.data.invoice.customer_cnpj_cpf ?? '-'} />
                    <SelectionMetric label="Emissao" value={formatDate(detailQuery.data.invoice.issued_at)} />
                    <SelectionMetric label="Vencimento" value={formatDate(detailQuery.data.invoice.due_date)} />
                    <SelectionMetric label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                    <SelectionMetric label="Notas" value={detailQuery.data.invoice.notes ?? '-'} />
                  </div>
                </Card>
                <Card className="border border-[#30363d] bg-[#0d1117]">
                  <h2 className="text-base font-semibold text-white">Snapshot financeiro</h2>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <SelectionMetric label="Itens" value={String(detailQuery.data.items.length)} />
                    <SelectionMetric label="Pagamentos" value={String(detailQuery.data.payments.length)} />
                    <SelectionMetric label="Total BRL" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                    <SelectionMetric label="Saldo BRL" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                  </div>
                </Card>
              </div>
              <Card className="overflow-hidden p-0">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[620px] text-left text-sm"><thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-3 py-2">B/L</th><th scope="col" className="px-3 py-2">Trecho</th><th scope="col" className="px-3 py-2">Subtotal BRL</th></tr></thead><tbody className="divide-y divide-[#30363d]">{detailQuery.data.bls.map((row) => <tr key={row.id}><td className="px-3 py-2 font-semibold text-[#58a6ff]"><Link className="hover:underline" to={`/manifestos/${row.bl_id}`}>{row.bl_id}</Link></td><td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td><td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td></tr>)}</tbody></table>
                </div>
              </Card>
              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Itens da invoice</h2>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2">Descricao</th>
                        <th scope="col" className="px-3 py-2">Qtd</th>
                        <th scope="col" className="px-3 py-2">Origem</th>
                        <th scope="col" className="px-3 py-2">Unitario</th>
                        <th scope="col" className="px-3 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {detailQuery.data.items.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-400" colSpan={5}>
                            Nenhum item encontrado nesta invoice.
                          </td>
                        </tr>
                      ) : (
                        detailQuery.data.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2">{item.description ?? '-'}</td>
                            <td className="px-3 py-2">{item.quantity ?? 1}</td>
                            <td className="px-3 py-2">{item.source === 'manual' ? <Badge tone="yellow">Manual</Badge> : <Badge tone="blue">Auto</Badge>}</td>
                            <td className="px-3 py-2">{item.currency === 'USD' ? formatUSD(item.unit_value_usd) : formatBRL(item.unit_value_brl)}</td>
                            <td className="px-3 py-2">{item.currency === 'USD' ? formatUSD(item.total_value_usd) : formatBRL(item.total_value_brl)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Pagamentos registrados</h2>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2">Data</th>
                        <th scope="col" className="px-3 py-2">Metodo</th>
                        <th scope="col" className="px-3 py-2">Valor</th>
                        <th scope="col" className="px-3 py-2">Observações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {detailQuery.data.payments.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-400" colSpan={4}>
                            Nenhum pagamento registrado.
                          </td>
                        </tr>
                      ) : (
                        detailQuery.data.payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="px-3 py-2">{formatDate(payment.paid_at)}</td>
                            <td className="px-3 py-2">{renderPaymentMethod(payment.payment_method)}</td>
                            <td className="px-3 py-2">{formatBRL(payment.amount_brl)}</td>
                            <td className="px-3 py-2"><span className="app-table__truncate app-table__truncate--lg" title={payment.notes ?? '-'}>{payment.notes ?? '-'}</span></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card><h2 className="mb-3 text-base font-semibold text-white">Registrar pagamento</h2><div className="grid gap-4 md:grid-cols-2"><Field label={isLedgerPayable ? 'Valor BRL (baixa integral via ledger)' : 'Valor BRL'}><Input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} readOnly={isLedgerPayable} /></Field><Field label="Metodo"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="pix">PIX</option><option value="ted">TED</option><option value="doc">DOC</option><option value="boleto">Boleto</option><option value="outros">Outros</option></Select></Field><Field label="Data"><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></Field><Field label="Notas"><Input value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></Field></div><div className="mt-4 flex justify-end"><Button loading={registerPaymentMutation.isPending || registerLedgerPaymentMutation.isPending} onClick={handleRegisterPayment}><DollarSign size={16} />Registrar pagamento</Button></div></Card>
                <Card><h2 className="mb-3 text-base font-semibold text-white">Cancelar invoice</h2><Field label="Motivo"><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field><div className="mt-4 flex justify-end"><Button variant="danger" loading={cancelInvoiceMutation.isPending} disabled={detailQuery.data.payments.length > 0} onClick={handleCancelInvoice}><Ban size={16} />Cancelar invoice</Button></div></Card>
              </div>
            </>
          ) : null}
        </div>
      </Modal>

      {printOpen && detailQuery.data && (
        <Modal open onClose={() => setPrintOpen(false)} title={`Imprimir ${detailQuery.data.invoice?.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrintOpen(false)}>Fechar</Button>
            <Button onClick={() => {
              const prev = document.title
              document.title = detailQuery.data?.invoice?.invoice_number ?? 'Fatura'
              window.print()
              document.title = prev
            }}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={detailQuery.data} />
          </div>
        </Modal>
      )}

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

type DemurrageInvoicesPanelProps = {
  query: { data?: Awaited<ReturnType<typeof listDemurrageInvoices>>; isLoading: boolean; error: unknown }
  onOpenDetail: (id: number) => void
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`app-tab ${active ? 'app-tab--active' : ''}`} onClick={onClick} type="button">
      {label}
    </button>
  )
}

function PendenciasFaturamentoTab({ userId }: { userId: string | null }) {
  const { showToast } = useToast()
  const {
    data: pendingRows,
    isLoading,
    error,
  } = useLocalChargeOperations({
    chargeStatus: 'review_required',
    limit: 1200,
  })
  const recalculateMutation = useBatchCalculateLocalCharges()
  const rows = pendingRows ?? []

  async function handleRecalculatePending() {
    const pendingIds = rows.map((row) => row.id)
    if (pendingIds.length === 0) {
      showToast('Nao ha pendencias para recalcular.', 'info')
      return
    }

    try {
      const result = await recalculateMutation.mutateAsync({
        blIds: pendingIds,
        actorId: userId,
        recalculate: true,
      })
      if (result.errorCount > 0) {
        const firstError = result.errors[0]
        showToast(
          `Recalculo parcial: ${result.successCount}/${result.total}. Primeiro erro em ${firstError?.blId ?? '-'}: ${firstError?.message ?? 'erro inesperado'}`,
          'info',
        )
      } else {
        showToast(`Recalculo concluido para ${result.successCount} B/L(s).`, 'success')
      }
    } catch {
      showToast('Falha ao recalcular pendencias.', 'error')
    }
  }

  return (
    <Card className="mb-5">
      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="app-table__cell-stack">
          <div className="app-panel__title">Pendencias de calculo</div>
          <div className="app-table__cell-meta">
            Estes B/Ls estao em revisao nas taxas locais e precisam ser recalculados ou tratados antes de seguir para invoice.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={rows.length > 0 ? 'yellow' : 'green'}>
            {isLoading ? 'Carregando...' : `${rows.length} B/L em revisao`}
          </Badge>
          {rows.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleRecalculatePending()}
              loading={recalculateMutation.isPending}
            >
              Recalcular pendencias
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <InlineError message="Falha ao consultar pendencias de calculo." /> : null}
      {!isLoading && !error && rows.length === 0 ? (
        <EmptyState title="Nenhuma pendencia de calculo encontrada." />
      ) : null}
      {rows.length > 0 ? <PendenciasTable rows={rows} /> : null}
    </Card>
  )
}

function PendenciasTable({ rows }: { rows: LocalChargeOperationalRow[] }) {
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact min-w-[980px] text-left text-sm whitespace-nowrap">
        <thead>
          <tr>
            <th scope="col" className="px-4 py-3">B/L</th>
            <th scope="col" className="px-4 py-3">Cliente</th>
            <th scope="col" className="px-4 py-3">Modo/POD</th>
            <th scope="col" className="px-4 py-3">Viagem</th>
            <th scope="col" className="px-4 py-3">Motivo</th>
            <th scope="col" className="px-4 py-3">Acesso</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.id}</td>
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--app-text-strong)]">{row.customer?.name ?? '-'}</div>
                <div className="text-xs text-[var(--app-muted)]">{row.customer?.cnpj_cpf ?? '-'}</div>
              </td>
              <td className="px-4 py-3">
                {(row.cargo_mode ?? '-').replace('_', ' ').toUpperCase()} / {row.pod ?? '-'}
              </td>
              <td className="px-4 py-3">
                {row.voyage?.vessel?.name ?? 'Navio'} / {row.voyage?.voyage_number ?? '-'}
              </td>
              <td className="px-4 py-3">
                <div className="max-w-[360px] truncate" title={row.trail.last_event_message ?? row.billing_hold_reason ?? undefined}>
                  {row.trail.last_event_message ?? row.billing_hold_reason ?? 'Revisao requerida'}
                </div>
              </td>
              <td className="px-4 py-3">
                <Link className="app-link" to={`/manifestos/${row.id}`}>
                  Ver B/L
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DemurrageInvoicesPanel({ query, onOpenDetail }: DemurrageInvoicesPanelProps) {
  const invoices = useMemo(() => query.data ?? [], [query.data])
  const summary = useMemo(() => {
    const open = invoices.filter((row) => row.status === 'issued' || row.status === 'overdue')
    const openBalance = open.reduce((sum, row) => sum + Number(row.frozen_total_brl ?? 0), 0)
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
      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                <th scope="col" className="w-[12%] px-4 py-3">Emissao</th>
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
                    <td className="px-4 py-3 text-green-400">{formatBRL(Number(inv.frozen_total_brl ?? 0))}</td>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return <Card className="app-kpi-card app-kpi-card--navy"><div className="app-kpi-card__label">{label}</div><div className="app-kpi-card__value app-kpi-card__value--navy">{value}</div></Card>
}

function SelectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[#111827] px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  )
}

function FinancialAlertsPanel({ alerts, onUpdate }: { alerts: Alert[]; onUpdate: () => void }) {
  const { showToast } = useToast()
  const [acting, setActing] = useState<number | null>(null)

  if (!alerts.length) return null

  async function handleAcknowledge(id: number) {
    setActing(id)
    try {
      await acknowledgeAlert(id)
      onUpdate()
    } catch {
      showToast('Falha ao reconhecer alerta.', 'error')
    } finally {
      setActing(null)
    }
  }

  async function handleClose(id: number) {
    setActing(id)
    try {
      await closeAlert(id)
      onUpdate()
    } catch {
      showToast('Falha ao fechar alerta.', 'error')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-100">
        <AlertTriangle size={15} />
        {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} financeiro{alerts.length !== 1 ? 's' : ''} em aberto
      </div>
      <div className="grid gap-2">
        {alerts.slice(0, 5).map((alert) => (
          <div
            key={alert.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-[#0d1117]/60 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge tone={alert.status === 'acknowledged' ? 'blue' : 'yellow'}>
                {alert.status === 'acknowledged' ? 'Reconhecido' : 'Aberto'}
              </Badge>
              <span className="truncate text-xs text-slate-200">{alert.message}</span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {alert.status === 'open' ? (
                <Button variant="secondary" disabled={acting === alert.id} onClick={() => void handleAcknowledge(alert.id)}>
                  Reconhecer
                </Button>
              ) : null}
              <Button variant="secondary" disabled={acting === alert.id} onClick={() => void handleClose(alert.id)}>
                Fechar
              </Button>
            </div>
          </div>
        ))}
        {alerts.length > 5 ? (
          <div className="text-xs text-amber-300/70">
            + {alerts.length - 5} alerta{alerts.length - 5 !== 1 ? 's' : ''}. Veja todos em{' '}
            <a href="/alertas" className="underline hover:text-amber-200">
              /alertas
            </a>.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function renderInvoiceStatus(status: string | null) {
  return <Badge tone={invoiceStatusTone(status)}>{invoiceStatusLabel(status)}</Badge>
}

function statusLabel(status: string | null) {
  return invoiceStatusLabel(status)
}

function renderPaymentMethod(method: PaymentMethod | string | null) {
  if (method === 'pix') return 'PIX'
  if (method === 'ted') return 'TED'
  if (method === 'doc') return 'DOC'
  if (method === 'boleto') return 'Boleto'
  return 'Outros'
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

function formatUSD(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(value ?? 0))
}
