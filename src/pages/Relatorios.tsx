import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { TabButton } from '../components/ui/TabButton'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'
import { FINANCIAL_STATUS_LABELS, INVOICE_STATUS_LABELS, REVIEW_STATUS_LABELS, statusLabel } from '../lib/statusLabels'
import {
  fetchCustomerReport,
  fetchFinancialReport,
  fetchFinancialReportForExport,
  fetchOperationalReport,
  fetchOperationalReportForExport,
  type FinancialReportFilters,
  type OperationalReportFilters,
  type ReportFilters,
} from '../services/reports'
import { listDemurrageInvoices } from '../services/demurrage/demurrageInvoices'

type ReportTab = 'operacional' | 'financeiro' | 'clientes' | 'demurrage'

export function Relatorios() {
  const [tab, setTab] = useState<ReportTab>('operacional')

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Visão consolidada de operação, faturamento e clientes por período. Cada visão informa seu próprio limite."
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        <TabButton active={tab === 'operacional'} label="Operacional" onClick={() => setTab('operacional')} />
        <TabButton active={tab === 'financeiro'} label="Financeiro" onClick={() => setTab('financeiro')} />
        <TabButton active={tab === 'clientes'} label="Por Cliente" onClick={() => setTab('clientes')} />
        <TabButton active={tab === 'demurrage'} label="Demurrage" onClick={() => setTab('demurrage')} />
      </div>

      {tab === 'operacional' ? <OperationalReportTab /> : null}
      {tab === 'financeiro' ? <FinancialReportTab /> : null}
      {tab === 'clientes' ? <CustomerReportTab /> : null}
      {tab === 'demurrage' ? <DemurrageReportTab /> : null}
    </>
  )
}

function KpiCard({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`app-metric-tile ${muted ? 'opacity-75' : ''}`}>
      <div className="app-metric-tile__label">{label}</div>
      <div className="app-metric-tile__value">{value}</div>
    </div>
  )
}

// ---------- Operacional ----------

