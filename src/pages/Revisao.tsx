import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Search, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useReviewQueue, type ReviewQueueItem } from '../hooks/useReview'
import {
  getGroupLinkedItem,
  groupReviewItems,
  needsCustomerLink,
  reviewReasonLabel,
  type ReviewGroup,
} from './revisaoHelpers'
import { extractErrorText } from '../lib/errors'
import { invalidateReviewQueueCaches } from '../components/review/reviewCaches'
import { ReviewGroupBlock } from '../components/review/ReviewGroupBlock'
import type { ReviewCustomerOnboardingInput } from '../components/review/ReviewCustomerOnboarding'
import { ReviewDrawer } from '../components/review/ReviewDrawer'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { addCustomerEmail } from '../services/customers'
import { calculateBlLocalCharges } from '../services/charges/chargeOperationsService'
import { queryKeys } from '../services/queryKeys'
import {
  applyInlineBlReviewFix,
  ConcurrentEditError,
  recomputeBlReviewGate,
  saveGraniteBlReview,
  type SaveBlReviewResult,
} from '../services/review'
import { tryAutoIssueInvoice } from '../services/reviewBillingAutomation'
import { useReviewCustomerGroup } from '../hooks/useReviewCustomerGroup'

type RecalcNotice = { id: string; label: string; source: 'bl' | 'granite' }

