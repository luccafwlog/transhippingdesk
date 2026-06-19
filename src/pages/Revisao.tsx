import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Textarea } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { useCustomerLookup } from '../hooks/useCustomers'
import { useReviewQueue, type ReviewQueueItem } from '../hooks/useReview'
import {
  extractErrorText,
  getGroupLinkedItem,
  groupNeedsEmail,
  groupNeedsPortal,
  groupReviewItems,
  needsCeMercante,
  needsCustomerLink,
  needsWeightFix,
  type ReviewGroup,
} from './revisaoHelpers'
import { InlineCustomerPicker, InlineFieldEditor } from '../components/shared/ReviewInlineEditors'
import { describeActiveFilters, describeEmptyState, formatResultCount } from '../lib/operationalState'
import { formatCnpjCpf, onlyDigits } from '../lib/utils'
import { addCustomerEmail, createCustomer, provisionPortalForCustomer } from '../services/customers'
import { calculateBlLocalCharges } from '../services/charges/chargeOperationsService'
import { logOperationalEvent } from '../services/operationalEvents'
import { queryKeys } from '../services/queryKeys'
import {
  applyInlineBlReviewFix,
  ConcurrentEditError,
  recomputeBlReviewGate,
  saveBlReview,
  saveGraniteBlReview,
  type SaveBlReviewResult,
} from '../services/review'
import { tryAutoIssueInvoice } from '../services/reviewBillingAutomation'
import { supabase } from '../services/supabase'

type RecalcNotice = { id: string; label: string; source: 'bl' | 'granite' }
type ProvisionedCredential = { name: string; email: string; password: string }