function OperationalReportTab() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<OperationalReportFilters>({
    dateFrom: '',
    dateTo: '',
    pod: '',
    cargoMode: '',
  })
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-operational', filters],
    queryFn: () => fetchOperationalReport(filters),
    staleTime: 30_000,
  })

  async function handleExport() {
    setExporting(true)
    try {
      // Export fetches without row limit for complete data
      const rows = await fetchOperationalReportForExport(filters)
      const { exportOperationalReportWorkbook } = await import('../services/exports')
      await exportOperationalReportWorkbook(rows)
      showToast(`Relatório operacional exportado (${rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Data inicial">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <Field label="POD">
            <Input
              value={filters.pod}
              onChange={(event) => setFilters((prev) => ({ ...prev, pod: event.target.value.toUpperCase() }))}
              placeholder="BRVIT"
            />
          </Field>
          <Field label="Modalidade">
            <Select
              value={filters.cargoMode}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, cargoMode: event.target.value as OperationalReportFilters['cargoMode'] }))
              }
            >
              <option value="">Todas</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={handleExport} loading={exporting} disabled={!data?.rows.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <KpiCard label="B/Ls" value={String(data?.kpis.totalBls ?? 0)} />
        <KpiCard label="Containers distintos" value={String(data?.kpis.totalContainers ?? 0)} />
        <KpiCard label="Viagens distintas" value={String(data?.kpis.totalVoyages ?? 0)} />
        <KpiCard label="Peso total (kg)" value={(data?.kpis.totalWeightKg ?? 0).toLocaleString('pt-BR')} />
        <KpiCard label="CBM total" value={(data?.kpis.totalCbm ?? 0).toLocaleString('pt-BR')} />
      </div>

      {data?.kpis.truncated ? (
        <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
          Limite de 2.000 linhas atingido. Ajuste o período para ver resultados mais recentes.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar relatório operacional." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1100px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">POL</th>
                <th scope="col" className="px-4 py-3">POD</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Containers</th>
                <th scope="col" className="px-4 py-3 text-right">Peso (kg)</th>
                <th scope="col" className="px-4 py-3 text-right">CBM</th>
                <th scope="col" className="px-4 py-3">Revisão</th>
                <th scope="col" className="px-4 py-3">Financeiro</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Carregando relatório...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o período ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.id}</td>
                  <td className="px-4 py-3 text-[var(--app-text)]">
                    {row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">{row.pol ?? '-'}</td>
                  <td className="px-4 py-3">{row.pod ?? '-'}</td>
                  <td className="px-4 py-3 text-[var(--app-text)]">{row.customer?.name ?? '-'}</td>
                  <td className="px-4 py-3">{(row.bl_containers ?? []).length}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {Number(row.total_weight_kg ?? 0).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {Number(row.total_cbm ?? 0).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={row.review_status === 'reviewed' || row.review_status === 'ok' ? 'green' : 'yellow'}>
                      {statusLabel(REVIEW_STATUS_LABELS, row.review_status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-[var(--app-muted)]">{statusLabel(FINANCIAL_STATUS_LABELS, row.financial_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ---------- Financeiro ----------

function FinancialReportTab() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<FinancialReportFilters>({
    dateFrom: '',
    dateTo: '',
    status: '',
  })
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-financial', filters],
    queryFn: () => fetchFinancialReport(filters),
    staleTime: 30_000,
  })

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await fetchFinancialReportForExport(filters)
      const { exportFinancialReportWorkbook } = await import('../services/exports')
      await exportFinancialReportWorkbook(rows)
      showToast(`Relatório financeiro exportado (${rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Data inicial">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={filters.status}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, status: event.target.value as FinancialReportFilters['status'] }))
              }
            >
              <option value="">Todos</option>
              <option value="draft">Draft</option>
              <option value="issued">Emitida</option>
              <option value="partially_paid">Parcial</option>
              <option value="paid">Paga</option>
              <option value="overdue">Vencida</option>
              <option value="cancelled">Cancelada</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={handleExport} loading={exporting} disabled={!data?.rows.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      {data?.accessDenied ? (
        <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
          Visualização financeira restrita ao perfil admin.
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <KpiCard label="Invoices" value={String(data?.kpis.totalInvoices ?? 0)} />
        <KpiCard label="Total emitido" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
        <KpiCard label="Total pago" value={formatBRL(data?.kpis.totalPaid ?? 0)} />
        <KpiCard label="Saldo em aberto" value={formatBRL(data?.kpis.totalOpen ?? 0)} />
        <KpiCard label="Canceladas" value={String(data?.kpis.totalCanceled ?? 0)} muted />
      </div>

      {data?.kpis.truncated ? (
        <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
          Limite de 2.000 linhas atingido. Ajuste o período para ver resultados mais recentes.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar relatório financeiro." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Invoice</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Emissão</th>
                <th scope="col" className="px-4 py-3">Vencimento</th>
                <th scope="col" className="px-4 py-3 text-right">Total BRL</th>
                <th scope="col" className="px-4 py-3 text-right">Saldo BRL</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Carregando relatório...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length && !data?.accessDenied ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o período ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.invoice_number ?? `INV-${row.id}`}</td>
                  <td className="px-4 py-3 text-[var(--app-text)]">{row.customer?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-[var(--app-muted)]">{formatDate(row.issued_at)}</td>
                  <td className="px-4 py-3 text-[var(--app-muted)]">{formatDate(row.due_date)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--app-text-strong)]">{formatBRL(row.total_brl ?? 0)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">{formatBRL(row.balance_brl ?? 0)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={invoiceStatusTone(row.status)}>{statusLabel(INVOICE_STATUS_LABELS, row.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function invoiceStatusTone(status: string | null): 'green' | 'yellow' | 'red' | 'blue' | 'slate' {
  switch (status) {
    case 'paid':
      return 'green'
    case 'partially_paid':
      return 'blue'
    case 'overdue':
      return 'red'
    case 'issued':
      return 'yellow'
    case 'draft':
    case 'cancelled':
    default:
      return 'slate'
  }
}

// ---------- Clientes ----------

function CustomerReportTab() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: '',
    dateTo: '',
  })
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-customers', filters],
    queryFn: () => fetchCustomerReport(filters),
    staleTime: 30_000,
  })

  async function handleExport() {
    if (!data?.rows.length) {
      showToast('Nenhum dado para exportar.', 'info')
      return
    }
    setExporting(true)
    try {
      const { exportCustomerReportWorkbook } = await import('../services/exports')
      await exportCustomerReportWorkbook(data.rows)
      showToast('Relatório por cliente exportado.', 'success')
    } catch {
      showToast('Falha ao exportar o relatório.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Data inicial">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
            />
          </Field>
          <Field label="Data final">
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={handleExport} loading={exporting} disabled={!data?.rows.length}>
              <FileDown size={15} />
              Exportar xlsx
            </Button>
          </div>
        </div>
      </Card>

      {data?.invoicesAccessDenied ? (
        <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
          Totais financeiros por cliente indisponíveis para este perfil. Exibindo apenas métricas operacionais.
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <KpiCard label="Clientes ativos" value={String(data?.kpis.totalCustomers ?? 0)} />
        <KpiCard label="Top por volume (B/Ls)" value={data?.kpis.topByBls ?? '-'} />
        <KpiCard label="Top por faturamento" value={data?.kpis.topByInvoiced ?? '-'} />
        <KpiCard label="Total faturado" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
      </div>

      {data?.kpis.truncated ? (
        <div className="mb-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
          Limite de linhas atingido. Ajuste o período para resultados mais precisos.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar relatório por cliente." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1020px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">CNPJ</th>
                <th scope="col" className="px-4 py-3 text-right">B/Ls</th>
                <th scope="col" className="px-4 py-3 text-right">Peso (kg)</th>
                <th scope="col" className="px-4 py-3 text-right">CBM</th>
                <th scope="col" className="px-4 py-3 text-right">Invoices</th>
                <th scope="col" className="px-4 py-3 text-right">Emitido</th>
                <th scope="col" className="px-4 py-3 text-right">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Carregando relatório...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o período ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.customer_id}>
                  <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--app-muted)]">{formatCnpjCpf(row.cnpj_cpf)}</td>
                  <td className="px-4 py-3 text-right">{row.blCount}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.totalWeightKg.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.totalCbm.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right">{row.invoiceCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--app-text-strong)]">{formatBRL(row.totalIssued)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">{formatBRL(row.totalBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function DemurrageReportTab() {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfYear = today.slice(0, 4) + '-01-01'
  const [dateFrom, setDateFrom] = useState(firstOfYear)
  const [dateTo, setDateTo] = useState(today)
  const [statusFilter, setStatusFilter] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['demurrage-report', dateFrom, dateTo, statusFilter],
    queryFn: () => listDemurrageInvoices({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status: (statusFilter as 'draft' | 'issued' | 'paid' | 'cancelled') || undefined,
    }),
    staleTime: 60_000,
  })

  const invoices = data ?? []
  const totalUSD = invoices.reduce((s, inv) => s + (inv.total_usd ?? 0), 0)
  const totalBRL = invoices.reduce((s, inv) => s + (inv.current_total_brl ?? 0), 0)
  const paidBRL = invoices.filter((i) => i.status === 'paid').reduce((s, inv) => s + (inv.current_total_brl ?? 0), 0)

  function fmtUSD(v: number) {
    return '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="De">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          </Field>
          <Field label="Ate">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
          </Field>
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="draft">Rascunho</option>
              <option value="issued">Faturado</option>
              <option value="paid">Pago</option>
              <option value="cancelled">Cancelado</option>
            </Select>
          </Field>
        </div>
      </Card>

      {invoices.length > 0 && (
        <div className="mb-4 grid gap-3 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <div className="app-metric-tile">
            <div className="app-metric-tile__label">Total USD</div>
            <div className="app-metric-tile__value text-amber-700">{fmtUSD(totalUSD)}</div>
          </div>
          <div className="app-metric-tile">
            <div className="app-metric-tile__label">Total BRL (emitido)</div>
            <div className="app-metric-tile__value text-green-700">{formatBRL(totalBRL)}</div>
          </div>
          <div className="app-metric-tile">
            <div className="app-metric-tile__label">Total Recebido (pago)</div>
            <div className="app-metric-tile__value text-emerald-700">{formatBRL(paidBRL)}</div>
          </div>
        </div>
      )}

      {error ? <InlineError message="Erro ao carregar relatório de demurrage." /> : null}

      <Card className="overflow-hidden p-0">
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Doc</th>
                <th scope="col" className="px-4 py-3">BL</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Emissão</th>
                <th scope="col" className="px-4 py-3">Vencimento</th>
                <th scope="col" className="px-4 py-3 text-right">Total USD</th>
                <th scope="col" className="px-4 py-3 text-right">Total BRL</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--app-muted)]">Carregando...</td></tr>
              ) : null}
              {!isLoading && !invoices.length ? (
                <tr><td colSpan={8} className="p-0"><EmptyState title="Nenhuma invoice no período." /></td></tr>
              ) : null}
              {invoices.map((inv) => {
                const customer = (inv as { customer?: { name?: string } }).customer
                return (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 font-mono text-xs text-[var(--app-text-strong)]">{inv.doc_number}</td>
                    <td className="px-4 py-2 text-[var(--app-blue-btn)]">{inv.bl_id}</td>
                    <td className="px-4 py-2">{customer?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-[var(--app-muted)]">{inv.billed_at ? formatDate(inv.billed_at) : '—'}</td>
                    <td className="px-4 py-2 text-[var(--app-muted)]">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700">{fmtUSD(inv.total_usd ?? 0)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-green-700">{formatBRL(inv.current_total_brl ?? 0)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={inv.status === 'paid' ? 'green' : inv.status === 'issued' ? 'blue' : inv.status === 'cancelled' ? 'slate' : 'yellow'}>
                        {inv.status === 'paid' ? 'Pago' : inv.status === 'issued' ? 'Faturado' : inv.status === 'cancelled' ? 'Cancelado' : 'Rascunho'}
                      </Badge>
                    </td>
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
