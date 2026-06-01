import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useCustomerLookup } from '../hooks/useCustomers'
import { useReviewQueue, type ReviewQueueItem } from '../hooks/useReview'
import { extractErrorText, needsCeMercante, needsCustomerLink, needsWeightFix } from './revisaoHelpers'
import { formatCnpjCpf, onlyDigits } from '../lib/utils'
import { createCustomer } from '../services/customers'
import { calculateBlLocalCharges } from '../services/charges/chargeOperationsService'
import { logOperationalEvent } from '../services/operationalEvents'
import { queryKeys } from '../services/queryKeys'
import { applyInlineBlReviewFix, ConcurrentEditError, saveBlReview, saveGraniteBlReview } from '../services/review'
import { supabase } from '../services/supabase'

type RecalcNotice = { id: string; label: string; source: 'bl' | 'granite' }

export function Revisao() {
  const { data, isLoading, error } = useReviewQueue()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')
  const [reasonFilter, setReasonFilter] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [batchJustification, setBatchJustification] = useState('')
  const [batchSaving, setBatchSaving] = useState(false)
  const [savingInlineId, setSavingInlineId] = useState<string | null>(null)
  const [recalcQueue, setRecalcQueue] = useState<RecalcNotice[]>([])
  const [recalcingId, setRecalcingId] = useState<string | null>(null)

  async function invalidateReviewCaches(blId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
      queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
      queryClient.invalidateQueries({ queryKey: ['customers'] }),
      queryClient.invalidateQueries({ queryKey: ['op-count'] }),
    ])
  }

  // Apos resolver a revisao, se as taxas locais continuam pendentes de recalculo
  // (ou o granito ainda nao foi faturado), avisa no mesmo contexto.
  function evaluateRecalcNotice(item: ReviewQueueItem) {
    if (item.source === 'bl') {
      if (item.charge_status === 'review_required') {
        addRecalcNotice({ id: item.id, label: item.id, source: 'bl' })
      }
      return
    }
    const blocking = !['ready_for_billing', 'invoiced'].includes(item.charge_status ?? '')
    if (blocking) {
      addRecalcNotice({ id: item.id, label: item.bl_number, source: 'granite' })
    }
  }

  function addRecalcNotice(notice: RecalcNotice) {
    setRecalcQueue((current) => (current.some((n) => n.id === notice.id) ? current : [...current, notice]))
  }

  function dismissRecalcNotice(id: string) {
    setRecalcQueue((current) => current.filter((n) => n.id !== id))
  }

  async function handleInlineError(error: unknown) {
    if (error instanceof ConcurrentEditError) {
      await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      showToast('Este B/L foi alterado por outro usuário. A fila foi recarregada.', 'error')
      return
    }
    showToast('Falha ao salvar a correção inline.', 'error')
  }

  async function handleInlineCustomer(item: ReviewQueueItem, customerId: number) {
    if (!user) return
    setSavingInlineId(item.id)
    try {
      if (item.source === 'granite') {
        await saveGraniteBlReview({ graniteBlId: item.id, clientId: customerId, changedBy: user.id })
      } else {
        await applyInlineBlReviewFix({
          blId: item.id,
          field: 'customer_id',
          value: customerId,
          previousValue: item.customer_id ?? null,
          changedBy: user.id,
          expectedUpdatedAt: item.updated_at ?? null,
        })
      }
      await invalidateReviewCaches(item.id)
      evaluateRecalcNotice(item)
      showToast('Cliente vinculado.', 'success')
    } catch (err) {
      await handleInlineError(err)
    } finally {
      setSavingInlineId(null)
    }
  }

  async function handleInlineField(item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', rawValue: string) {
    if (!user || item.source !== 'bl') return
    let value: string | number
    if (field === 'bb_weight_ton') {
      const parsed = Number(rawValue)
      if (!rawValue.trim() || !Number.isFinite(parsed) || parsed <= 0) {
        showToast('Informe um peso válido em toneladas.', 'error')
        return
      }
      value = parsed
    } else {
      if (!rawValue.trim()) {
        showToast('Informe o CE Mercante.', 'error')
        return
      }
      value = rawValue.trim()
    }

    setSavingInlineId(item.id)
    try {
      await applyInlineBlReviewFix({
        blId: item.id,
        field,
        value,
        previousValue: (item[field] as string | number | null) ?? null,
        changedBy: user.id,
        expectedUpdatedAt: item.updated_at ?? null,
      })
      await invalidateReviewCaches(item.id)
      evaluateRecalcNotice(item)
      showToast('Pendência atualizada.', 'success')
    } catch (err) {
      await handleInlineError(err)
    } finally {
      setSavingInlineId(null)
    }
  }

  async function handleRecalc(notice: RecalcNotice) {
    setRecalcingId(notice.id)
    try {
      const result = await calculateBlLocalCharges(notice.id, { actorId: user?.id ?? null, recalculate: true })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])
      if (result.status === 'review_required') {
        showToast('Recálculo concluído, mas ainda há pendências de revisão nas taxas locais.', 'info')
      } else {
        dismissRecalcNotice(notice.id)
        showToast('Taxas locais recalculadas.', 'success')
      }
    } catch {
      showToast('Falha ao recalcular as taxas locais.', 'error')
    } finally {
      setRecalcingId(null)
    }
  }

  const filteredData = useMemo(() => {
    if (!data) return []
    let result = data
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      result = result.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          (item.consignee ?? '').toLowerCase().includes(q) ||
          (item.shipper ?? '').toLowerCase().includes(q),
      )
    }
    if (reasonFilter) {
      result = result.filter((item) => item.review_reasons?.includes(reasonFilter))
    }
    return result
  }, [data, searchText, reasonFilter])

  const allReasons = useMemo(() => {
    if (!data) return []
    const reasons = new Set<string>()
    for (const item of data) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons].sort()
  }, [data])

  const selected = selectedIndex !== null ? (filteredData[selectedIndex] ?? null) : null

  function openItem(index: number) {
    setSelectedIndex(index)
  }

  function handleClose() {
    setSelectedIndex(null)
  }

  function handleSaveSuccess() {
    if (selectedIndex === null) return
    if (selectedIndex < filteredData.length - 1) {
      setSelectedIndex(selectedIndex + 1)
    } else {
      setSelectedIndex(null)
    }
  }

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const checkedItems = filteredData.filter((item) => checkedIds.has(item.id))
  const checkedWithCustomer = checkedItems.filter((item) => item.customer_id != null)
  const canBatchReview = checkedItems.length > 1 && checkedItems.every((item) => item.customer_id != null)

  async function handleBatchReview() {
    if (!canBatchReview || !user || !batchJustification.trim()) {
      if (!batchJustification.trim()) showToast('Informe a justificativa para a revisao em lote.', 'error')
      return
    }
    setBatchSaving(true)
    let successCount = 0
    for (const item of checkedItems) {
      try {
        if (item.source === 'granite') {
          await saveGraniteBlReview({ graniteBlId: item.id, clientId: item.customer_id!, changedBy: user.id })
        } else {
          await saveBlReview({
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
              shipper: item.shipper,
              consignee: item.consignee,
              pol: item.pol,
              pod: item.pod,
              total_weight_kg: item.total_weight_kg ?? null,
              total_cbm: item.total_cbm ?? null,
              notes: item.notes,
            },
            customerId: item.customer_id ?? null,
            previousCustomerId: item.customer_id ?? null,
            changedBy: user.id,
            justification: batchJustification,
            expectedUpdatedAt: item.updated_at ?? null,
          })
        }
        successCount++
      } catch {
        // continue with remaining items
      }
    }
    setBatchSaving(false)
    setCheckedIds(new Set())
    setBatchJustification('')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
      queryClient.invalidateQueries({ queryKey: ['op-count'] }),
    ])
    showToast(`${successCount} de ${checkedItems.length} B/Ls revisados em lote.`, 'success')
  }

  return (
    <>
      <PageHeader
        title="Revisao Manual"
        description="Fila de B/Ls com pendencias de importação que exigem validação humana."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar B/L, consignatario ou shipper..."
            className="pl-9 pr-9"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted-soft)]" size={15} />
          {searchText ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] transition-colors hover:text-[var(--app-text)]"
              onClick={() => setSearchText('')}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {allReasons.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {allReasons.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setReasonFilter(reasonFilter === reason ? null : reason)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  reasonFilter === reason
                    ? 'border-[var(--app-gold)] bg-[var(--app-gold-soft)] text-[var(--app-gold)]'
                    : 'border-[var(--app-border)] text-[var(--app-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)]'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
        ) : null}

        {data && data.length > 0 ? (
          <span className="ml-auto text-xs text-slate-500">
            {filteredData.length} de {data.length} B/L{data.length !== 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      {checkedItems.length > 1 && (
        <div className="mb-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
          <div className="mb-2 text-sm font-medium text-blue-200">
            {checkedItems.length} B/Ls selecionados
            {checkedItems.length !== checkedWithCustomer.length && (
              <span className="ml-1 text-amber-300">
                ({checkedItems.length - checkedWithCustomer.length} sem cliente — serão ignorados)
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input
              className="flex-1 min-w-[260px] rounded border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-sm text-white placeholder-slate-500"
              placeholder="Justificativa da revisao em lote (obrigatório)"
              value={batchJustification}
              onChange={(e) => setBatchJustification(e.target.value)}
            />
            <Button
              loading={batchSaving}
              disabled={!canBatchReview}
              onClick={handleBatchReview}
            >
              Revisar selecionados ({checkedWithCustomer.length})
            </Button>
            <Button variant="ghost" onClick={() => setCheckedIds(new Set())}>Limpar</Button>
          </div>
        </div>
      )}

      {recalcQueue.length > 0 ? (
        <div className="mb-3 space-y-2">
          {recalcQueue.map((notice) => (
            <div
              key={notice.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} />
                <span>
                  {notice.source === 'granite'
                    ? `Granito ${notice.label}: o cálculo de taxas precisa ser refeito em /granito.`
                    : `${notice.label}: taxas locais ainda pendentes de recálculo.`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {notice.source === 'bl' ? (
                  <Button
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    loading={recalcingId === notice.id}
                    onClick={() => handleRecalc(notice)}
                  >
                    Recalcular
                  </Button>
                ) : (
                  <Link className="app-table__action" to="/granito">
                    Abrir Granito
                  </Link>
                )}
                <button
                  type="button"
                  className="text-amber-300 hover:text-amber-100"
                  onClick={() => dismissRecalcNotice(notice.id)}
                  aria-label="Dispensar aviso"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar a fila de revisao." /> : null}

        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
            <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 w-8"></th>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="px-4 py-3">Pendencias</th>
                <th scope="col" className="px-4 py-3">Consignatario</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Carregando fila de revisao...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !filteredData.length ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      title={data?.length ? 'Nenhum B/L corresponde ao filtro.' : 'Nenhum B/L pendente de revisao.'}
                      description={data?.length ? 'Limpe os filtros para ver todos os pendentes.' : undefined}
                    />
                  </td>
                </tr>
              ) : null}
              {filteredData.map((item, index) => (
                <tr key={item.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#30363d] accent-blue-500"
                      checked={checkedIds.has(item.id)}
                      onChange={() => toggleCheck(item.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">
                    <div className="flex items-center gap-2">
                      {item.source === 'granite' ? <Badge tone="blue">Granito</Badge> : null}
                      {item.source === 'granite' ? item.bl_number : item.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="flex flex-wrap gap-2">
                        {(item.review_reasons?.length ? item.review_reasons : ['Pendente de revisao']).map((reason) => (
                          <Badge key={reason} tone="yellow">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                      {item.source === 'bl' && needsCeMercante(item) ? (
                        <InlineFieldEditor
                          type="text"
                          placeholder="CE Mercante"
                          initial={item.ce_mercante ?? ''}
                          saving={savingInlineId === item.id}
                          onSave={(value) => handleInlineField(item, 'ce_mercante', value)}
                        />
                      ) : null}
                      {item.source === 'bl' && needsWeightFix(item) ? (
                        <InlineFieldEditor
                          type="number"
                          placeholder="Peso BB (ton)"
                          initial={item.bb_weight_ton != null ? String(item.bb_weight_ton) : ''}
                          saving={savingInlineId === item.id}
                          onSave={(value) => handleInlineField(item, 'bb_weight_ton', value)}
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{item.consignee ?? item.shipper ?? '-'}</td>
                  <td className="px-4 py-3">
                    {needsCustomerLink(item) ? (
                      <InlineCustomerPicker
                        saving={savingInlineId === item.id}
                        onSelect={(customerId) => handleInlineCustomer(item, customerId)}
                      />
                    ) : (
                      (item.customer?.name ?? 'Não vinculado')
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.voyage?.vessel?.name ?? '-'} / {item.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openItem(index)}>
                        Corrigir
                      </Button>
                      {item.source === 'bl' ? (
                        <Link className="app-table__action" to={`/manifestos/${item.id}`}>
                          Abrir B/L
                        </Link>
                      ) : (
                        <Link className="app-table__action" to={`/granito`}>
                          Abrir Granito
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ReviewModal
        item={selected}
        currentIndex={selectedIndex}
        totalItems={filteredData.length}
        onClose={handleClose}
        onSaveSuccess={handleSaveSuccess}
        onReviewSaved={evaluateRecalcNotice}
        onNavigate={(index) => setSelectedIndex(index)}
      />
    </>
  )
}

function ReviewModal({
  item,
  currentIndex,
  totalItems,
  onClose,
  onSaveSuccess,
  onReviewSaved,
  onNavigate,
}: {
  item: ReviewQueueItem | null
  currentIndex: number | null
  totalItems: number
  onClose: () => void
  onSaveSuccess: () => void
  onReviewSaved: (item: ReviewQueueItem) => void
  onNavigate: (index: number) => void
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
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerCnpj, setNewCustomerCnpj] = useState('')
  const [newCustomerEmail, setNewCustomerEmail] = useState('')
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const customerLookup = useCustomerLookup(customerSearch)

  useEffect(() => {
    if (!item) return
    setShipper(item.shipper ?? '')
    setConsignee(item.consignee ?? '')
    setPol(item.pol ?? '')
    setPod(item.pod ?? '')
    setTotalWeightKg(item.total_weight_kg ? String(item.total_weight_kg) : '')
    setTotalCbm(item.total_cbm ? String(item.total_cbm) : '')
    setNotes(item.notes ?? '')
    setSelectedCustomerId(item.customer_id ?? null)
    setCustomerSearch('')
    const manifestName = item.source === 'bl' ? (item.manifest_customer_name ?? null) : null
    const manifestCnpj = item.source === 'bl' ? (item.manifest_customer_cnpj_cpf ?? null) : null
    const manifestEmail = item.source === 'bl' ? (item.manifest_customer_email ?? null) : null
    setNewCustomerName(manifestName ?? item.consignee ?? '')
    setNewCustomerCnpj(manifestCnpj ?? '')
    setNewCustomerEmail(manifestEmail ?? '')
    setJustification('')
  }, [item])

  async function handleCreateCustomer() {
    if (!newCustomerName.trim() || !newCustomerCnpj.trim()) {
      showToast('Informe nome e CNPJ/CPF para criar o cliente.', 'error')
      return
    }
    const documentDigits = onlyDigits(newCustomerCnpj)
    if (documentDigits.length !== 11 && documentDigits.length !== 14) {
      showToast('Informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.', 'error')
      return
    }

    try {
      const contacts = newCustomerEmail.trim()
        ? [{ name: 'Contato manifesto', email: newCustomerEmail.trim(), purpose: 'financeiro' as const, is_primary: true }]
        : []
      const customer = await createCustomer({ cnpjCpf: newCustomerCnpj, name: newCustomerName, contacts })
      setSelectedCustomerId(customer.id)
      setCustomerSearch(`${customer.name} ${formatCnpjCpf(customer.cnpj_cpf)}`)
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      showToast('Cliente criado e pronto para vinculacao.', 'success')
    } catch (error) {
      const message = extractErrorText(error)
      if (message.includes('duplicate key') || message.includes('customers_cnpj_cpf_key')) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id, name, cnpj_cpf')
          .eq('cnpj_cpf', documentDigits)
          .maybeSingle()

        if (existing) {
          setSelectedCustomerId(existing.id)
          setCustomerSearch(`${existing.name} ${formatCnpjCpf(existing.cnpj_cpf)}`)
          showToast('Cliente já existia e foi selecionado para vinculação.', 'success')
          return
        }

        showToast('Este CNPJ/CPF já está cadastrado. Selecione o cliente na busca acima.', 'error')
        return
      }
      if (message.includes('permission denied') || message.includes('42501')) {
        showToast('Seu usuário não tem permissão para cadastrar cliente. Solicite acesso administrativo.', 'error')
        return
      }
      showToast(`Falha ao criar cliente. ${message ? `Motivo: ${message}` : ''}`.trim(), 'error')
    }
  }

  async function handleSave() {
    if (!item || !user) return
    if (!justification.trim()) {
      showToast('Informe a justificativa da revisao.', 'error')
      return
    }

    setSaving(true)
    try {
      if (item.source === 'granite') {
        if (!selectedCustomerId) {
          showToast('Selecione um cliente para vincular.', 'error')
          setSaving(false)
          return
        }
        await saveGraniteBlReview({ graniteBlId: item.id, clientId: selectedCustomerId, changedBy: user.id })
      } else {
        await saveBlReview({
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
          justification,
          expectedUpdatedAt: item.updated_at ?? null,
        })
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', item.id] }),
        queryClient.invalidateQueries({ queryKey: ['audit-logs', 'bl', item.id] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['op-count'] }),
      ])

      const remaining = totalItems - 1
      const isLast = currentIndex !== null && currentIndex >= totalItems - 1
      showToast(
        isLast
          ? 'B/L revisado. Fila concluida.'
          : `B/L revisado. Proximo: ${remaining - 1} restante${remaining - 1 !== 1 ? 's' : ''}.`,
        'success',
      )
      onReviewSaved(item)
      onSaveSuccess()
    } catch (error) {
      if (error instanceof ConcurrentEditError) {
        void logOperationalEvent({
          code: 'bl_review_concurrent_conflict',
          message: error.message,
          changedBy: user?.id ?? null,
          entityId: item.id,
          context: { source: 'review_modal' },
        })
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        showToast('Este B/L foi alterado por outro usuário. A fila foi recarregada.', 'error')
        return
      }
      showToast('Falha ao salvar a revisao do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canGoPrev = currentIndex !== null && currentIndex > 0
  const canGoNext = currentIndex !== null && currentIndex < totalItems - 1

  const isGranite = item?.source === 'granite'

  return (
    <Modal open={Boolean(item)} onClose={onClose} title={item ? (isGranite ? `Vincular cliente — Granito ${item.bl_number}` : `Revisar B/L ${item.id}`) : 'Revisar'}>

      {item ? (
        <div className="grid gap-5">
          {totalItems > 1 && currentIndex !== null ? (
            <div className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => canGoPrev && onNavigate(currentIndex - 1)}
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
                onClick={() => canGoNext && onNavigate(currentIndex + 1)}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
              >
                Proximo
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}

          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} />
              Pendencias detectadas
            </div>
            <div className="flex flex-wrap gap-2">
              {(item.review_reasons?.length ? item.review_reasons : ['Pendente de revisao']).map((reason) => (
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
                <Field label="Consignatario">
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
              <Field label="Notas da revisao">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </>
          ) : null}

          <Card className="grid gap-4 bg-[#0d1117]">
            <div className="font-semibold text-white">Vinculacao de cliente</div>
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
                      setCustomerSearch(`${customer.name} ${formatCnpjCpf(customer.cnpj_cpf)}`)
                    }}
                  >
                    <div className="font-semibold">{customer.name}</div>
                    <div className="text-xs text-slate-400">{formatCnpjCpf(customer.cnpj_cpf)}</div>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedCustomerId ? (
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                Cliente selecionado para vinculação.
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-[1fr_220px_1fr_auto]">
              <Field label="Novo cliente - nome">
                <Input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} />
              </Field>
              <Field label="Novo cliente - CNPJ/CPF">
                <Input value={newCustomerCnpj} onChange={(event) => setNewCustomerCnpj(event.target.value)} />
              </Field>
              <Field label="Novo cliente - e-mail">
                <Input value={newCustomerEmail} onChange={(event) => setNewCustomerEmail(event.target.value)} placeholder="(opcional)" />
              </Field>
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={handleCreateCustomer}>
                  Cadastrar cliente
                </Button>
              </div>
            </div>
          </Card>

          <Field label="Justificativa obrigatoria">
            <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required />
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

function InlineCustomerPicker({ saving, onSelect }: { saving: boolean; onSelect: (customerId: number) => void }) {
  const [search, setSearch] = useState('')
  const lookup = useCustomerLookup(search)

  return (
    <div className="relative w-56">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Vincular cliente..."
        className="py-1 text-xs"
        disabled={saving}
      />
      {lookup.data?.length ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[#30363d] bg-[#161b22] shadow-xl">
          {lookup.data.map((customer) => (
            <button
              key={customer.id}
              type="button"
              disabled={saving}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#21262d] disabled:opacity-50"
              onClick={() => onSelect(customer.id)}
            >
              <div className="font-medium text-white">{customer.name}</div>
              <div className="text-[11px] text-slate-500">{formatCnpjCpf(customer.cnpj_cpf)}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function InlineFieldEditor({
  type,
  placeholder,
  initial,
  saving,
  onSave,
}: {
  type: 'text' | 'number'
  placeholder: string
  initial: string
  saving: boolean
  onSave: (value: string) => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type={type}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="w-36 py-1 text-xs"
        disabled={saving}
      />
      <Button variant="secondary" className="px-2.5 py-1 text-xs" loading={saving} onClick={() => onSave(value)}>
        Salvar
      </Button>
    </div>
  )
}

