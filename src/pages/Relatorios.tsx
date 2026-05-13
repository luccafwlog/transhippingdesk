import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'
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
import { listDemurrageInvoices } from '../services/demurrage'

type ReportTab = 'operacional' | 'financeiro' | 'clientes' | 'demurrage'

export function Relatorios() {
  const [tab, setTab] = useState<ReportTab>('operacional')

  return (
    <>
      <PageHeader
        title="Relatorios"
        description="Visao consolidada de operacao, faturamento e clientes por periodo. Limite de 2.000 linhas por consulta."
      />

      <div className="mb-4 flex flex-wrap gap-2">
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

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-[#30363d] text-white' : 'text-slate-400 hover:bg-[#21262d] hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

function KpiCard({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-2 text-xl font-bold ${muted ? 'text-slate-300' : 'text-white'}`}>{value}</div>
    </Card>
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
      showToast(`Relatorio operacional exportado (${rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatorio.', 'error')
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

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="B/Ls" value={String(data?.kpis.totalBls ?? 0)} />
        <KpiCard label="Containers distintos" value={String(data?.kpis.totalContainers ?? 0)} />
        <KpiCard label="Viagens distintas" value={String(data?.kpis.totalVoyages ?? 0)} />
        <KpiCard label="Peso total (kg)" value={(data?.kpis.totalWeightKg ?? 0).toLocaleString('pt-BR')} />
        <KpiCard label="CBM total" value={(data?.kpis.totalCbm ?? 0).toLocaleString('pt-BR')} />
      </div>

      {data?.kpis.truncated ? (
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          Limite de 2.000 linhas atingido. Ajuste o periodo para ver resultados mais recentes.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar relatorio operacional." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1100px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">B/L</th>
                <th className="px-4 py-3">Navio/Viagem</th>
                <th className="px-4 py-3">POL</th>
                <th className="px-4 py-3">POD</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Containers</th>
                <th className="px-4 py-3 text-right">Peso (kg)</th>
                <th className="px-4 py-3 text-right">CBM</th>
                <th className="px-4 py-3">Revisao</th>
                <th className="px-4 py-3">Financeiro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    Carregando relatorio...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o periodo ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{row.id}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">{row.pol ?? '-'}</td>
                  <td className="px-4 py-3">{row.pod ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-300">{row.customer?.name ?? '-'}</td>
                  <td className="px-4 py-3">{(row.bl_containers ?? []).length}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {Number(row.total_weight_kg ?? 0).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {Number(row.total_cbm ?? 0).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={row.review_status === 'reviewed' ? 'green' : 'yellow'}>
                      {row.review_status ?? '-'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{row.financial_status ?? '-'}</td>
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
      showToast(`Relatorio financeiro exportado (${rows.length} linhas).`, 'success')
    } catch {
      showToast('Falha ao exportar o relatorio.', 'error')
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
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          Visualizacao financeira restrita ao perfil admin.
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Invoices" value={String(data?.kpis.totalInvoices ?? 0)} />
        <KpiCard label="Total emitido" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
        <KpiCard label="Total pago" value={formatBRL(data?.kpis.totalPaid ?? 0)} />
        <KpiCard label="Saldo em aberto" value={formatBRL(data?.kpis.totalOpen ?? 0)} />
        <KpiCard label="Canceladas" value={String(data?.kpis.totalCanceled ?? 0)} muted />
      </div>

      {data?.kpis.truncated ? (
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          Limite de 2.000 linhas atingido. Ajuste o periodo para ver resultados mais recentes.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar relatorio financeiro." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Emissao</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3 text-right">Total BRL</th>
                <th className="px-4 py-3 text-right">Saldo BRL</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Carregando relatorio...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length && !data?.accessDenied ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o periodo ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{row.invoice_number ?? `INV-${row.id}`}</td>
                  <td className="px-4 py-3 text-slate-300">{row.customer?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(row.issued_at)}</td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(row.due_date)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-200">{formatBRL(row.total_brl ?? 0)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-200">{formatBRL(row.balance_brl ?? 0)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={invoiceStatusTone(row.status)}>{row.status ?? '-'}</Badge>
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
      showToast('Relatorio por cliente exportado.', 'success')
    } catch {
      showToast('Falha ao exportar o relatorio.', 'error')
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
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          Totais financeiros por cliente indisponiveis para este perfil. Exibindo apenas metricas operacionais.
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Clientes ativos" value={String(data?.kpis.totalCustomers ?? 0)} />
        <KpiCard label="Top por volume (B/Ls)" value={data?.kpis.topByBls ?? '-'} />
        <KpiCard label="Top por faturamento" value={data?.kpis.topByInvoiced ?? '-'} />
        <KpiCard label="Total faturado" value={formatBRL(data?.kpis.totalIssued ?? 0)} />
      </div>

      {data?.kpis.truncated ? (
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          Limite de linhas atingido. Ajuste o periodo para resultados mais precisos.
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar relatorio por cliente." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1020px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">CNPJ</th>
                <th className="px-4 py-3 text-right">B/Ls</th>
                <th className="px-4 py-3 text-right">Peso (kg)</th>
                <th className="px-4 py-3 text-right">CBM</th>
                <th className="px-4 py-3 text-right">Invoices</th>
                <th className="px-4 py-3 text-right">Emitido</th>
                <th className="px-4 py-3 text-right">Em aberto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Carregando relatorio...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState title="Nenhum dado encontrado." description="Ajuste o periodo ou os filtros aplicados." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <tr key={row.customer_id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatCnpjCpf(row.cnpj_cpf)}</td>
                  <td className="px-4 py-3 text-right">{row.blCount}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.totalWeightKg.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.totalCbm.toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right">{row.invoiceCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-200">{formatBRL(row.totalIssued)}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-200">{formatBRL(row.totalBalance)}</td>
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
  const totalBRL = invoices.reduce((s, inv) => s + (inv.frozen_total_brl ?? 0), 0)
  const paidBRL = invoices.filter((i) => i.status === 'paid').reduce((s, inv) => s + (inv.frozen_total_brl ?? 0), 0)

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
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3">
            <div className="text-xs text-slate-500">Total USD</div>
            <div className="mt-1 text-lg font-semibold text-amber-300">{fmtUSD(totalUSD)}</div>
          </div>
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3">
            <div className="text-xs text-slate-500">Total BRL (emitido)</div>
            <div className="mt-1 text-lg font-semibold text-green-300">{formatBRL(totalBRL)}</div>
          </div>
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3">
            <div className="text-xs text-slate-500">Total Recebido (pago)</div>
            <div className="mt-1 text-lg font-semibold text-emerald-400">{formatBRL(paidBRL)}</div>
          </div>
        </div>
      )}

      {error ? <InlineError message="Erro ao carregar relatorio de demurrage." /> : null}

      <Card className="overflow-hidden p-0">
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[900px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Doc</th>
                <th className="px-4 py-3">BL</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Emissao</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3 text-right">Total USD</th>
                <th className="px-4 py-3 text-right">Total BRL</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Carregando...</td></tr>
              ) : null}
              {!isLoading && !invoices.length ? (
                <tr><td colSpan={8} className="p-0"><EmptyState title="Nenhuma invoice no periodo." /></td></tr>
              ) : null}
              {invoices.map((inv) => {
                const customer = (inv as { customer?: { name?: string } }).customer
                return (
                  <tr key={inv.id} className="hover:bg-[#21262d]/60">
                    <td className="px-4 py-2 font-mono text-xs text-white">{inv.doc_number}</td>
                    <td className="px-4 py-2 text-blue-400">{inv.bl_id}</td>
                    <td className="px-4 py-2">{customer?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{inv.billed_at ? formatDate(inv.billed_at) : '—'}</td>
                    <td className="px-4 py-2 text-slate-400">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-400">{fmtUSD(inv.total_usd ?? 0)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-green-400">{formatBRL(inv.frozen_total_brl ?? 0)}</td>
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