export function Revisao() {
  const { data, isLoading, error, graniteUnavailable } = useReviewQueue()
  const queryClient = useQueryClient()
  const { user, isAdmin } = useAuth()
  const { showToast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [reasonFilter, setReasonFilter] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [savingGroupKey, setSavingGroupKey] = useState<string | null>(null)
  const [provisionedCredential, setProvisionedCredential] = useState<ProvisionedCredential | null>(null)
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

    await invalidateReviewCaches(item.id)

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

  const allReasons = useMemo(() => {
    if (!data) return []
    const reasons = new Set<string>()
    for (const item of data) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons].sort()
  }, [data])

  const selected = selectedId ? (filteredData.find((item) => item.id === selectedId) ?? null) : null
  const currentIndex = selectedId ? filteredData.findIndex((item) => item.id === selectedId) : -1
  const activeFilterCount = (searchText.trim() ? 1 : 0) + (reasonFilter ? 1 : 0)
  const filterDescription = describeActiveFilters([
    { label: 'Busca', value: searchText },
    { label: 'Motivo', value: reasonFilter },
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
    setCollapsedGroups((current) => {
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
      queryClient.invalidateQueries({ queryKey: ['customers'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
      queryClient.invalidateQueries({ queryKey: ['op-count'] }),
    ])
    const invoiceSummary = invoiceCount > 0 ? ` ${invoiceCount} fatura(s) emitida(s).` : ''
    const pendingSummary = pendingBls.length > 0 ? ` ${pendingBls.length} ainda com pendências (e-mail/portal/peso).` : ''
    showToast(
      errorCount
        ? `${successCount} de ${targets.length} B/Ls vinculados; ${errorCount} falharam.${invoiceSummary}${pendingSummary}`
        : `${successCount} B/L(s) vinculados a ${group.displayName}.${invoiceSummary}${pendingSummary}`,
      errorCount ? 'error' : 'success',
    )
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
      queryClient.invalidateQueries({ queryKey: ['op-count'] }),
    ])
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

  async function handleGroupProvisionPortal(group: ReviewGroup) {
    if (!user || !isAdmin) return
    const linked = getGroupLinkedItem(group)
    const customerId = linked?.customer?.id
    if (!customerId) return
    const email = linked?.customer?.customer_contacts?.find((contact) => (contact.email ?? '').trim())?.email?.trim()
    if (!email) {
      showToast('Adicione um e-mail ao cliente antes de provisionar o portal.', 'error')
      return
    }
    setSavingGroupKey(group.key)
    try {
      const { password } = await provisionPortalForCustomer({
        customerId,
        portalEmail: email,
        loginCnpj: group.cnpj,
        actorId: user.id,
      })
      await queryClient.invalidateQueries({ queryKey: ['customer-portal-account', customerId] })
      const invoiceCount = await refreshGroupGate(group)
      setProvisionedCredential({ name: group.displayName, email, password })
      showToast(
        `Portal provisionado para ${group.displayName}.${invoiceCount ? ` ${invoiceCount} fatura(s) emitida(s).` : ''}`,
        'success',
      )
    } catch (err) {
      showToast(`Falha ao provisionar o portal. ${extractErrorText(err)}`.trim(), 'error')
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
          <div className="flex flex-wrap gap-1.5">
            {allReasons.map((reason) => (
              <button
                key={reason}
                type="button"
                aria-pressed={reasonFilter === reason}
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
            {formatResultCount(groups.length, 'cliente', 'clientes')} · {formatResultCount(filteredData.length, 'B/L', 'B/Ls')} de {data.length}
          </span>
        ) : null}
      </div>

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
        <div className="flex flex-col gap-1 border-b border-[#30363d] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-semibold text-white">{formatResultCount(filteredData.length, 'pendência retornada', 'pendências retornadas')}</span>
          <span className="text-xs text-slate-400">{filterDescription}</span>
        </div>
        {error ? <InlineError message="Erro ao carregar a fila de revisão." /> : null}
        {graniteUnavailable ? (
          <InlineError message="Não foi possível carregar os B/Ls de granito — a fila abaixo pode estar incompleta. Recarregue a página ou contate o suporte." />
        ) : null}

        {isLoading ? (
          <div className="px-4 py-8 text-center text-slate-400">Carregando fila de revisão...</div>
        ) : null}
        {!isLoading && !filteredData.length ? (
          <EmptyState title={emptyState.title} description={emptyState.description} />
        ) : null}

        <div className="divide-y divide-[#30363d]">
          {groups.map((group) => (
            <ReviewGroupBlock
              key={group.key}
              group={group}
              collapsed={collapsedGroups.has(group.key)}
              savingGroup={savingGroupKey === group.key}
              savingInlineId={savingInlineId}
              isAdmin={isAdmin}
              onToggle={() => toggleGroupCollapsed(group.key)}
              onGroupLink={(customerId) => handleGroupLinkCustomer(group, customerId)}
              onGroupAddEmail={(email) => handleGroupAddEmail(group, email)}
              onGroupProvisionPortal={() => handleGroupProvisionPortal(group)}
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
      />

      <Modal
        open={Boolean(provisionedCredential)}
        onClose={() => setProvisionedCredential(null)}
        title="Acesso ao portal provisionado"
      >
        {provisionedCredential ? (
          <div className="grid gap-4">
            <p className="text-sm text-slate-300">
              Credencial gerada para <span className="font-semibold text-white">{provisionedCredential.name}</span>.
              Copie e repasse ao cliente — <span className="text-amber-300">ela não será exibida novamente</span>.
            </p>
            <div className="grid gap-2">
              <CredentialRow label="Login (e-mail)" value={provisionedCredential.email} />
              <CredentialRow label="Senha" value={provisionedCredential.password} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setProvisionedCredential(null)}>Concluir</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const { showToast } = useToast()
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
        <div className="truncate font-mono text-sm text-white">{value}</div>
      </div>
      <Button
        variant="secondary"
        className="px-2.5 py-1 text-xs"
        onClick={() => {
          void navigator.clipboard?.writeText(value)
          showToast('Copiado.', 'success')
        }}
      >
        Copiar
      </Button>
    </div>
  )
}

function ReviewGroupBlock({
  group,
  collapsed,
  savingGroup,
  savingInlineId,
  isAdmin,
  onToggle,
  onGroupLink,
  onGroupAddEmail,
  onGroupProvisionPortal,
  onCorrect,
  onInlineField,
}: {
  group: ReviewGroup
  collapsed: boolean
  savingGroup: boolean
  savingInlineId: string | null
  isAdmin: boolean
  onToggle: () => void
  onGroupLink: (customerId: number) => void
  onGroupAddEmail: (email: string) => void
  onGroupProvisionPortal: () => void
  onCorrect: (id: string) => void
  onInlineField: (item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', value: string) => void
}) {
  const [emailDraft, setEmailDraft] = useState('')
  const unlinkedCount = group.items.filter(needsCustomerLink).length
  const hasLinkedCustomer = getGroupLinkedItem(group) != null
  const needsEmail = groupNeedsEmail(group)
  const needsPortal = groupNeedsPortal(group)
  const groupReasons = useMemo(() => {
    const reasons = new Set<string>()
    for (const item of group.items) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons]
  }, [group.items])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 bg-[#0d1117] px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            size={16}
            className={`text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <span className="font-semibold text-white">{group.displayName}</span>
        </button>
        {group.cnpj ? (
          <span className="text-xs text-slate-500">{formatCnpjCpf(group.cnpj)}</span>
        ) : (
          <span className="text-xs text-amber-300">sem CNPJ</span>
        )}
        <Badge tone="slate">{formatResultCount(group.items.length, 'B/L', 'B/Ls')}</Badge>
        <div className="flex flex-wrap gap-1.5">
          {groupReasons.slice(0, 4).map((reason) => (
            <Badge key={reason} tone="yellow">
              {reason}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {unlinkedCount > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Vincular cliente a {unlinkedCount}:</span>
              <InlineCustomerPicker saving={savingGroup} onSelect={onGroupLink} />
            </div>
          ) : null}
          {hasLinkedCustomer && needsEmail ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="E-mail de faturamento"
                className="w-52 py-1 text-xs"
                disabled={savingGroup}
              />
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                loading={savingGroup}
                onClick={() => onGroupAddEmail(emailDraft)}
              >
                Salvar e-mail
              </Button>
            </div>
          ) : null}
          {hasLinkedCustomer && needsPortal ? (
            isAdmin ? (
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                loading={savingGroup}
                disabled={needsEmail}
                title={needsEmail ? 'Adicione um e-mail antes de provisionar o portal' : undefined}
                onClick={onGroupProvisionPortal}
              >
                Provisionar portal
              </Button>
            ) : (
              <span className="text-xs text-slate-500">Portal pendente (admin)</span>
            )
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[820px] text-left text-sm">
            <tbody className="divide-y divide-[#30363d]">
              {group.items.map((item) => (
                <tr key={item.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">
                    <div className="flex items-center gap-2">
                      {item.source === 'granite' ? <Badge tone="blue">Granito</Badge> : null}
                      {item.source === 'granite' ? item.bl_number : item.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="flex flex-wrap gap-2">
                        {(item.review_reasons?.length ? item.review_reasons : ['Pendente de revisão']).map((reason) => (
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
                          onSave={(value) => onInlineField(item, 'ce_mercante', value)}
                        />
                      ) : null}
                      {item.source === 'bl' && needsWeightFix(item) ? (
                        <InlineFieldEditor
                          type="number"
                          placeholder="Peso BB (ton)"
                          initial={item.bb_weight_ton != null ? String(item.bb_weight_ton) : ''}
                          saving={savingInlineId === item.id}
                          onSave={(value) => onInlineField(item, 'bb_weight_ton', value)}
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {item.voyage?.vessel?.name ?? '-'} / {item.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => onCorrect(item.id)}>
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
      ) : null}
    </div>
  )
}

function ReviewDrawer({
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
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerCnpj, setNewCustomerCnpj] = useState('')
  const [newCustomerEmail, setNewCustomerEmail] = useState('')
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
    setCustomerSearch('')
    const manifestName = item.source === 'bl' ? (item.manifest_customer_name ?? null) : null
    const manifestCnpj = item.source === 'bl' ? (item.manifest_customer_cnpj_cpf ?? null) : null
    const manifestEmail = item.source === 'bl' ? (item.manifest_customer_email ?? null) : null
    setNewCustomerName(manifestName ?? item.consignee ?? '')
    setNewCustomerCnpj(manifestCnpj ?? '')
    setNewCustomerEmail(manifestEmail ?? '')
    setJustification('')
  }

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
      showToast('Cliente criado e pronto para vinculação. Clique em "Marcar como revisado" para concluir.', 'success')
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

    setSaving(true)
    try {
      if (item.source === 'granite') {
        if (!selectedCustomerId) {
          showToast('Selecione um cliente para vincular.', 'error')
          setSaving(false)
          return
        }
        await saveGraniteBlReview({ graniteBlId: item.id, clientId: selectedCustomerId, changedBy: user.id })
        await invalidateAll(item.id)
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

      await invalidateAll(item.id)

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

  async function invalidateAll(blId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['bls'] }),
      queryClient.invalidateQueries({ queryKey: ['granite-bls'] }),
      queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
      queryClient.invalidateQueries({ queryKey: ['audit-logs', 'bl', blId] }),
      queryClient.invalidateQueries({ queryKey: ['customers'] }),
      queryClient.invalidateQueries({ queryKey: ['op-count'] }),
    ])
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

          <Card className="grid gap-4 bg-[#0d1117]">
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

            <div className="grid gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Ou cadastre um novo cliente</div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome">
                  <Input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} />
                </Field>
                <Field label="CNPJ/CPF">
                  <Input value={newCustomerCnpj} onChange={(event) => setNewCustomerCnpj(event.target.value)} />
                </Field>
                <Field label="E-mail">
                  <Input value={newCustomerEmail} onChange={(event) => setNewCustomerEmail(event.target.value)} placeholder="(opcional)" />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="secondary" onClick={handleCreateCustomer}>
                    Cadastrar cliente
                  </Button>
                </div>
              </div>
            </div>
          </Card>

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
