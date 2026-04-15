import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Ban, DollarSign, FileDown, FilePlus2 } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useVoyageOptions } from '../hooks/useBls'
import {
  useBillingCustomers,
  useBillingReadyBls,
  useCancelInvoice,
  useCreateInvoice,
  useInvoiceDetail,
  useInvoices,
  useRegisterInvoicePayment,
} from '../hooks/useBilling'
import type { InvoiceStatusFilter } from '../services/billing'
import { downloadInvoicePdf } from '../services/invoicePdf'
import { formatBRL, formatDate } from '../lib/utils'

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
  dateFrom: string
  dateTo: string
  blSearch: string
  page: number
  pageSize: number
}

export function Faturamento() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [filters, setFilters] = useState<Filters>({
    search: '',
    customerId: searchParams.get('customer') ?? '',
    status: '',
    dateFrom: '',
    dateTo: '',
    blSearch: searchParams.get('bl') ?? '',
    page: 1,
    pageSize: 20,
  })
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(Number(searchParams.get('invoice') ?? '') || null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<'single' | 'consolidated'>('consolidated')
  const [createCustomerId, setCreateCustomerId] = useState('')
  const [createVoyageId, setCreateVoyageId] = useState('')
  const [createCargoMode, setCreateCargoMode] = useState<'' | 'container' | 'carga_solta'>('')
  const [createDueDate, setCreateDueDate] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createSearch, setCreateSearch] = useState('')
  const [selectedBls, setSelectedBls] = useState<string[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [isPdfGenerating, setIsPdfGenerating] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [cancelReason, setCancelReason] = useState('')

  const { data, isLoading, error } = useInvoices(filters)
  const { data: customerOptions } = useBillingCustomers(customerSearch)
  const { data: readyBls, isLoading: loadingReadyBls } = useBillingReadyBls({
    customerId: createCustomerId ? Number(createCustomerId) : null,
    voyageId: createVoyageId ? Number(createVoyageId) : null,
    cargoMode: createCargoMode || null,
  })
  const { data: voyageOptions } = useVoyageOptions()
  const detailQuery = useInvoiceDetail(selectedInvoiceId)
  const createInvoiceMutation = useCreateInvoice()
  const registerPaymentMutation = useRegisterInvoicePayment()
  const cancelInvoiceMutation = useCancelInvoice()

  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / filters.pageSize))
  const invoices = useMemo(() => data?.rows ?? [], [data?.rows])
  const filteredReadyBls = useMemo(() => {
    const term = createSearch.trim().toUpperCase()
    return (readyBls ?? []).filter((row) => !term || row.id.includes(term) || String(row.customer?.name ?? '').toUpperCase().includes(term))
  }, [createSearch, readyBls])

  const summary = useMemo(() => {
    const open = invoices.filter((row) => row.status === 'issued' || row.status === 'partially_paid' || row.status === 'overdue')
    return {
      count: data?.count ?? 0,
      openBalance: open.reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0),
      paidCount: invoices.filter((row) => row.status === 'paid').length,
      overdueCount: invoices.filter((row) => row.status === 'overdue').length,
    }
  }, [data?.count, invoices])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? Number(value) : 1 }))
  }

  function resetCreateState() {
    setCreateMode('consolidated')
    setCreateCustomerId('')
    setCreateVoyageId('')
    setCreateCargoMode('')
    setCreateDueDate('')
    setCreateNotes('')
    setCreateSearch('')
    setSelectedBls([])
  }

  function toggleBl(blId: string) {
    setSelectedBls((current) => {
      if (createMode === 'single') return current.includes(blId) ? [] : [blId]
      return current.includes(blId) ? current.filter((id) => id !== blId) : [...current, blId]
    })
  }

  async function handleCreateInvoice() {
    if (!selectedBls.length) {
      showToast('Selecione ao menos um B/L para emitir.', 'error')
      return
    }
    if (createMode === 'single' && selectedBls.length !== 1) {
      showToast('Modo B/L unico permite somente 1 B/L.', 'error')
      return
    }
    try {
      const payload = await createInvoiceMutation.mutateAsync({
        blIds: selectedBls,
        customerId: createCustomerId ? Number(createCustomerId) : null,
        dueDate: createDueDate || null,
        notes: createNotes.trim() || null,
        issueNow: true,
        actorId: user?.id ?? null,
      })
      setSelectedInvoiceId(Number((payload as { invoice_id?: number }).invoice_id ?? 0))
      setCreateOpen(false)
      resetCreateState()
      showToast('Invoice emitida com sucesso.', 'success')
    } catch (error) {
      showToast(extractMessage(error, 'Falha ao emitir invoice.'), 'error')
    }
  }

  async function handleRegisterPayment() {
    if (!selectedInvoiceId) return
    const parsedAmount = Number(paymentAmount.replace(',', '.'))
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast('Valor de pagamento invalido.', 'error')
      return
    }
    try {
      await registerPaymentMutation.mutateAsync({
        invoiceId: selectedInvoiceId,
        amountBrl: parsedAmount,
        paymentMethod,
        paidAt: paymentDate ? new Date(`${paymentDate}T12:00:00`).toISOString() : null,
        notes: paymentNotes.trim() || null,
        actorId: user?.id ?? null,
      })
      setPaymentAmount('')
      setPaymentDate('')
      setPaymentNotes('')
      showToast('Pagamento registrado.', 'success')
    } catch (error) {
      showToast(extractMessage(error, 'Falha ao registrar pagamento.'), 'error')
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
      showToast(extractMessage(error, 'Falha ao cancelar invoice.'), 'error')
    }
  }

  async function handleDownloadPdf() {
    if (!detailQuery.data) return
    setIsPdfGenerating(true)
    try {
      await downloadInvoicePdf(detailQuery.data)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao gerar PDF.', 'error')
    } finally {
      setIsPdfGenerating(false)
    }
  }

  function closeDetails() {
    setSelectedInvoiceId(null)
    const next = new URLSearchParams(searchParams)
    next.delete('invoice')
    setSearchParams(next)
  }

  return (
    <>
      <PageHeader
        title="Faturamento"
        description="Emissao de invoice por B/L unico ou consolidada por cliente, com baixa parcial/total e cancelamento."
        action={<Button onClick={() => setCreateOpen(true)}><FilePlus2 size={16} />Nova Invoice</Button>}
      />

      <Card className="mb-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-8">
          <Field label="Invoice"><Input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} /></Field>
          <Field label="Cliente"><Select value={filters.customerId} onChange={(event) => updateFilter('customerId', event.target.value)}><option value="">Todos</option>{customerOptions?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select></Field>
          <Field label="Status"><Select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as InvoiceStatusFilter)}><option value="">Todos</option><option value="draft">Draft</option><option value="issued">Emitida</option><option value="partially_paid">Parcial</option><option value="paid">Paga</option><option value="overdue">Vencida</option><option value="cancelled">Cancelada</option></Select></Field>
          <Field label="Emissao de"><Input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></Field>
          <Field label="Emissao ate"><Input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></Field>
          <Field label="B/L vinculado"><Input value={filters.blSearch} onChange={(event) => updateFilter('blSearch', event.target.value)} /></Field>
          <Field label="Itens por pagina"><Select value={filters.pageSize} onChange={(event) => updateFilter('pageSize', Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}/pag.</option>)}</Select></Field>
          <Field label="Buscar cliente"><Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} /></Field>
        </div>
      </Card>

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Invoices filtradas" value={String(summary.count)} />
        <MetricCard label="Saldo aberto" value={formatBRL(summary.openBalance)} />
        <MetricCard label="Pagas (pagina)" value={String(summary.paidCount)} />
        <MetricCard label="Vencidas (pagina)" value={String(summary.overdueCount)} />
      </div>

      <Card className="overflow-hidden p-0">
        {error ? <div className="p-5 text-sm text-red-200">Erro ao carregar faturamento.</div> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1040px] text-left text-sm whitespace-nowrap">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Emissao</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">B/Ls</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Pago</th><th className="px-4 py-3">Saldo</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Acoes</th></tr></thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">Carregando invoices...</td></tr> : null}
              {!isLoading && invoices.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-400">Nenhuma invoice encontrada.</td></tr> : null}
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-3 font-semibold text-[#58a6ff]">{invoice.invoice_number ?? `INV-${invoice.id}`}</td>
                  <td className="px-4 py-3"><span className="app-table__truncate app-table__truncate--lg" title={invoice.customer?.name ?? '-'}>{invoice.customer?.name ?? '-'}</span></td>
                  <td className="px-4 py-3">{formatDate(invoice.issued_at)}</td>
                  <td className="px-4 py-3">{formatDate(invoice.due_date)}</td>
                  <td className="px-4 py-3">{invoice.invoice_bls?.length ?? 0}</td>
                  <td className="px-4 py-3">{formatBRL(invoice.total_brl)}</td>
                  <td className="px-4 py-3">{formatBRL(invoice.total_paid_brl)}</td>
                  <td className="px-4 py-3">{formatBRL(invoice.balance_brl)}</td>
                  <td className="px-4 py-3">{renderInvoiceStatus(invoice.status)}</td>
                  <td className="px-4 py-3"><Button variant="secondary" onClick={() => setSelectedInvoiceId(invoice.id)}>Detalhes</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="app-table__footer"><span>Pagina {filters.page} de {totalPages} · {data?.count ?? 0} registros</span><div className="app-table__footer-controls"><Button variant="secondary" disabled={filters.page <= 1} onClick={() => updateFilter('page', Math.max(1, filters.page - 1))}>Anterior</Button><Button variant="secondary" disabled={filters.page >= totalPages} onClick={() => updateFilter('page', Math.min(totalPages, filters.page + 1))}>Proxima</Button></div></div>
      </Card>

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); resetCreateState() }} title="Nova Invoice">
        <div className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Modo"><Select value={createMode} onChange={(event) => setCreateMode(event.target.value as 'single' | 'consolidated')}><option value="consolidated">Consolidada</option><option value="single">B/L unico</option></Select></Field>
            <Field label="Cliente"><Select value={createCustomerId} onChange={(event) => setCreateCustomerId(event.target.value)}><option value="">Detectar pelos B/Ls</option>{customerOptions?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select></Field>
            <Field label="Viagem"><Select value={createVoyageId} onChange={(event) => setCreateVoyageId(event.target.value)}><option value="">Todas</option>{voyageOptions?.map((voyage) => <option key={voyage.id} value={voyage.id}>{voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}</option>)}</Select></Field>
            <Field label="Carga"><Select value={createCargoMode} onChange={(event) => setCreateCargoMode(event.target.value as '' | 'container' | 'carga_solta')}><option value="">Todos</option><option value="container">Container</option><option value="carga_solta">Carga Solta</option></Select></Field>
            <Field label="Vencimento"><Input type="date" value={createDueDate} onChange={(event) => setCreateDueDate(event.target.value)} /></Field>
            <Field label="Buscar B/L"><Input value={createSearch} onChange={(event) => setCreateSearch(event.target.value)} /></Field>
          </div>
          <Field label="Observacoes"><Textarea value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} /></Field>
          <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">{createMode === 'single' ? 'Selecione exatamente 1 B/L.' : 'Selecione um ou mais B/Ls do mesmo cliente.'}</div>
          <div className="app-table-scroll max-h-72 rounded-xl border border-[#30363d]">
            <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Sel.</th><th className="px-3 py-2">B/L</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Viagem</th><th className="px-3 py-2">Trecho</th></tr></thead>
              <tbody className="divide-y divide-[#30363d]">
                {loadingReadyBls ? <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Carregando B/Ls elegiveis...</td></tr> : null}
                {!loadingReadyBls && filteredReadyBls.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Nenhum B/L pronto para faturar.</td></tr> : null}
                {filteredReadyBls.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2"><input type="checkbox" checked={selectedBls.includes(row.id)} onChange={() => toggleBl(row.id)} /></td>
                    <td className="px-3 py-2 font-semibold text-[#58a6ff]">{row.id}</td>
                    <td className="px-3 py-2">{row.customer?.name ?? '-'}</td>
                    <td className="px-3 py-2">{row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}</td>
                    <td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setCreateOpen(false); resetCreateState() }}>Cancelar</Button><Button loading={createInvoiceMutation.isPending} onClick={handleCreateInvoice}><DollarSign size={16} />Emitir invoice</Button></div>
        </div>
      </Modal>

      <Modal open={Boolean(selectedInvoiceId)} onClose={closeDetails} title={`Detalhe Invoice ${detailQuery.data?.invoice?.invoice_number ?? selectedInvoiceId ?? ''}`}>
        <div className="grid gap-5">
          {detailQuery.isLoading ? <div className="text-sm text-slate-400">Carregando detalhe...</div> : null}
          {detailQuery.error ? <div className="text-sm text-red-200">Falha ao carregar detalhe.</div> : null}
          {detailQuery.data?.invoice ? (
            <>
              <div className="flex justify-end">
                <Button variant="secondary" loading={isPdfGenerating} onClick={handleDownloadPdf}>
                  <FileDown size={16} />Gerar PDF
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                <MetricCard label="Total" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                <MetricCard label="Pago" value={formatBRL(detailQuery.data.invoice.total_paid_brl)} />
                <MetricCard label="Saldo" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                <MetricCard label="B/Ls" value={String(detailQuery.data.bls.length)} />
              </div>
              <Card className="overflow-hidden p-0">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[620px] text-left text-sm"><thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">B/L</th><th className="px-3 py-2">Trecho</th><th className="px-3 py-2">Subtotal BRL</th></tr></thead><tbody className="divide-y divide-[#30363d]">{detailQuery.data.bls.map((row) => <tr key={row.id}><td className="px-3 py-2 font-semibold text-[#58a6ff]"><Link className="hover:underline" to={`/manifestos/${row.bl_id}`}>{row.bl_id}</Link></td><td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td><td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td></tr>)}</tbody></table>
                </div>
              </Card>
              <div className="grid gap-4 xl:grid-cols-2">
                <Card><h3 className="mb-3 text-base font-semibold text-white">Registrar pagamento</h3><div className="grid gap-4 md:grid-cols-2"><Field label="Valor BRL"><Input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></Field><Field label="Metodo"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="pix">PIX</option><option value="ted">TED</option><option value="doc">DOC</option><option value="boleto">Boleto</option><option value="outros">Outros</option></Select></Field><Field label="Data"><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></Field><Field label="Notas"><Input value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></Field></div><div className="mt-4 flex justify-end"><Button loading={registerPaymentMutation.isPending} onClick={handleRegisterPayment}><DollarSign size={16} />Registrar pagamento</Button></div></Card>
                <Card><h3 className="mb-3 text-base font-semibold text-white">Cancelar invoice</h3><Field label="Motivo"><Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field><div className="mt-4 flex justify-end"><Button variant="danger" loading={cancelInvoiceMutation.isPending} disabled={detailQuery.data.payments.length > 0} onClick={handleCancelInvoice}><Ban size={16} />Cancelar invoice</Button></div></Card>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <Card className="app-kpi-card app-kpi-card--navy"><div className="app-kpi-card__label">{label}</div><div className="app-kpi-card__value app-kpi-card__value--navy">{value}</div></Card>
}

function renderInvoiceStatus(status: string | null) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'partially_paid') return <Badge tone="blue">Parcial</Badge>
  if (status === 'overdue') return <Badge tone="yellow">Vencida</Badge>
  if (status === 'cancelled') return <Badge tone="slate">Cancelada</Badge>
  if (status === 'draft') return <Badge tone="yellow">Draft</Badge>
  return <Badge tone="blue">Emitida</Badge>
}

function statusLabel(status: string | null) {
  if (status === 'partially_paid') return 'Parcial'
  if (status === 'overdue') return 'Vencida'
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'paid') return 'Paga'
  if (status === 'draft') return 'Draft'
  return 'Emitida'
}
