import { useMemo, useState } from 'react'
import { FilePlus2, Printer, RotateCcw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { TabButton } from '../components/ui/TabButton'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { InvoiceDocumentLocal } from '../components/billing/InvoiceDocumentLocal'
import { PortalConsolidatedModal } from '../components/portal/PortalConsolidatedModal'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { formatResultCount } from '../lib/operationalState'
import {
  usePortalConsolidatableReceivables,
  usePortalDemurrageInvoiceDetail,
  usePortalDemurrageInvoices,
  usePortalInvoiceDetail,
  usePortalInvoices,
  usePortalObsoleteConsolidation,
} from '../hooks/usePortalBilling'
import type { PortalDemurrageInvoice, PortalInvoiceSummary } from '../services/portalBilling'
import { buildInvoiceFileBaseName } from '../services/billing'
import { formatBRL, formatDate } from '../lib/utils'

type PortalTab = 'local' | 'demurrage'
type StatusFilter = '' | 'issued' | 'paid' | 'cancelled'
type Filters = { status: StatusFilter; vessel: string; pod: string; dateFrom: string; dateTo: string }

const EMPTY_FILTERS: Filters = { status: '', vessel: '', pod: '', dateFrom: '', dateTo: '' }

const STATUS_GROUPS: Record<Exclude<StatusFilter, ''>, string[]> = {
  issued: ['issued', 'partially_paid', 'overdue', 'draft'],
  paid: ['paid', 'covered'],
  cancelled: ['cancelled', 'obsolete'],
}

function matchesStatus(status: string | null, filter: StatusFilter) {
  if (!filter) return true
  return STATUS_GROUPS[filter].includes(status ?? 'issued')
}

function inDateRange(value: string | null, from: string, to: string) {
  if (!value) return !from && !to
  const day = value.slice(0, 10)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

function countActive(f: Filters) {
  return [f.status, f.vessel, f.pod, f.dateFrom || f.dateTo].filter(Boolean).length
}

export function PortalBilling() {
  const { overview } = usePortalAuth()
  const { showToast } = useToast()
  const { data: receivables } = usePortalConsolidatableReceivables()
  const { data: invoices, isLoading: invoicesLoading, error: invoicesError } = usePortalInvoices()
  const { data: demurrageInvoices, isLoading: demurrageLoading } = usePortalDemurrageInvoices()
  const obsoleteMutation = usePortalObsoleteConsolidation()

  const [tab, setTab] = useState<PortalTab>('local')
  const [consolidateOpen, setConsolidateOpen] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null)
  const [selectedDemurrageId, setSelectedDemurrageId] = useState<number | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [localFilters, setLocalFilters] = useState<Filters>(EMPTY_FILTERS)
  const [demFilters, setDemFilters] = useState<Filters>(EMPTY_FILTERS)

  const detailQuery = usePortalInvoiceDetail(selectedInvoiceId)
  const demurrageDetailQuery = usePortalDemurrageInvoiceDetail(selectedDemurrageId)

  const eligibleCount = (receivables ?? []).filter((r) => r.eligibility_status === 'eligible').length

  // Opções de dropdown derivadas das próprias faturas do cliente.
  const localVessels = useMemo(
    () => Array.from(new Set((invoices ?? []).flatMap((i) => i.vessels ?? []))).sort(),
    [invoices],
  )
  const localPods = useMemo(
    () => Array.from(new Set((invoices ?? []).flatMap((i) => i.pods ?? []))).sort(),
    [invoices],
  )
  const demVessels = useMemo(
    () => Array.from(new Set((demurrageInvoices ?? []).map((i) => i.vessel_name).filter(Boolean) as string[])).sort(),
    [demurrageInvoices],
  )
  const demPods = useMemo(
    () => Array.from(new Set((demurrageInvoices ?? []).map((i) => i.pod).filter(Boolean) as string[])).sort(),
    [demurrageInvoices],
  )

  const filteredInvoices = useMemo(
    () =>
      (invoices ?? []).filter(
        (i) =>
          matchesStatus(i.status, localFilters.status) &&
          (!localFilters.vessel || (i.vessels ?? []).includes(localFilters.vessel)) &&
          (!localFilters.pod || (i.pods ?? []).includes(localFilters.pod)) &&
          inDateRange(i.issued_at, localFilters.dateFrom, localFilters.dateTo),
      ),
    [invoices, localFilters],
  )

  const filteredDemurrage = useMemo(
    () =>
      (demurrageInvoices ?? []).filter(
        (i) =>
          matchesStatus(i.status, demFilters.status) &&
          (!demFilters.vessel || i.vessel_name === demFilters.vessel) &&
          (!demFilters.pod || i.pod === demFilters.pod) &&
          inDateRange(i.doc_date, demFilters.dateFrom, demFilters.dateTo),
      ),
    [demurrageInvoices, demFilters],
  )

  async function handleObsolete() {
    if (!detailQuery.data?.invoice) return
    if (!window.confirm('Desfazer esta fatura consolidada? Os B/Ls voltam a ficar disponíveis para uma nova consolidação.')) {
      return
    }
    try {
      await obsoleteMutation.mutateAsync(Number(detailQuery.data.invoice.id))
      showToast('Fatura consolidada desfeita. Os B/Ls foram liberados.', 'success')
      setSelectedInvoiceId(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao desfazer a fatura.', 'error')
    }
  }

  const detailInvoice = detailQuery.data?.invoice
  const canObsolete =
    detailInvoice?.invoice_type === 'consolidated' &&
    ['issued', 'partially_paid', 'overdue'].includes(detailInvoice.status ?? 'issued') &&
    (detailQuery.data?.payments.length ?? 0) === 0

  return (
    <>
      <PageHeader
        title="Faturas"
        description="Consulte suas faturas, pague via PIX e consolide B/Ls em aberto."
        action={
          <Button onClick={() => setConsolidateOpen(true)}>
            <FilePlus2 size={16} />
            Gerar fatura consolidada
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="Saldo pendente" value={formatBRL(overview?.pending_balance)} />
        <MetricCard label="Faturas emitidas" value={String(invoices?.length ?? 0)} />
        <MetricCard label="B/Ls elegíveis" value={String(eligibleCount)} />
      </div>

      <div className="mb-4 flex gap-2 border-b border-[var(--app-border)]">
        <TabButton active={tab === 'local'} label="Taxas Locais" onClick={() => setTab('local')} />
        <TabButton active={tab === 'demurrage'} label="Demurrage" onClick={() => setTab('demurrage')} />
      </div>

      {tab === 'local' ? (
        <LocalFeesTab
          invoices={filteredInvoices}
          loading={invoicesLoading}
          error={Boolean(invoicesError)}
          filters={localFilters}
          onFilters={setLocalFilters}
          vessels={localVessels}
          pods={localPods}
          onOpenDetail={setSelectedInvoiceId}
        />
      ) : (
        <DemurrageTab
          invoices={filteredDemurrage}
          loading={demurrageLoading}
          filters={demFilters}
          onFilters={setDemFilters}
          vessels={demVessels}
          pods={demPods}
          onOpenDetail={setSelectedDemurrageId}
        />
      )}

      <PortalConsolidatedModal
        open={consolidateOpen}
        onClose={() => setConsolidateOpen(false)}
        onCreated={(id) => setSelectedInvoiceId(id)}
      />

      {/* Detalhe da fatura de taxas locais */}
      <Modal
        open={Boolean(selectedInvoiceId)}
        onClose={() => setSelectedInvoiceId(null)}
        title={`Fatura ${detailInvoice?.invoice_number ?? selectedInvoiceId ?? ''}`}
      >
        <div className="grid gap-5">
          {detailQuery.isLoading ? <div className="text-sm text-[var(--app-muted)]">Carregando detalhe...</div> : null}
          {detailQuery.error ? <div className="text-sm text-[var(--app-red)]">Falha ao carregar detalhe da fatura.</div> : null}
          {detailInvoice ? (
            <>
              <div className="flex flex-wrap justify-end gap-2">
                {canObsolete ? (
                  <Button variant="ghost" loading={obsoleteMutation.isPending} onClick={handleObsolete}>
                    <RotateCcw size={16} />
                    Refazer consolidada
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => setPrintOpen(true)}>
                  <Printer size={16} />
                  Imprimir PDF
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard label="Status" value={statusLabel(detailInvoice.status)} />
                <MetricCard label="Total" value={formatBRL(detailInvoice.total_brl)} />
                <MetricCard label="Pago" value={formatBRL(detailInvoice.total_paid_brl)} />
                <MetricCard label="Saldo" value={formatBRL(detailInvoice.balance_brl)} />
                <MetricCard label="B/Ls" value={String(detailQuery.data?.bls.length ?? 0)} />
              </div>
              <Card className="overflow-hidden p-0">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="px-3 py-2">B/L</th>
                        <th scope="col" className="px-3 py-2">Trecho</th>
                        <th scope="col" className="px-3 py-2">Subtotal BRL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailQuery.data?.bls ?? []).map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 font-semibold">{row.bl_id}</td>
                          <td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td>
                          <td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </Modal>

      {printOpen && detailQuery.data?.invoice ? (
        <Modal open onClose={() => setPrintOpen(false)} title={`Imprimir ${detailQuery.data.invoice.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrintOpen(false)}>Fechar</Button>
            <Button
              onClick={() => {
                const prev = document.title
                document.title = buildInvoiceFileBaseName(detailQuery.data!)
                window.print()
                document.title = prev
              }}
            >
              <Printer size={16} />
              Imprimir
            </Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={detailQuery.data} />
          </div>
        </Modal>
      ) : null}

      {/* Detalhe da fatura de demurrage */}
      <Modal
        open={Boolean(selectedDemurrageId)}
        onClose={() => setSelectedDemurrageId(null)}
        title={`Demurrage ${demurrageDetailQuery.data?.invoice?.doc_number ?? selectedDemurrageId ?? ''}`}
      >
        <div className="grid gap-5">
          {demurrageDetailQuery.isLoading ? <div className="text-sm text-[var(--app-muted)]">Carregando...</div> : null}
          {demurrageDetailQuery.data ? (() => {
            const { invoice, items } = demurrageDetailQuery.data
            return (
              <>
                <div className="grid gap-4 md:grid-cols-4">
                  <MetricCard label="Status" value={invoice.status === 'paid' ? 'Pago' : invoice.status === 'overdue' ? 'Vencida' : 'Emitida'} />
                  <MetricCard label="Total USD" value={`$ ${Number(invoice.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                  <MetricCard label="Total BRL" value={invoice.frozen_total_brl != null ? formatBRL(invoice.frozen_total_brl) : '—'} />
                  <MetricCard label="Vencimento" value={formatDate(invoice.due_date) ?? '—'} />
                </div>

                <Card className="overflow-hidden p-0">
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact min-w-[720px] text-sm">
                      <thead>
                        <tr>
                          <th scope="col" className="px-3 py-2">Container</th>
                          <th scope="col" className="px-3 py-2">Tipo</th>
                          <th scope="col" className="px-3 py-2">Descarga</th>
                          <th scope="col" className="px-3 py-2">Devolucao</th>
                          <th scope="col" className="px-3 py-2">Dias</th>
                          <th scope="col" className="px-3 py-2">USD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 font-semibold">{item.container_number}</td>
                            <td className="px-3 py-2">{item.container_type}</td>
                            <td className="px-3 py-2">{formatDate(item.discharge_date)}</td>
                            <td className="px-3 py-2">{formatDate(item.return_date)}</td>
                            <td className="px-3 py-2">{item.total_days}</td>
                            <td className="px-3 py-2">$ {Number(item.subtotal_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {invoice.pix_payload ? (
                  <Card className="p-4">
                    <div className="mb-3 text-sm font-semibold">Pagamento via PIX</div>
                    <div className="flex flex-col items-center gap-4 sm:flex-row">
                      <QRCodeSVG value={invoice.pix_payload} size={120} level="M" />
                      <div>
                        <div className="mb-1 text-xs text-[var(--app-muted)]">Copia e cola</div>
                        <div className="max-w-xs break-all rounded bg-[var(--app-surface-muted)] p-2 font-mono text-xs">{invoice.pix_payload}</div>
                      </div>
                    </div>
                  </Card>
                ) : null}
              </>
            )
          })() : null}
        </div>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------

type LocalTabProps = {
  invoices: PortalInvoiceSummary[]
  loading: boolean
  error: boolean
  filters: Filters
  onFilters: (f: Filters) => void
  vessels: string[]
  pods: string[]
  onOpenDetail: (id: number) => void
}

function LocalFeesTab({ invoices, loading, error, filters, onFilters, vessels, pods, onOpenDetail }: LocalTabProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--app-border)] px-5 py-4">
        <h2 className="text-base font-semibold">Faturas de taxas locais</h2>
        <p className="mt-1 text-sm text-[var(--app-muted)]">{formatResultCount(invoices.length, 'fatura', 'faturas')}</p>
      </div>

      <div className="px-5 pt-4">
        <FiltersControls filters={filters} onFilters={onFilters} vessels={vessels} pods={pods} />
      </div>

      {error ? <div className="px-5 py-4 text-sm text-[var(--app-red)]">Falha ao consultar faturas.</div> : null}

      {/* Desktop */}
      <div className="hidden app-table-scroll md:block">
        <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">Fatura</th>
              <th scope="col" className="px-4 py-3">Tipo</th>
              <th scope="col" className="px-4 py-3">Emissao</th>
              <th scope="col" className="px-4 py-3">Total</th>
              <th scope="col" className="px-4 py-3">Saldo</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Acao</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={7}>Carregando faturas...</td></tr>
            ) : null}
            {!loading && invoices.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={7}>Nenhuma fatura para os filtros atuais.</td></tr>
            ) : null}
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-4 py-3 font-semibold">{invoice.invoice_number ?? `INV-${invoice.id}`}</td>
                <td className="px-4 py-3">{invoice.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual'}</td>
                <td className="px-4 py-3">{formatDate(invoice.issued_at)}</td>
                <td className="px-4 py-3">{formatBRL(invoice.total_brl)}</td>
                <td className="px-4 py-3">{formatBRL(invoice.balance_brl)}</td>
                <td className="px-4 py-3">{renderInvoiceBadge(invoice.status)}</td>
                <td className="px-4 py-3">
                  <Button variant="secondary" onClick={() => onOpenDetail(invoice.id)}>Detalhes</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-3 p-4 md:hidden">
        {!loading && invoices.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--app-muted)]">Nenhuma fatura para os filtros atuais.</div>
        ) : null}
        {invoices.map((invoice) => (
          <button
            key={invoice.id}
            type="button"
            onClick={() => onOpenDetail(invoice.id)}
            className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{invoice.invoice_number ?? `INV-${invoice.id}`}</span>
              {renderInvoiceBadge(invoice.status)}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-[var(--app-muted)]">
              <span>{invoice.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual'} · {formatDate(invoice.issued_at)}</span>
              <span className="font-semibold text-[var(--app-text)]">{formatBRL(invoice.total_brl)}</span>
            </div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">Saldo: {formatBRL(invoice.balance_brl)}</div>
          </button>
        ))}
      </div>
    </Card>
  )
}

type DemTabProps = {
  invoices: PortalDemurrageInvoice[]
  loading: boolean
  filters: Filters
  onFilters: (f: Filters) => void
  vessels: string[]
  pods: string[]
  onOpenDetail: (id: number) => void
}

function DemurrageTab({ invoices, loading, filters, onFilters, vessels, pods, onOpenDetail }: DemTabProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--app-border)] px-5 py-4">
        <h2 className="text-base font-semibold">Sobreestadia de containers (D&D)</h2>
        <p className="mt-1 text-sm text-[var(--app-muted)]">{formatResultCount(invoices.length, 'fatura', 'faturas')}</p>
      </div>

      <div className="px-5 pt-4">
        <FiltersControls filters={filters} onFilters={onFilters} vessels={vessels} pods={pods} />
      </div>

      <div className="hidden app-table-scroll md:block">
        <table className="app-table app-table--compact min-w-[820px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">Documento</th>
              <th scope="col" className="px-4 py-3">BL / Trecho</th>
              <th scope="col" className="px-4 py-3">Emissao</th>
              <th scope="col" className="px-4 py-3">Vencimento</th>
              <th scope="col" className="px-4 py-3">Total USD</th>
              <th scope="col" className="px-4 py-3">Total BRL</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Acao</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>Carregando...</td></tr>
            ) : null}
            {!loading && invoices.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={8}>Nenhuma fatura de demurrage para os filtros atuais.</td></tr>
            ) : null}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-3 font-semibold">{inv.doc_number}</td>
                <td className="px-4 py-3">{inv.bl_id} — {inv.pol ?? '-'} / {inv.pod ?? '-'}</td>
                <td className="px-4 py-3">{formatDate(inv.billed_at)}</td>
                <td className="px-4 py-3">{formatDate(inv.due_date)}</td>
                <td className="px-4 py-3">$ {Number(inv.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-3">{inv.frozen_total_brl != null ? formatBRL(inv.frozen_total_brl) : '—'}</td>
                <td className="px-4 py-3">{renderDemurrageBadge(inv.status)}</td>
                <td className="px-4 py-3">
                  <Button variant="secondary" onClick={() => onOpenDetail(inv.id)}>Detalhes</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-4 md:hidden">
        {!loading && invoices.length === 0 ? (
          <div className="py-6 text-center text-sm text-[var(--app-muted)]">Nenhuma fatura de demurrage para os filtros atuais.</div>
        ) : null}
        {invoices.map((inv) => (
          <button
            key={inv.id}
            type="button"
            onClick={() => onOpenDetail(inv.id)}
            className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{inv.doc_number}</span>
              {renderDemurrageBadge(inv.status)}
            </div>
            <div className="mt-1 text-sm text-[var(--app-muted)]">{inv.bl_id} · {inv.pol ?? '-'} / {inv.pod ?? '-'}</div>
            <div className="mt-2 text-sm">$ {Number(inv.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </button>
        ))}
      </div>
    </Card>
  )
}

function FiltersControls({ filters, onFilters, vessels, pods }: { filters: Filters; onFilters: (f: Filters) => void; vessels: string[]; pods: string[] }) {
  return (
    <FilterBar activeCount={countActive(filters)} onClear={() => onFilters(EMPTY_FILTERS)}>
      <div className="app-filter-grid">
        <Field label="Status">
          <Select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value as StatusFilter })}>
            <option value="">Todos</option>
            <option value="issued">Emitida</option>
            <option value="paid">Paga</option>
            <option value="cancelled">Cancelada</option>
          </Select>
        </Field>
        <Field label="Navio/Viagem">
          <Select value={filters.vessel} onChange={(e) => onFilters({ ...filters, vessel: e.target.value })} disabled={vessels.length === 0}>
            <option value="">Todos</option>
            {vessels.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
        <Field label="POD">
          <Select value={filters.pod} onChange={(e) => onFilters({ ...filters, pod: e.target.value })} disabled={pods.length === 0}>
            <option value="">Todos</option>
            {pods.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Emissao (de)">
          <Input type="date" value={filters.dateFrom} onChange={(e) => onFilters({ ...filters, dateFrom: e.target.value })} />
        </Field>
        <Field label="Emissao (ate)">
          <Input type="date" value={filters.dateTo} onChange={(e) => onFilters({ ...filters, dateTo: e.target.value })} />
        </Field>
      </div>
    </FilterBar>
  )
}

function renderDemurrageBadge(status: string | null) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'overdue') return <Badge tone="red">Vencida</Badge>
  return <Badge tone="blue">Emitida</Badge>
}

function renderInvoiceBadge(status: string | null) {
  if (status === 'paid' || status === 'covered') return <Badge tone="green">Pago</Badge>
  if (status === 'partially_paid') return <Badge tone="blue">Parcial</Badge>
  if (status === 'overdue') return <Badge tone="yellow">Vencida</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelada</Badge>
  if (status === 'obsolete') return <Badge tone="slate">Obsoleta</Badge>
  if (status === 'draft') return <Badge tone="yellow">Draft</Badge>
  return <Badge tone="blue">Emitida</Badge>
}

function statusLabel(status: string | null) {
  if (status === 'partially_paid') return 'Parcial'
  if (status === 'overdue') return 'Vencida'
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'obsolete') return 'Obsoleta'
  if (status === 'paid' || status === 'covered') return 'Paga'
  if (status === 'draft') return 'Draft'
  return 'Emitida'
}
