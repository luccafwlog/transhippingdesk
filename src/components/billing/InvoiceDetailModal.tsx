import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, DollarSign, Plus, Printer, Trash2 } from 'lucide-react'
import { InvoiceDocumentLocal } from './InvoiceDocumentLocal'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { MetricCard } from '../ui/MetricCard'
import { SkeletonTable } from '../ui/Skeleton'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import {
  useAddManualInvoiceCharge,
  useCancelInvoice,
  useDeleteManualInvoiceCharge,
  useInvoiceDetail,
  useRegisterInvoicePayment,
} from '../../hooks/useBilling'
import { useRegisterLedgerInvoicePayment } from '../../hooks/useBillingLedger'
import { buildInvoiceFileBaseName, isConsolidatedInvoice } from '../../services/billing'
import { formatValidationError, manualInvoiceChargeSchema, paymentFormSchema } from '../../services/financialValidation'
import { createAlert } from '../../services/alerts'
import { logOperationalEvent } from '../../services/operationalEvents'
import { formatBRL, formatDate, formatUSD, stripBlPrefix } from '../../lib/utils'
import { isLedgerInvoicePayable } from '../../pages/faturamentoLedgerPayment'
import { invoiceStatusLabel } from '../../pages/faturamentoInvoiceStatus'

function extractMessage(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const msg = (error as { message?: string }).message
    if (msg) return msg
  }
  return fallback
}

type PaymentMethod = 'pix' | 'ted' | 'doc' | 'boleto' | 'outros'

type InvoiceDetailModalProps = {
  invoiceId: number | null
  onClose: () => void
}

