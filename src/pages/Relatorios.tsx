import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'
import {
  exportCustomerReportWorkbook,
  exportFinancialReportWorkbook,
  exportOperationalReportWorkbook,
} from '../services/exports'
import {
  fetchCustomerReport,
  fetchFinancialReport,
  fetchOperationalReport,
  type FinancialReportFilters,
  type OperationalReportFilters,
  type ReportFilters,
} from '../services/reports'

type ReportTab = 'operacional' | 'financeiro' | 'clientes'

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
      </div>

      {tab === 'operacional' ? <OperationalReportTab /> : null}
      {tab === 'financeiro' ? <FinancialReportTab /> : null}
      {tab === 'clientes' ? <CustomerReportTab /> : null}
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
    if (!data?.rows.length) {
      showToast('Nenhum dado para exportar.', 'info')
      return
    }
    setExporting(true)
    try {
      await exportOperationalReportWorkbook(data.rows)
      showToast('Relatorio operacional exportado.', 'success')
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
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar relatorio operacional.</div> : null}
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
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                    Nenhum dado encontrado para os filtros atuais.
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
    if (!data?.rows.length) {
      showToast('Nenhum dado para exportar.', 'info')
      return
    }
    setExporting(true)
    try {
      await exportFinancialReportWorkbook(data.rows)
      showToast('Relatorio financeiro exportado.', 'success')
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
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar relatorio financeiro.</div> : null}
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
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Nenhum dado encontrado para os filtros atuais.
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
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar relatorio por cliente.</div> : null}
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
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Nenhum dado encontrado para os filtros atuais.
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