export function Revisao() {
  const { data, isLoading, error, graniteUnavailable } = useReviewQueue()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const reviewCustomerGroup = useReviewCustomerGroup()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [reasonFilter, setReasonFilter] = useState<string | null>(null)
  // A fila inicia recolhida; o conjunto guarda apenas os grupos que o operador abriu.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const [savingGroupKey, setSavingGroupKey] = useState<string | null>(null)
  const [savingInlineId, setSavingInlineId] = useState<string | null>(null)
  const [recalcQueue, setRecalcQueue] = useState<RecalcNotice[]>([])
  const [recalcingId, setRecalcingId] = useState<string | null>(null)

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
      const result = await applyInlineBlReviewFix({
        blId: item.id,
        field,
        value,
        previousValue: (item[field] as string | number | null) ?? null,
        changedBy: user.id,
        expectedUpdatedAt: item.updated_at ?? null,
      })
      await finishBlCorrection(item, item.customer_id ?? null, result, 'Pendência atualizada')
    } catch (err) {
      await handleInlineError(err)
    } finally {
      setSavingInlineId(null)
    }
  }

  // Centraliza o pos-correcao de um B/L comum: so tenta faturar quando o gate
  // canonico nao reporta mais pendencias; senao mantem na fila informando o que
  // ainda falta. Evita faturar B/L que o cliente nao conseguiria visualizar.
  async function finishBlCorrection(
    item: ReviewQueueItem,
    customerId: number | null,
    result: SaveBlReviewResult,
    actionLabel: string,
  ) {
    let invoiced = false
    let blockedMessage: string | null = null

    if (result.resolved && customerId) {
      const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId, actorId: user?.id ?? null })
      invoiced = autoInvoice.status === 'invoiced'
      if (autoInvoice.status === 'blocked') blockedMessage = autoInvoice.message
    }

    await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true })

    if (invoiced) {
      dismissRecalcNotice(item.id)
      showToast(`${actionLabel} e fatura emitida automaticamente.`, 'success')
      return
    }
    if (!result.resolved) {
      showToast(`${actionLabel}. Ainda falta: ${result.pendencias.join(', ')}.`, 'info')
      return
    }
    if (blockedMessage) {
      addRecalcNotice({ id: item.id, label: item.id, source: 'bl' })
      showToast(`${actionLabel}, mas o faturamento automático não concluiu: ${blockedMessage}`, 'info')
      return
    }
    showToast(`${actionLabel}. B/L pronto para faturamento.`, 'success')
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
    } catch (error) {
      const message = extractErrorText(error)
      showToast(
        message.toLowerCase().includes('ja foi faturado')
          ? `Fatura já emitida para ${notice.id} — cancele e reemita para corrigir.`
          : 'Falha ao recalcular as taxas locais.',
        'error',
      )
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
          (item.shipper ?? '').toLowerCase().includes(q) ||
          (item.customer?.name ?? '').toLowerCase().includes(q),
      )
    }
    if (reasonFilter) {
      result = result.filter((item) => item.review_reasons?.includes(reasonFilter))
    }
    return result
  }, [data, searchText, reasonFilter])

  const groups = useMemo(() => groupReviewItems(filteredData), [filteredData])

  const visibleExpandedGroups = expandedGroups

  const allReasons = useMemo(() => {
    if (!data) return []
    const reasons = new Set<string>()
    for (const item of data) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons].sort()
  }, [data])

  const selected = selectedId ? (filteredData.find((item) => item.id === selectedId) ?? null) : null
  const selectedGroup = selected ? groups.find((group) => group.items.some((item) => item.id === selected.id)) ?? null : null
  const currentIndex = selectedId ? filteredData.findIndex((item) => item.id === selectedId) : -1
  const activeFilterCount = (searchText.trim() ? 1 : 0) + (reasonFilter ? 1 : 0)
  const filterDescription = describeActiveFilters([
    { label: 'Busca', value: searchText },
    { label: 'Motivo', value: reasonFilter ? reviewReasonLabel(reasonFilter) : null },
  ])
  const emptyState = describeEmptyState({
    entitySingular: 'B/L pendente',
    entityPlural: 'B/Ls pendentes',
    hasActiveFilters: activeFilterCount > 0,
    emptyWithoutFilters: 'Nenhum B/L pendente de revisão.',
    emptyWithFilters: 'Nenhum B/L corresponde ao filtro.',
  })

  function handleClose() {
    setSelectedId(null)
  }

  // Navegacao por id: calcula o proximo ANTES do refetch remover o item
  // resolvido, evitando pular o item seguinte (bug do indice posicional).
  function handleSaved(resolved: boolean) {
    if (!resolved || currentIndex < 0) return
    const nextId = filteredData[currentIndex + 1]?.id ?? null
    setSelectedId(nextId)
  }

  function toggleGroupCollapsed(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Vincula um cliente a todos os B/Ls do grupo que ainda nao tem cliente.
  // Resolve "o mesmo problema do mesmo cliente" de uma vez (gargalo de volume).
  async function handleGroupLinkCustomer(group: ReviewGroup, customerId: number) {
    if (!user) return
    const targets = group.items.filter(needsCustomerLink)
    if (targets.length === 0) return
    setSavingGroupKey(group.key)
    let successCount = 0
    let errorCount = 0
    let invoiceCount = 0
    const pendingBls: string[] = []
    for (const item of targets) {
      try {
        if (item.source === 'granite') {
          await saveGraniteBlReview({ graniteBlId: item.id, clientId: customerId, changedBy: user.id })
          evaluateRecalcNotice(item)
        } else {
          const result = await applyInlineBlReviewFix({
            blId: item.id,
            field: 'customer_id',
            value: customerId,
            previousValue: item.customer_id ?? null,
            changedBy: user.id,
            expectedUpdatedAt: item.updated_at ?? null,
          })
          if (result.resolved) {
            const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId, actorId: user.id })
            if (autoInvoice.status === 'invoiced') invoiceCount++
          } else {
            pendingBls.push(item.id)
          }
        }
        successCount++
      } catch {
        errorCount++
      }
    }
    setSavingGroupKey(null)
    await invalidateReviewQueueCaches(queryClient, {
      includeCustomers: true,
      includeCharges: true,
      includeInvoices: true,
    })
    const invoiceSummary = invoiceCount > 0 ? ` ${invoiceCount} fatura(s) emitida(s).` : ''
    const pendingSummary = pendingBls.length > 0 ? ` ${pendingBls.length} ainda com pendências (e-mail/portal/peso).` : ''
    showToast(
      errorCount
        ? `${successCount} de ${targets.length} B/Ls vinculados; ${errorCount} falharam.${invoiceSummary}${pendingSummary}`
        : `${successCount} B/L(s) vinculados a ${group.displayName}.${invoiceSummary}${pendingSummary}`,
      errorCount ? 'error' : 'success',
    )
  }

  async function handleGroupOnboard(group: ReviewGroup, input: ReviewCustomerOnboardingInput) {
    if (!user) return
    const blIds = group.items.filter((item) => item.source === 'bl').map((item) => item.id)
    if (!blIds.length || (group.identityKind === 'conflict' && group.items.length !== 1)) {
      showToast('Nenhum B/L elegível para o cadastro deste grupo.', 'error')
      return
    }
    setSavingGroupKey(group.key)
    try {
      const result = await reviewCustomerGroup.mutateAsync({
        blIds,
        customerId: input.customerId,
        cnpjCpf: input.cnpjCpf,
        name: input.name,
        email: input.email,
        groupName: group.displayName,
        changedBy: user.id,
        sendPortalInvite: input.sendPortalInvite,
      })
      let invoiceCount = 0
      for (const bl of result.onboarding.bls) {
        if (!bl.resolved || !bl.blId) continue
        try {
          const autoInvoice = await tryAutoIssueInvoice({
            blId: bl.blId,
            customerId: result.onboarding.customer.id,
            actorId: user.id,
          })
          if (autoInvoice.status === 'invoiced') invoiceCount++
        } catch {
          addRecalcNotice({ id: bl.blId, label: bl.blId, source: 'bl' })
        }
      }

      const graniteTargets = group.items.filter((item) => item.source === 'granite' && needsCustomerLink(item))
      let graniteLinkedCount = 0
      for (const item of graniteTargets) {
        try {
          await saveGraniteBlReview({ graniteBlId: item.id, clientId: result.onboarding.customer.id, changedBy: user.id })
          graniteLinkedCount++
          evaluateRecalcNotice(item)
        } catch {
          // A falha pontual no Granito não desfaz o onboarding transacional dos B/Ls.
        }
      }

      const pendingCount = result.onboarding.bls.filter((bl) => !bl.resolved).length
      const inviteMessage = result.portalInvite === 'failed' ? ' Não foi possível iniciar o convite do Portal; o cadastro foi concluído.' : ''
      const invoiceMessage = invoiceCount > 0 ? ` ${invoiceCount} fatura(s) emitida(s).` : ''
      const graniteMessage = graniteLinkedCount > 0 ? ` ${graniteLinkedCount} item(ns) de Granito vinculado(s).` : ''
      showToast(`${blIds.length - pendingCount} B/L(s) vinculados; ${pendingCount} ainda com pendências.${graniteMessage}${invoiceMessage}${inviteMessage}`, result.portalInvite === 'failed' ? 'info' : 'success')
      await invalidateReviewQueueCaches(queryClient, { includeCustomers: true, includeCharges: true, includeInvoices: true })
    } catch (err) {
      if (err instanceof ConcurrentEditError) {
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        showToast('Este grupo foi alterado por outro usuário. A fila foi recarregada.', 'error')
      } else {
        showToast(`Falha ao concluir o onboarding do cliente. ${extractErrorText(err)}`.trim(), 'error')
      }
    } finally {
      setSavingGroupKey(null)
    }
  }

  // Apos uma correcao de nivel-cliente (e-mail/portal), reavalia o gate de todos
  // os B/Ls ja vinculados do grupo: os que zerarem saem da fila e, se elegiveis,
  // sao faturados. O updated_at do B/L nao muda (alteramos tabelas do cliente),
  // entao o lock otimista continua valido.
  async function refreshGroupGate(group: ReviewGroup) {
    if (!user) return
    let invoiceCount = 0
    for (const item of group.items) {
      if (item.source !== 'bl' || item.customer_id == null) continue
      try {
        const result = await recomputeBlReviewGate({
          blId: item.id,
          expectedUpdatedAt: item.updated_at ?? null,
          changedBy: user.id,
        })
        if (result.resolved && item.customer_id) {
          const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId: item.customer_id, actorId: user.id })
          if (autoInvoice.status === 'invoiced') invoiceCount++
        }
      } catch {
        // Conflito de concorrencia ou falha pontual: a invalidacao abaixo recarrega o estado real.
      }
    }
    await invalidateReviewQueueCaches(queryClient, {
      includeGranite: false,
      includeCharges: true,
      includeInvoices: true,
    })
    return invoiceCount
  }

  async function handleGroupAddEmail(group: ReviewGroup, email: string) {
    if (!user) return
    const linked = getGroupLinkedItem(group)
    const customerId = linked?.customer?.id
    if (!customerId) return
    if (!email.trim() || !email.includes('@')) {
      showToast('Informe um e-mail válido.', 'error')
      return
    }
    setSavingGroupKey(group.key)
    try {
      await addCustomerEmail(customerId, email)
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      const invoiceCount = await refreshGroupGate(group)
      showToast(
        `E-mail vinculado a ${group.displayName}.${invoiceCount ? ` ${invoiceCount} fatura(s) emitida(s).` : ''}`,
        'success',
      )
    } catch (err) {
      showToast(`Falha ao salvar e-mail. ${extractErrorText(err)}`.trim(), 'error')
    } finally {
      setSavingGroupKey(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Revisão Manual"
        description="Fila de B/Ls com pendências de importação que exigem validação humana, agrupada por cliente."
      />

      <div className="review-toolbar mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar B/L, cliente, consignatário..."
            className="app-review-search__input"
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
          <Select
            aria-label="Filtrar por inconsistência"
            value={reasonFilter ?? ''}
            onChange={(event) => setReasonFilter(event.target.value || null)}
            className="review-reason-filter w-full sm:w-72"
          >
            <option value="">Todas as inconsistências</option>
            {allReasons.map((reason) => (
              <option
                key={reason}
                value={reason}
              >
                {reviewReasonLabel(reason)}
              </option>
            ))}
          </Select>
        ) : null}

        {data && data.length > 0 ? (
          <span className="review-toolbar__count ml-auto text-xs">
            {formatResultCount(groups.length, 'cliente', 'clientes')} · {formatResultCount(filteredData.length, 'B/L', 'B/Ls')} de {data.length}
          </span>
        ) : null}
      </div>

      {recalcQueue.length > 0 ? (
        <div className="mb-3 space-y-2">
          {recalcQueue.map((notice) => (
            <div
              key={notice.id}
              className="review-recalc-notice flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-sm"
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
                  className="review-recalc-notice__dismiss"
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

      <Card className="review-queue-card overflow-hidden p-0">
        <div className="review-queue-card__summary flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-[var(--app-text-strong)]">{formatResultCount(filteredData.length, 'pendência retornada', 'pendências retornadas')}</span>
          <span className="text-xs text-[var(--app-muted)]">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar a fila de revisão." /> : null}
        {graniteUnavailable ? (
          <InlineError message="Não foi possível carregar os B/Ls de granito — a fila abaixo pode estar incompleta. Recarregue a página ou contate o suporte." />
        ) : null}

        {isLoading ? (
          <div className="px-4 py-8 text-center text-[var(--app-muted)]">Carregando fila de revisão...</div>
        ) : null}
        {!isLoading && !filteredData.length ? (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        ) : null}

        <div className="review-queue-card__groups divide-y">
          {groups.map((group) => (
            <ReviewGroupBlock
              key={group.key}
              group={group}
              collapsed={!visibleExpandedGroups.has(group.key)}
              savingGroup={savingGroupKey === group.key}
              savingInlineId={savingInlineId}
              onToggle={() => toggleGroupCollapsed(group.key)}
              onGroupLink={(customerId) => handleGroupLinkCustomer(group, customerId)}
              onGroupAddEmail={(email) => handleGroupAddEmail(group, email)}
              onGroupOnboard={(input) => void handleGroupOnboard(group, input)}
              onCorrect={(id) => setSelectedId(id)}
              onInlineField={handleInlineField}
            />
          ))}
        </div>
      </Card>

      <ReviewDrawer
        item={selected}
        currentIndex={currentIndex}
        totalItems={filteredData.length}
        onClose={handleClose}
        onSaved={handleSaved}
        onReviewSaved={evaluateRecalcNotice}
        onNavigate={(id) => setSelectedId(id)}
        siblingIds={filteredData.map((item) => item.id)}
        allowCustomerLink={selectedGroup?.identityKind === 'conflict'}
      />

    </>
  )
}