export function InvoiceDetailModal({ invoiceId, onClose }: InvoiceDetailModalProps) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()

  const [printOpen, setPrintOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [chargeDescription, setChargeDescription] = useState('')
  const [chargeQuantity, setChargeQuantity] = useState('1')
  const [chargeUnitValue, setChargeUnitValue] = useState('')
  const [chargeNotes, setChargeNotes] = useState('')

  const detailQuery = useInvoiceDetail(invoiceId)
  const detailInvoice = detailQuery.data?.invoice ?? null
  const isLedgerPayable = isLedgerInvoicePayable(detailInvoice)
  const registerPaymentMutation = useRegisterInvoicePayment()
  const registerLedgerPaymentMutation = useRegisterLedgerInvoicePayment()
  const cancelInvoiceMutation = useCancelInvoice()
  const addChargeMutation = useAddManualInvoiceCharge()
  const deleteChargeMutation = useDeleteManualInvoiceCharge(invoiceId)

  // Other Charges so podem ser editados em faturas individuais, abertas e sem pagamentos.
  const canEditCharges = Boolean(
    detailInvoice &&
      !isConsolidatedInvoice(detailInvoice) &&
      (detailInvoice.status ?? 'issued') !== 'cancelled' &&
      (detailQuery.data?.payments.length ?? 0) === 0,
  )

  const ledgerBalance = Number(detailInvoice?.balance_brl ?? detailInvoice?.total_brl ?? 0)
  // Ajuste durante o render (em vez de useEffect) quando o alvo do prefill muda.
  const ledgerPrefill = isLedgerPayable ? `${invoiceId}:${ledgerBalance}` : null
  const [prevLedgerPrefill, setPrevLedgerPrefill] = useState<string | null>(null)
  if (ledgerPrefill !== prevLedgerPrefill) {
    setPrevLedgerPrefill(ledgerPrefill)
    if (ledgerPrefill !== null) {
      setPaymentAmount(ledgerBalance ? String(ledgerBalance) : '')
    }
  }

  async function handleRegisterPayment() {
    if (!invoiceId) return
    const paymentValidation = paymentFormSchema.safeParse({
      amountBrl: paymentAmount,
      paymentMethod,
      paidAt: paymentDate,
    })
    if (!paymentValidation.success) {
      showToast(formatValidationError(paymentValidation.error, 'Valor de pagamento invalido.'), 'error')
      return
    }
    const payment = paymentValidation.data
    try {
      if (isLedgerPayable) {
        await registerLedgerPaymentMutation.mutateAsync({
          invoiceId,
          amountBrl: payment.amountBrl,
          method: payment.paymentMethod,
          paidAt: payment.paidAt ? new Date(`${payment.paidAt}T12:00:00`).toISOString() : null,
          source: 'manual',
          notes: paymentNotes.trim() || null,
        })
      } else {
        await registerPaymentMutation.mutateAsync({
          invoiceId,
          amountBrl: payment.amountBrl,
          paymentMethod: payment.paymentMethod,
          paidAt: payment.paidAt ? new Date(`${payment.paidAt}T12:00:00`).toISOString() : null,
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
      void createAlert({ type: 'invoice_payment_invalid', entityType: 'invoice', entityId: String(invoiceId ?? ''), message: msg })
      void logOperationalEvent({ code: 'invoice_payment_invalid', message: msg, changedBy: user?.id ?? null, entityId: String(invoiceId ?? '') })
      void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
    }
  }

  async function handleAddCharge() {
    if (!invoiceId) return
    const chargeValidation = manualInvoiceChargeSchema.safeParse({
      description: chargeDescription,
      quantity: chargeQuantity,
      unitValueBrl: chargeUnitValue,
    })
    if (!chargeValidation.success) {
      showToast(formatValidationError(chargeValidation.error, 'Item invalido.'), 'error')
      return
    }
    const charge = chargeValidation.data
    try {
      await addChargeMutation.mutateAsync({
        invoiceId,
        description: charge.description,
        quantity: charge.quantity,
        unitValueBrl: charge.unitValueBrl,
        notes: chargeNotes.trim() || null,
        actorId: user?.id ?? null,
      })
      setChargeDescription('')
      setChargeQuantity('1')
      setChargeUnitValue('')
      setChargeNotes('')
      showToast('Item adicionado a fatura.', 'success')
    } catch (error) {
      showToast(extractMessage(error, 'Falha ao adicionar item.'), 'error')
    }
  }

  async function handleDeleteCharge(itemId: number) {
    try {
      await deleteChargeMutation.mutateAsync({ itemId, actorId: user?.id ?? null })
      showToast('Item removido da fatura.', 'success')
    } catch (error) {
      showToast(extractMessage(error, 'Falha ao remover item.'), 'error')
    }
  }

  async function handleCancelInvoice() {
    if (!invoiceId) return
    try {
      await cancelInvoiceMutation.mutateAsync({
        invoiceId,
        reason: cancelReason.trim() || null,
        actorId: user?.id ?? null,
      })
      setCancelReason('')
      showToast('Invoice cancelada.', 'success')
    } catch (error) {
      const msg = extractMessage(error, 'Falha ao cancelar invoice.')
      showToast(msg, 'error')
      void createAlert({ type: 'invoice_cancel_blocked', entityType: 'invoice', entityId: String(invoiceId ?? ''), message: msg })
      void logOperationalEvent({ code: 'invoice_cancel_blocked', message: msg, changedBy: user?.id ?? null, entityId: String(invoiceId ?? '') })
      void queryClient.invalidateQueries({ queryKey: ['financial-alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['op-count'] })
    }
  }

  function handlePrintInvoice() {
    if (!detailQuery.data) return
    setPrintOpen(true)
  }

  return (
    <>
      <Modal open={Boolean(invoiceId)} onClose={onClose} title={`Detalhe Invoice ${detailQuery.data?.invoice?.invoice_number ?? invoiceId ?? ''}`}>
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
              <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                <MetricCard label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                <MetricCard label="Total" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                <MetricCard label="Pago" value={formatBRL(detailQuery.data.invoice.total_paid_brl)} />
                <MetricCard label="Saldo" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                <MetricCard label="B/Ls" value={String(detailQuery.data.bls.length)} />
              </div>
              <Card>
                <h2 className="text-base font-semibold text-white">Informações da Fatura</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <SelectionMetric label="Cliente" value={detailQuery.data.invoice.customer_name ?? '-'} />
                  <SelectionMetric label="CNPJ" value={detailQuery.data.invoice.customer_cnpj_cpf ?? '-'} />
                  <SelectionMetric label="Emissao" value={formatDate(detailQuery.data.invoice.issued_at)} />
                  <SelectionMetric label="Status" value={statusLabel(detailQuery.data.invoice.status)} />
                  <SelectionMetric label="Itens" value={String(detailQuery.data.items.length)} />
                  <SelectionMetric label="Pagamentos" value={String(detailQuery.data.payments.length)} />
                  <SelectionMetric label="Total BRL" value={formatBRL(detailQuery.data.invoice.total_brl)} />
                  <SelectionMetric label="Saldo BRL" value={formatBRL(detailQuery.data.invoice.balance_brl)} />
                </div>
              </Card>
              <Card className="overflow-hidden p-0">
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[620px] text-left text-sm"><thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-3 py-2">B/L</th><th scope="col" className="px-3 py-2">Trecho</th><th scope="col" className="px-3 py-2">Subtotal BRL</th></tr></thead><tbody className="divide-y divide-[#30363d]">{detailQuery.data.bls.map((row) => <tr key={row.id}><td className="px-3 py-2 font-semibold text-[#58a6ff]"><Link className="hover:underline" to={`/manifestos/${row.bl_id}`}>{row.bl_id}</Link></td><td className="px-3 py-2">{row.pol ?? '-'} - {row.pod ?? '-'}</td><td className="px-3 py-2">{formatBRL(row.subtotal_brl)}</td></tr>)}</tbody></table>
                </div>
              </Card>
              <Card className="overflow-hidden p-0">
                <div className="border-b border-[#30363d] px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Itens da invoice</h2>
                </div>
                {canEditCharges ? (
                  <div className="border-b border-[#30363d] px-4 py-4">
                    <div className="mb-3 text-sm font-semibold text-white">Outras cobranças (manuais)</div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <Field label="Descricao">
                        <Input
                          value={chargeDescription}
                          onChange={(event) => setChargeDescription(event.target.value)}
                          placeholder="Ex: Ajuste manual"
                        />
                      </Field>
                      <Field label="Quantidade">
                        <Input value={chargeQuantity} onChange={(event) => setChargeQuantity(event.target.value)} />
                      </Field>
                      <Field label="Valor unitario (BRL)">
                        <Input value={chargeUnitValue} onChange={(event) => setChargeUnitValue(event.target.value)} placeholder="0,00" />
                      </Field>
                      <Field label="Observacao">
                        <Input
                          value={chargeNotes}
                          onChange={(event) => setChargeNotes(event.target.value)}
                          placeholder="Justificativa operacional"
                        />
                      </Field>
                      <div className="flex items-end">
                        <Button type="button" onClick={handleAddCharge} loading={addChargeMutation.isPending}>
                          <Plus size={16} />Adicionar other charge
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="app-table-scroll">
                  <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
                    <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2">Descricao</th>
                        <th scope="col" className="px-3 py-2">Qtd</th>
                        <th scope="col" className="px-3 py-2">Origem</th>
                        <th scope="col" className="px-3 py-2">Unitario</th>
                        <th scope="col" className="px-3 py-2">Total</th>
                        <th scope="col" className="px-3 py-2">Acoes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {detailQuery.data.items.length === 0 ? (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-400" colSpan={6}>
                            Nenhum item encontrado nesta invoice.
                          </td>
                        </tr>
                      ) : (
                        detailQuery.data.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2">{stripBlPrefix(item.description, item.bl_id)}</td>
                            <td className="px-3 py-2">{item.quantity ?? 1}</td>
                            <td className="px-3 py-2">{item.source === 'manual' ? <Badge tone="yellow">Manual</Badge> : <Badge tone="blue">Auto</Badge>}</td>
                            <td className="px-3 py-2">{item.currency === 'USD' ? formatUSD(item.unit_value_usd) : formatBRL(item.unit_value_brl)}</td>
                            <td className="px-3 py-2">{item.currency === 'USD' ? formatUSD(item.total_value_usd) : formatBRL(item.total_value_brl)}</td>
                            <td className="px-3 py-2">
                              {canEditCharges && item.source === 'manual' ? (
                                <Button
                                  variant="ghost"
                                  type="button"
                                  onClick={() => handleDeleteCharge(item.id)}
                                  loading={deleteChargeMutation.isPending && deleteChargeMutation.variables?.itemId === item.id}
                                >
                                  <Trash2 size={15} />Remover
                                </Button>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
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
                <Card><h2 className="mb-3 text-base font-semibold text-white">Registrar pagamento</h2><div className="grid gap-4 md:grid-cols-2"><Field label={isLedgerPayable ? 'Valor BRL (saldo via ledger)' : 'Valor BRL'}><Input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></Field><Field label="Metodo"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="pix">PIX</option><option value="ted">TED</option><option value="doc">DOC</option><option value="boleto">Boleto</option><option value="outros">Outros</option></Select></Field><Field label="Data"><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></Field><Field label="Notas"><Input value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} /></Field></div><div className="mt-4 flex justify-end"><Button loading={registerPaymentMutation.isPending || registerLedgerPaymentMutation.isPending} onClick={handleRegisterPayment}><DollarSign size={16} />Registrar pagamento</Button></div></Card>
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
              document.title = buildInvoiceFileBaseName(detailQuery.data!)
              window.print()
              document.title = prev
            }}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={detailQuery.data} />
          </div>
        </Modal>
      )}
    </>
  )
}

function SelectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#30363d] bg-[var(--app-surface-muted)] px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-100">{value}</div>
    </div>
  )
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
