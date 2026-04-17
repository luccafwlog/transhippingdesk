import { useMemo, useState } from 'react'
import { Download, FilePlus2, LogOut } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { usePortalCreateConsolidation, usePortalInvoiceDetail, usePortalInvoices, usePortalPendingBls } from '../hooks/usePortalBilling'
import { downloadInvoicePdf } from '../services/invoicePdf'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'

export function PortalBilling() {
  const { overview, signOut } = usePortalAuth()
  const { showToast } = useToast()
  const { data: pendingBls, isLoading: pendingLoading, error: pendingError } = usePortalPendingBls()
  const { data: invoices, isLoading: invoicesLoading, error: invoicesError } = usePortalInvoices()
  const createConsolidationMutation = usePortalCreateConsolidation()

  const [selectedBls, setSelectedBls] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  const detailQuery = usePortalInvoiceDetail(selectedInvoiceId)

  const selectedSubtotal = useMemo(
    () =>
      (pendingBls ?? [])
        .filter((row) => selectedBls.includes(row.bl_id))
        .reduce((sum, row) => sum + Number(row.subtotal_brl ?? 0), 0),
    [pendingBls, selectedBls],
  )

  function toggleBl(blId: string) {
    setSelectedBls((current) => (current.includes(blId) ? current.filter((value) => value !== blId) : [...current, blId]))
  }

  async function handleConsolidate() {
    if (selectedBls.length === 0) {
      showToast('Selecione ao menos um B/L para consolidar.', 'error')
      return
    }

    try {
      const payload = await createConsolidationMutation.mutateAsync({
        blIds: selectedBls,
        dueDate: dueDate || null,
        notes: notes.trim() || null,
      })

      setSelectedBls([])
      setNotes('')
      setDueDate('')
      setSelectedInvoiceId(Number(payload.invoice_id ?? 0) || null)
      showToast('Invoice consolidada gerada com sucesso.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao consolidar cobrancas.', 'error')
    }
  }

  async function handleDownloadPdf() {
    if (!detailQuery.data) return
    setPdfLoading(true)
    try {
      await downloadInvoicePdf(detailQuery.data)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao gerar PDF.', 'error')
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0d1117] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Portal de faturamento"
          description={`Cliente ${overview?.customer_name ?? '-'} (${formatCnpjCpf(overview?.customer_cnpj_cpf)})`}
          action={
            <Button variant="secondary" onClick={() => void signOut()}>
              <LogOut size={16} />
              Sair
            </Button>
          }
        />

        <div className="mb-5 grid gap-4 md:grid-cols-3">
          <MetricCard label="Saldo pendente" value={formatBRL(overview?.pending_balance)} />
          <MetricCard label="B/Ls elegiveis" value={String(pendingBls?.length ?? 0)} />
          <MetricCard label="Invoices emitidas" value={String(invoices?.length ?? 0)} />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.2fr,0.8fr]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[#30363d] px-5 py-4">
              <h2 className="text-lg font-semibold text-white">B/Ls prontos para faturamento</h2>
              <p className="mt-1 text-sm text-slate-400">Selecione os B/Ls pendentes para gerar uma invoice consolidada.</p>
            </div>
            {pendingError ? <div className="px-5 py-4 text-sm text-red-200">Falha ao consultar B/Ls pendentes.</div> : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[720px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Sel.</th>
                    <th className="px-4 py-3">B/L</th>
                    <th className="px-4 py-3">Trecho</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Bloqueio</th>
                    <th className="px-4 py-3">Subtotal BRL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {pendingLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                        Carregando B/Ls elegiveis...
                      </td>
                    </tr>
                  ) : null}
                  {!pendingLoading && (pendingBls?.length ?? 0) === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={6}>
                        Nenhum B/L pronto para faturamento neste momento.
                      </td>
                    </tr>
                  ) : null}
                  {pendingBls?.map((row) => (
                    <tr key={row.bl_id}>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={selectedBls.includes(row.bl_id)} onChange={() => toggleBl(row.bl_id)} />
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.bl_id}</td>
                      <td className="px-4 py-3">
                        {row.pol ?? '-'} - {row.pod ?? '-'}
                      </td>
                      <td className="px-4 py-3">{renderBillingBadge(row.charge_status)}</td>
                      <td className="px-4 py-3">
                        <span className="app-table__truncate app-table__truncate--lg" title={row.billing_hold_reason ?? '-'}>
                          {row.billing_hold_reason ?? '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">{formatBRL(row.subtotal_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Gerar invoice consolidada</h2>
            <p className="mt-1 text-sm text-slate-400">A invoice sera emitida somente com itens BRL elegiveis.</p>
            <div className="mt-4 grid gap-4">
              <Field label="Vencimento">
                <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </Field>
              <Field label="Observacoes">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="text-sm text-slate-400">B/Ls selecionados</div>
                <div className="mt-2 text-2xl font-bold text-white">{selectedBls.length}</div>
                <div className="mt-2 text-sm text-slate-400">Subtotal estimado</div>
                <div className="text-lg font-semibold text-white">{formatBRL(selectedSubtotal)}</div>
                <div className="mt-2 text-xs text-slate-500">Contato financeiro: {overview?.contact_email ?? '-'}</div>
              </div>
              <Button loading={createConsolidationMutation.isPending} onClick={handleConsolidate}>
                <FilePlus2 size={16} />
                Consolidar e emitir
              </Button>
            </div>
          </Card>
        </div>

        <Card className="mt-5 overflow-hidden p-0">
          <div className="border-b border-[#30363d] px-5 py-4">
            <h2 className="text-lg font-semibold text-white">Invoices emitidas</h2>
          </div>
          {invoicesError ? <div className="px-5 py-4 text-sm text-red-200">Falha ao consultar invoices.</div> : null}
          <div className="app-table-scroll">
            <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
              <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Emissao</th>
                  <th className="px-4 py-3">Vencimento</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Saldo</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {invoicesLoading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>
                      Carregando invoices...
                    </td>
                  </tr>
                ) : null}
                {!invoicesLoading && (invoices?.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-400" colSpan={7}>
                      Nenhuma invoice emitida para este cliente.
                    </td>
                  </tr>
                ) : null}
                {invoices?.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-semibold text-[#58a6ff]">{invoice.invoice_number ?? `INV-${invoice.id}`}</td>
                    <td className="px-4 py-3">{formatDate(invoice.issued_at)}</td>
                    <td className="px-4 py-3">{formatDate(invoice.due_date)}</td>
                    <td className="px-4 py-3">{formatBRL(invoice.total_brl)}</td>
                    <td className="px-4 py-3">{formatBRL(invoice.balance_brl)}</td>
                    <td className="px-4 py-3">{renderInvoiceBadge(invoice.status)}</td>
                    <td className="px-4 py-3">
                      <Button variant="secondary" onClick={() => setSelectedInvoiceId(invoice.id)}>
                        Detalhes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal
        open={Boolean(selectedInvoiceId)}
        onClose={() => setSelectedInvoiceId(null)}
        title={`Invoice ${detailQuery.data?.invoice?.invoice_number ?? selectedInvoiceId ?? ''}`}
      >
        <div className="grid gap-5">
          {detailQuery.isLoading ? <div className="text-sm text-slate-400">Carregando detalhe...</div> : null}
          {detailQuery.error ? <div className="text-sm text-red-200">Falha ao carregar detalhe da invoice.</div> : null}
          {detailQuery.data?.invoice ? (
            <>
              <div className="flex justify-end">
                <Button variant="secondary" loading={pdfLoading} onClick={handleDownloadPdf}>
                  <Download size={16} />
                  Baixar PDF
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
                  <table className="app-table app-table--compact min-w-[620px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2">B/L</th>
                        <th className="px-3 py-2">Trecho</th>
                        <th className="px-3 py-2">Subtotal BRL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {detailQuery.data.bls.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 font-semibold text-[#58a6ff]">{row.bl_id}</td>
                          <td className="px-3 py-2">
                            {row.pol ?? '-'} - {row.pod ?? '-'}
                          </td>
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
    </main>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="app-kpi-card app-kpi-card--navy">
      <div className="app-kpi-card__label">{label}</div>
      <div className="app-kpi-card__value app-kpi-card__value--navy">{value}</div>
    </Card>
  )
}

function renderBillingBadge(status: string | null) {
  if (status === 'ready_for_billing') return <Badge tone="green">Pronto</Badge>
  if (status === 'review_required') return <Badge tone="yellow">Revisao</Badge>
  if (status === 'reviewed') return <Badge tone="blue">Revisado</Badge>
  return <Badge tone="slate">{status ?? 'Pendente'}</Badge>
}

function renderInvoiceBadge(status: string | null) {
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
