import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FilePlus2 } from 'lucide-react'
import { ConsolidatedInvoiceModal } from '../components/billing/ConsolidatedInvoiceModal'
import { ValidacaoTab } from '../components/billing/ValidacaoTab'
import { FinancialAlertsPanel } from '../components/billing/FinancialAlertsPanel'
import { DemurrageInvoicesSection } from '../components/billing/DemurrageInvoicesSection'
import { PendenciasFaturamentoTab } from '../components/billing/PendenciasFaturamentoTab'
import { InvoiceFiltersBar } from '../components/billing/InvoiceFiltersBar'
import { FILTER_KEYS, type Filters } from '../components/billing/invoiceFilters'
import { InvoicesTable } from '../components/billing/InvoicesTable'
import { InvoiceDetailModal } from '../components/billing/InvoiceDetailModal'
import { Button } from '../components/ui/Button'
import { TabButton } from '../components/ui/TabButton'
import { PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useInvoices } from '../hooks/useBilling'
import { isConsolidatedInvoice, listInvoicesForExport } from '../services/billing'
import { exportInvoicesWorkbook } from '../services/exports'
import { detectOverdueInvoices, listFinancialAlerts } from '../services/alerts'
import { reportBestEffortFailure } from '../lib/telemetry'
import { describeActiveFilters, describeEmptyState } from '../lib/operationalState'
import { formatBRL } from '../lib/utils'

function extractMessage(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const msg = (error as { message?: string }).message
    if (msg) return msg
  }
  return fallback
}

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
  const [customerFilterLabel, setCustomerFilterLabel] = useState(searchParams.get('customerName') ?? '')
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
  const [consolidatedOpen, setConsolidatedOpen] = useState(false)

  // Sincroniza estado com a URL — ajuste durante o render (sem useEffect),
  // disparado pela identidade de searchParams como o effect original
  // (prev inicia null para reproduzir a execução de montagem).
  const [prevSearchParams, setPrevSearchParams] = useState<typeof searchParams | null>(null)
  if (searchParams !== prevSearchParams) {
    setPrevSearchParams(searchParams)
    const invoiceId = Number(searchParams.get('invoice') ?? '') || null
    const customerId = searchParams.get('customer') ?? ''
    const customerName = searchParams.get('customerName') ?? ''
    const blSearch = searchParams.get('bl') ?? ''

    setSelectedInvoiceId(invoiceId)
    if (invoiceId) setActiveTab('invoices')
    setCustomerFilterLabel(customerName)
    setFilters((current) =>
      current.customerId === customerId && current.blSearch === blSearch
        ? current
        : { ...current, customerId, blSearch, page: 1 },
    )
  }

  const { data, isLoading, error } = useInvoices(filters)

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
    }).catch((error: unknown) => {
      // Sem isto a detecção de vencidos falharia em silêncio ao abrir a tela.
      reportBestEffortFailure('detectOverdueInvoices ao abrir Faturamento', error)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const filterDescription = describeActiveFilters([
    { label: 'B/L', value: filters.blSearch },
    { label: 'Fatura', value: filters.search },
    { label: 'Cliente', value: filters.customerId },
    { label: 'Navio/Viagem', value: filters.voyageSearch },
    { label: 'POD', value: filters.pod },
    { label: 'Tipo', value: filters.invoiceType },
    { label: 'Status', value: filters.status },
    { label: 'Emissao de', value: filters.dateFrom },
    { label: 'Emissao ate', value: filters.dateTo },
    { label: 'Pagamento de', value: filters.paidFrom },
    { label: 'Pagamento ate', value: filters.paidTo },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'fatura',
    entityPlural: 'faturas',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhuma fatura emitida ainda.',
  })

  function clearFilters() {
    setCustomerFilterLabel('')
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
        loading={financialAlertsQuery.isLoading}
        onUpdate={() => {
          void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
          void queryClient.invalidateQueries({ queryKey: ['op-count'] })
        }}
      />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
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

      <DemurrageInvoicesSection active={activeTab === 'demurrage'} />

      {activeTab === 'invoices' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="app-panel__title">Faturas</h2>
            <Button variant="secondary" loading={exporting} onClick={() => void handleExport()}>
              <Download size={16} />Exportar Relatório
            </Button>
          </div>
          <InvoiceFiltersBar
            filters={filters}
            filterResetKey={filterResetKey}
            customerInitialValue={customerFilterLabel}
            activeFilterCount={activeFilterCount}
            onClear={clearFilters}
            updateFilter={updateFilter}
          />

          <div className="mb-5 flex flex-col gap-4">
            <div>
              <MetricCard label="Saldo aberto" value={formatBRL(summary.openBalance)} tone="primary" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <MetricCard label="Faturas filtradas" value={String(summary.count)} />
              <MetricCard label="Pagas (página)" value={String(summary.paidCount)} />
              <MetricCard label="Consolidadas (página)" value={String(summary.consolidatedCount)} />
            </div>
          </div>

          <InvoicesTable
            invoices={invoices}
            isLoading={isLoading}
            error={error}
            totalCount={data?.count ?? 0}
            filterDescription={filterDescription}
            emptyState={emptyState}
            page={filters.page}
            totalPages={totalPages}
            onPageChange={(page) => updateFilter('page', page)}
            onSelectInvoice={(invoiceId) => setSelectedInvoiceId(invoiceId)}
          />
        </>
      ) : null}

      <InvoiceDetailModal invoiceId={selectedInvoiceId} onClose={closeDetails} />
    </>
  )
}
