import { useMemo, useState } from 'react'
import { Download, FilePlus2, LogOut } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { usePortalAuth } from '../hooks/usePortalAuth'
import {
  usePortalCreateConsolidation,
  usePortalDemurrageInvoiceDetail,
  usePortalDemurrageInvoices,
  usePortalInvoiceDetail,
  usePortalInvoices,
  usePortalPendingBls,
} from '../hooks/usePortalBilling'
import { formatBRL, formatCnpjCpf, formatDate } from '../lib/utils'

type PortalTab = 'local' | 'demurrage'

export function PortalBilling() {
  const { overview, signOut } = usePortalAuth()
  const { showToast } = useToast()
  const { data: pendingBls, isLoading: pendingLoading, error: pendingError } = usePortalPendingBls()
  const { data: invoices, isLoading: invoicesLoading, error: invoicesError } = usePortalInvoices()
  const createConsolidationMutation = usePortalCreateConsolidation()

  const [tab, setTab] = useState<PortalTab>('local')
  const [selectedBls, setSelectedBls] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null)
  const [selectedDemurrageId, setSelectedDemurrageId] = useState<number | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  const detailQuery = usePortalInvoiceDetail(selectedInvoiceId)
  const { data: demurrageInvoices, isLoading: demurrageLoading } = usePortalDemurrageInvoices()
  const demurrageDetailQuery = usePortalDemurrageInvoiceDetail(selectedDemurrageId)

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
      const { downloadInvoicePdf } = await import('../services/invoicePdf')
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

        {/* Tab switcher */}
        <div className="mt-5 flex gap-2 border-b border-[#30363d]">
          <button type="button" className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'local' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400 hover:text-slate-200'}`} onClick={() => setTab('local')}>
            Taxas Locais
          </button>
          <button type="button" className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'demurrage' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-slate-400 hover:text-slate-200'}`} onClick={() => setTab('demurrage')}>
            Demurrage
          </button>
        </div>

        {tab === 'demurrage' ? (
          <Card className="mt-5 overflow-hidden p-0">
            <div className="border-b border-[#30363d] px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Sobreestadia de containers (D&D)</h2>
            </div>
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3">BL / Trecho</th>
                    <th className="px-4 py-3">Emissao</th>
                    <th className="px-4 py-3">Vencimento</th>
                    <th className="px-4 py-3">Total USD</th>
                    <th className="px-4 py-3">Total BRL</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Acao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {demurrageLoading ? (
                    <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={8}>Carregando...</td></tr>
                  ) : null}
                  {!demurrageLoading && !demurrageInvoices?.length ? (
                    <tr><td className="px-4 py-8 text-center text-slate-400" colSpan={8}>Nenhuma invoice de demurrage emitida.</td></tr>
                  ) : null}
                  {demurrageInvoices?.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-3 font-semibold text-[#58a6ff]">{inv.doc_number}</td>
                      <td className="px-4 py-3">{inv.bl_id} — {inv.pol ?? '-'} / {inv.pod ?? '-'}</td>
                      <td className="px-4 py-3">{formatDate(inv.billed_at)}</td>
                      <td className="px-4 py-3">{formatDate(inv.due_date)}</td>
                      <td className="px-4 py-3">$ {Number(inv.total_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3">{inv.frozen_total_brl != null ? formatBRL(inv.frozen_total_brl) : '—'}</td>
                      <td className="px-4 py-3">{renderDemurrageBadge(inv.status)}</td>
                      <td className="px-4 py-3">
                        <Button variant="secondary" onClick={() => setSelectedDemurrageId(inv.id)}>Detalhes</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'local' ? (
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
        ) : null}
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

              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Itens da invoice</h3>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Descricao</th>
                        <th className="px-3 py-2">B/L</th>
                        <th className="px-3 py-2">Qtd</th>
                        <th className="px-3 py-2">Unitario</th>
                        <th className="px-3 py-2">Total</th>
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
                            <td className="px-3 py-2 font-semibold text-[#58a6ff]">{item.bl_id ?? '-'}</td>
                            <td className="px-3 py-2">{item.quantity ?? 1}</td>
                            <td className="px-3 py-2">{formatBRL(item.unit_value_brl)}</td>
                            <td className="px-3 py-2">{formatBRL(item.total_value_brl)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Pagamentos</h3>
                </div>
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Data</th>
                        <th className="px-3 py-2">Metodo</th>
                        <th className="px-3 py-2">Valor</th>
                        <th className="px-3 py-2">Observacoes</th>
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
                            <td className="px-3 py-2">
                              <span className="app-table__truncate app-table__truncate--lg" title={payment.notes ?? '-'}>
                                {payment.notes ?? '-'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </Modal>

      {/* Demurrage Invoice Detail Modal */}
      <Modal
        open={Boolean(selectedDemurrageId)}
        onClose={() => setSelectedDemurrageId(null)}
        title={`Demurrage ${demurrageDetailQuery.data?.invoice?.doc_number ?? selectedDemurrageId ?? ''}`}
      >
        <div className="grid gap-5">
          {demurrageDetailQuery.isLoading ? <div className="text-sm text-slate-400">Carregando...</div> : null}
          {demurrageDetailQuery.error ? <div className="text-sm text-red-200">Falha ao carregar detalhe.</div> : null}
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
                  <div className="border-b border-[#30363d] px-4 py-3 text-sm font-semibold text-slate-300">Containers</div>
                  <div className="app-table-scroll">
                    <table className="app-table app-table--compact min-w-[720px] text-sm">
                      <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Container</th>
                          <th className="px-3 py-2">Tipo</th>
                          <th className="px-3 py-2">Descarga</th>
                          <th className="px-3 py-2">Devolucao</th>
                          <th className="px-3 py-2">Dias</th>
                          <th className="px-3 py-2">P1</th>
                          <th className="px-3 py-2">P2</th>
                          <th className="px-3 py-2">USD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#30363d]">
                        {items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 font-semibold text-white">{item.container_number}</td>
                            <td className="px-3 py-2">{item.container_type}</td>
                            <td className="px-3 py-2">{formatDate(item.discharge_date)}</td>
                            <td className="px-3 py-2">{formatDate(item.return_date)}</td>
                            <td className="px-3 py-2">{item.total_days}</td>
                            <td className="px-3 py-2">{item.days_p1}d × ${item.rate_p1_usd}</td>
                            <td className="px-3 py-2">{item.days_p2}d × ${item.rate_p2_usd}</td>
                            <td className="px-3 py-2 text-amber-300">$ {Number(item.subtotal_usd).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {invoice.pix_payload ? (
                  <Card className="p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-300">Pagamento via PIX</div>
                    <div className="flex flex-col items-center gap-4 sm:flex-row">
                      <QRCodeSVG value={invoice.pix_payload} size={120} level="M" />
                      <div>
                        <div className="mb-1 text-xs text-slate-500">Copia e cola</div>
                        <div className="max-w-xs break-all rounded bg-[#0d1117] p-2 font-mono text-xs text-slate-200">{invoice.pix_payload}</div>
                      </div>
                    </div>
                  </Card>
                ) : null}
              </>
            )
          })() : null}
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

function renderDemurrageBadge(status: string | null) {
  if (status === 'paid') return <Badge tone="green">Pago</Badge>
  if (status === 'overdue') return <Badge tone="red">Vencida</Badge>
  return <Badge tone="blue">Emitida</Badge>
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

function renderPaymentMethod(method: string | null) {
  if (method === 'pix') return 'PIX'
  if (method === 'ted') return 'TED'
  if (method === 'doc') return 'DOC'
  if (method === 'boleto') return 'Boleto'
  if (method === 'outros') return 'Outros'
  return method ?? '-'
}
