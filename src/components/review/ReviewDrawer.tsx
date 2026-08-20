import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { formatCnpj } from '../../lib/cnpj'
import { logOperationalEvent } from '../../services/operationalEvents'
import { ConcurrentEditError, saveBlReview, saveGraniteBlReview } from '../../services/review'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import { invalidateReviewQueueCaches } from './reviewCaches'

export function ReviewDrawer({
  item,
  currentIndex,
  totalItems,
  onClose,
  onSaved,
  onReviewSaved,
  onNavigate,
  siblingIds,
}: {
  item: ReviewQueueItem | null
  currentIndex: number
  totalItems: number
  onClose: () => void
  onSaved: (resolved: boolean) => void
  onReviewSaved: (item: ReviewQueueItem) => void
  onNavigate: (id: string) => void
  siblingIds: string[]
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [shipper, setShipper] = useState('')
  const [consignee, setConsignee] = useState('')
  const [pol, setPol] = useState('')
  const [pod, setPod] = useState('')
  const [totalWeightKg, setTotalWeightKg] = useState('')
  const [totalCbm, setTotalCbm] = useState('')
  const [notes, setNotes] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [selectedCustomerDisplay, setSelectedCustomerDisplay] = useState<string | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const customerLookup = useCustomerLookup(customerSearch)

  // Re-baseia o formulário quando o item em revisão muda — ajuste durante
  // o render (padrão "adjusting state when props change" do React).
  const [prevItem, setPrevItem] = useState<typeof item | null>(null)
  if (item && item !== prevItem) {
    setPrevItem(item)
    setShipper(item.shipper ?? '')
    setConsignee(item.consignee ?? '')
    setPol(item.pol ?? '')
    setPod(item.pod ?? '')
    setTotalWeightKg(item.total_weight_kg ? String(item.total_weight_kg) : '')
    setTotalCbm(item.total_cbm ? String(item.total_cbm) : '')
    setNotes(item.notes ?? '')
    setSelectedCustomerId(item.customer_id ?? null)
    setSelectedCustomerDisplay(item.customer ? `${item.customer.name} (${formatCnpj(item.customer.cnpj_cpf)})` : null)
    setCustomerSearch('')
    setJustification('')
  }

  async function handleSave() {
    if (!item || !user) return

    setSaving(true)
    try {
      if (item.source === 'granite') {
        if (!selectedCustomerId) {
          showToast('Selecione um cliente para vincular.', 'error')
          setSaving(false)
          return
        }
        await saveGraniteBlReview({ graniteBlId: item.id, clientId: selectedCustomerId, changedBy: user.id })
        await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true, includeAudit: true })
        onReviewSaved(item)
        showToast('Cliente vinculado ao Granito.', 'success')
        onSaved(true)
        return
      }

      const result = await saveBlReview({
        blId: item.id,
        original: {
          shipper: item.shipper,
          consignee: item.consignee,
          pol: item.pol,
          pod: item.pod,
          total_weight_kg: item.total_weight_kg,
          total_cbm: item.total_cbm,
          notes: item.notes,
        },
        values: {
          shipper,
          consignee,
          pol,
          pod,
          total_weight_kg: totalWeightKg === '' ? null : Number(totalWeightKg),
          total_cbm: totalCbm === '' ? null : Number(totalCbm),
          notes,
        },
        customerId: selectedCustomerId,
        previousCustomerId: item.customer_id ?? null,
        changedBy: user.id,
        justification: justification.trim() || 'Revisão manual',
        expectedUpdatedAt: item.updated_at ?? null,
      })

      let autoInvoiceIssued = false
      let autoInvoiceMessage: string | null = null
      if (result.resolved && selectedCustomerId) {
        const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId: selectedCustomerId, actorId: user.id })
        autoInvoiceIssued = autoInvoice.status === 'invoiced'
        autoInvoiceMessage = autoInvoice.status === 'blocked' ? autoInvoice.message : null
      }

      await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true, includeAudit: true })

      if (autoInvoiceIssued) {
        showToast('B/L revisado e fatura emitida automaticamente.', 'success')
      } else if (!result.resolved) {
        showToast(`B/L salvo, mas ainda falta: ${result.pendencias.join(', ')}.`, 'info')
      } else if (autoInvoiceMessage) {
        showToast(`B/L revisado, mas o faturamento automático não concluiu: ${autoInvoiceMessage}`, 'info')
      } else {
        showToast('B/L revisado. Pronto para faturamento.', 'success')
      }

      if (!autoInvoiceIssued) {
        onReviewSaved(item)
      }
      onSaved(result.resolved)
    } catch (error) {
      if (error instanceof ConcurrentEditError) {
        void logOperationalEvent({
          code: 'bl_review_concurrent_conflict',
          message: error.message,
          changedBy: user?.id ?? null,
          entityId: item.id,
          context: { source: 'review_drawer' },
        })
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        showToast('Este B/L foi alterado por outro usuário. A fila foi recarregada.', 'error')
        return
      }
      showToast('Falha ao salvar a revisão do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canGoPrev = currentIndex > 0
  const canGoNext = currentIndex >= 0 && currentIndex < totalItems - 1
  const isGranite = item?.source === 'granite'
  const pendencies = item?.review_reasons?.length ? item.review_reasons : ['Pendente de revisão']

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      className="app-drawer"
      title={item ? (isGranite ? `Vincular cliente — Granito ${item.bl_number}` : `Revisar B/L ${item.id}`) : 'Revisar'}
    >
      {item ? (
        <div className="grid gap-5">
          {totalItems > 1 && currentIndex >= 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => canGoPrev && onNavigate(siblingIds[currentIndex - 1])}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                <ChevronLeft size={15} />
                Anterior
              </button>
              <span className="text-xs text-slate-500">
                {currentIndex + 1} de {totalItems}
              </span>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => canGoNext && onNavigate(siblingIds[currentIndex + 1])}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                Próximo
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}

          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} />
              Pendências a resolver
            </div>
            <div className="flex flex-wrap gap-2">
              {pendencies.map((reason) => (
                <Badge key={reason} tone="yellow">
                  {reason}
                </Badge>
              ))}
            </div>
          </div>

          {!isGranite ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Shipper">
                  <Input value={shipper} onChange={(event) => setShipper(event.target.value)} />
                </Field>
                <Field label="Consignatário">
                  <Input value={consignee} onChange={(event) => setConsignee(event.target.value)} />
                </Field>
                <Field label="POL">
                  <Input value={pol} onChange={(event) => setPol(event.target.value)} />
                </Field>
                <Field label="POD">
                  <Input value={pod} onChange={(event) => setPod(event.target.value)} />
                </Field>
                <Field label="Peso total (kg)">
                  <Input type="number" value={totalWeightKg} onChange={(event) => setTotalWeightKg(event.target.value)} />
                </Field>
                <Field label="CBM total">
                  <Input type="number" value={totalCbm} onChange={(event) => setTotalCbm(event.target.value)} />
                </Field>
              </div>
              <Field label="Notas da revisão">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </>
          ) : null}

          {isGranite ? <Card className="grid gap-4 bg-[#0d1117]">
            {item.source === 'granite' && item.suggested_customer?.name ? (
              <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-100">
                Sugestao por nome — confirme o documento antes de vincular: <strong>{item.suggested_customer.name}</strong>{' '}
                ({formatCnpj(item.suggested_customer.cnpj_cpf)})
              </div>
            ) : null}
            <div className="font-semibold text-white">Vinculação de cliente</div>
            <Field label="Buscar cliente por nome ou CNPJ">
              <div className="relative">
                <Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Digite ao menos 2 caracteres" />
                <Search className="pointer-events-none absolute right-3 top-2.5 text-slate-500" size={16} />
              </div>
            </Field>
            {customerLookup.data?.length ? (
              <div className="grid gap-2">
                {customerLookup.data.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selectedCustomerId === customer.id
                        ? 'border-[#1f6feb] bg-[#1f6feb]/15 text-white'
                        : 'border-[#30363d] bg-[#161b22] text-slate-300 hover:bg-[#21262d]'
                    }`}
                    onClick={() => {
                      setSelectedCustomerId(customer.id)
                      setSelectedCustomerDisplay(`${customer.name} (${formatCnpj(customer.cnpj_cpf)})`)
                      setCustomerSearch(`${customer.name} ${formatCnpj(customer.cnpj_cpf)}`)
                    }}
                  >
                    <div className="font-semibold">{customer.name}</div>
                    <div className="text-xs text-slate-400">{formatCnpj(customer.cnpj_cpf)}</div>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedCustomerId ? (
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                <div>Cliente selecionado para vinculação.</div>
                <div className="mt-1">{item.customer ? `${item.customer.name} (${formatCnpj(item.customer.cnpj_cpf)})` : selectedCustomerDisplay ?? 'Cliente'}.</div>
              </div>
            ) : null}

          </Card> : (
            <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
              <div className="font-semibold text-white">Cliente definido pelo grupo</div>
              <div className="mt-1">{item.customer ? `${item.customer.name} (${formatCnpj(item.customer.cnpj_cpf)})` : 'O cadastro e o vínculo são tratados no cartão do grupo.'}</div>
            </div>
          )}

          <Field label="Justificativa (opcional)">
            <Textarea
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Se vazia, registra 'Revisão manual' no histórico."
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Marcar como revisado
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
