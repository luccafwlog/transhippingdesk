import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CheckSquare, ChevronDown, ChevronUp, Download, RefreshCw, Square } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { useToast } from '../ui/Toast'
import {
  useBatchCalculateLocalCharges,
  useBatchMarkLocalChargesReady,
  useBatchMarkLocalChargesReviewed,
  useBlLocalChargeLines,
  useCustomerReconciliationQueue,
  useApproveCustomerReconciliation,
  useRejectCustomerReconciliation,
  useLocalChargeOperations,
} from '../../hooks/useLocalCharges'
import { useVoyageOptions } from '../../hooks/useBls'
import { calculateGraniteBlCharges } from '../../services/graniteCharges'
import { markGraniteBlReady } from '../../services/charges/chargeOperationsService'
import { queryKeys } from '../../services/queryKeys'
import { formatBRL, formatDate } from '../../lib/utils'
import { createInvoiceFromBls } from '../../services/billing'

type OpsFilters = {
  search: string
  cargoMode: '' | 'container' | 'carga_solta' | 'granito'
  pod: string
  voyageId: string
  chargeStatus: '' | 'review_required' | 'ready_for_billing' | 'exempt'
}

export function ValidacaoTab({ userId }: { userId: string | null }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const [reconciliationFilter, setReconciliationFilter] = useState(false)
  const [opsFilters, setOpsFilters] = useState<OpsFilters>({
    search: '',
    cargoMode: '',
    pod: '',
    voyageId: '',
    chargeStatus: '',
  })
  const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
  const [exportingOps, setExportingOps] = useState(false)

  const { data: voyageOptions } = useVoyageOptions()
  const {
    data: operationsRows,
    isLoading: operationsLoading,
    error: operationsError,
  } = useLocalChargeOperations({
    search: opsFilters.search,
    cargoMode: opsFilters.cargoMode,
    pod: opsFilters.pod,
    voyageId: opsFilters.voyageId ? Number(opsFilters.voyageId) : null,
    chargeStatus: opsFilters.chargeStatus,
    limit: 1200,
  })
  const batchCalculateMutation = useBatchCalculateLocalCharges()
  const batchReviewedMutation = useBatchMarkLocalChargesReviewed()
  const batchReadyMutation = useBatchMarkLocalChargesReady()
  const { data: reconciliationQueue } = useCustomerReconciliationQueue('pending', 50)
  const approveReconciliationMutation = useApproveCustomerReconciliation()
  const rejectReconciliationMutation = useRejectCustomerReconciliation()

  const operationsSummary = useMemo(() => {
    const rows = operationsRows ?? []
    const readyRows = rows.filter((row) => row.charge_status === 'ready_for_billing')
    const readyInvoiced = readyRows.filter((row) => row.financial_status === 'invoiced').length
    return {
      total: rows.length,
      reviewRequired: rows.filter((row) => row.charge_status === 'review_required').length,
      ready: readyRows.length,
      readyInvoiced,
      readyPendingInvoice: Math.max(readyRows.length - readyInvoiced, 0),
      reconciliationPending: rows.filter((row) => !['matched_document', 'reconciled'].includes(row.customer_reconciliation_status ?? '')).length,
      blocked: rows.filter((row) => Boolean(row.billing_hold_reason)).length,
      totalBrl: rows.reduce((sum, row) => sum + Number(row.totals.total_brl ?? 0), 0),
      totalUsd: rows.reduce((sum, row) => sum + Number(row.totals.total_usd ?? 0), 0),
    }
  }, [operationsRows])

  const displayedRows = useMemo(() => {
    const rows = operationsRows ?? []
    if (reconciliationFilter) {
      return rows.filter((row) => !['matched_document', 'reconciled'].includes(row.customer_reconciliation_status ?? ''))
    }
    return rows
  }, [operationsRows, reconciliationFilter])

  const pipelineBottleneck = useMemo(() => {
    if (operationsSummary.reconciliationPending > 0) return 'reconciliation'
    if (operationsSummary.reviewRequired > 0) return 'review_required'
    if (operationsSummary.ready > 0) return 'ready_for_billing'
    return null
  }, [operationsSummary])

  const areAllOpsRowsSelected = useMemo(() => {
    if (displayedRows.length === 0) return false
    return displayedRows.every((row) => selectedOpsRows.includes(row.id))
  }, [displayedRows, selectedOpsRows])

  function updateOpsFilter<K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) {
    setOpsFilters((current) => ({ ...current, [field]: value }))
    setSelectedOpsRows([])
    setReconciliationFilter(false)
  }

  function handlePipelineStep(step: 'reconciliation' | 'review_required' | 'ready_for_billing') {
    if (step === 'reconciliation') {
      setReconciliationFilter(true)
      setOpsFilters((f) => ({ ...f, chargeStatus: '' }))
    } else {
      setReconciliationFilter(false)
      setOpsFilters((f) => ({ ...f, chargeStatus: step }))
    }
    setSelectedOpsRows([])
    setExpandedBlId(null)
  }

  function toggleOpsRow(blId: string) {
    setSelectedOpsRows((current) => {
      if (current.includes(blId)) {
        return current.filter((value) => value !== blId)
      }
      return [...current, blId]
    })
  }

  function toggleAllOpsRows() {
    if (!displayedRows.length) {
      setSelectedOpsRows([])
      return
    }
    if (areAllOpsRowsSelected) {
      setSelectedOpsRows([])
      return
    }
    setSelectedOpsRows(displayedRows.map((row) => row.id))
  }

  async function handleExportOperations() {
    const rows = operationsRows ?? []
    if (!rows.length) {
      showToast('Não há dados para exportar com os filtros atuais.', 'info')
      return
    }

    setExportingOps(true)
    try {
      const { exportLocalChargeOperationsWorkbook } = await import('../../services/exports')
      await exportLocalChargeOperationsWorkbook(rows)
      showToast(`Exportacao concluida com ${rows.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar operação de taxas locais.', 'error')
    } finally {
      setExportingOps(false)
    }
  }

  async function runBatchOperation(action: 'recalculate' | 'review' | 'ready') {
    const allIds = selectedOpsRows
    if (allIds.length === 0) {
      showToast('Selecione ao menos um B/L para executar acao em lote.', 'error')
      return
    }

    const cargoModeById = new Map((operationsRows ?? []).map((row) => [row.id, row.cargo_mode] as const))
    const localIds = allIds.filter((id) => cargoModeById.get(id) !== 'granito')
    const graniteIds = allIds.filter((id) => cargoModeById.get(id) === 'granito')

    try {
      const actorId = userId
      const emptyResult = { total: 0, successCount: 0, errorCount: 0, errors: [] as Array<{ blId: string; message: string }> }

      let localResult = emptyResult
      if (localIds.length > 0) {
        localResult =
          action === 'recalculate'
            ? await batchCalculateMutation.mutateAsync({ blIds: localIds, actorId, recalculate: true })
            : action === 'review'
              ? await batchReviewedMutation.mutateAsync({ blIds: localIds, actorId })
              : await batchReadyMutation.mutateAsync({ blIds: localIds, actorId })
      }

      const graniteResult = graniteIds.length > 0 ? await runGraniteBatch(graniteIds, action) : emptyResult

      const total = localResult.total + graniteResult.total
      const successCount = localResult.successCount + graniteResult.successCount
      const errorCount = localResult.errorCount + graniteResult.errorCount
      const firstError = [...localResult.errors, ...graniteResult.errors][0]

      if (errorCount > 0 && firstError) {
        showToast(
          `Processamento parcial: ${successCount}/${total}. Primeiro erro em ${firstError.blId}: ${firstError.message}`,
          'info',
        )
      } else if (total > 0) {
        showToast(`Processamento concluido para ${successCount} B/L(s).`, 'success')
      }

      if (graniteResult.successCount > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() })
      }

      if (action === 'ready' && localResult.successCount > 0) {
        const failedIds = new Set(localResult.errors.map((e) => e.blId))
        const readyBls = (operationsRows ?? []).filter(
          (row) =>
            localIds.includes(row.id) &&
            !failedIds.has(row.id) &&
            row.cargo_mode !== 'granito' &&
            row.financial_status !== 'invoiced',
        )
        const readyByCustomer = new Map<number, typeof readyBls>()
        const missingCustomer = readyBls.filter((bl) => !bl.customer?.id).length
        for (const bl of readyBls) {
          if (!bl.customer?.id) continue
          const current = readyByCustomer.get(bl.customer.id) ?? []
          current.push(bl)
          readyByCustomer.set(bl.customer.id, current)
        }

        let invoiced = 0
        const invoiceErrors: Array<{ blId: string; message: string }> = []
        for (const [customerId, bls] of readyByCustomer.entries()) {
          try {
            const result = await createInvoiceFromBls({
              blIds: bls.map((bl) => bl.id),
              customerId,
              issueNow: true,
              actorId: userId,
            })
            invoiced += Number((result as { bl_count?: number }).bl_count ?? bls.length)
          } catch (error) {
            invoiceErrors.push({
              blId: bls[0]?.id ?? '-',
              message: error instanceof Error ? error.message : 'Falha ao gerar invoice automatica.',
            })
          }
        }
        if (invoiced > 0) {
          showToast(`${invoiced} B/L(s) faturado(s) automaticamente.`, 'success')
        }
        const missing = Math.max(readyBls.length - invoiced, 0)
        if (missing > 0) {
          const firstInvoiceError = invoiceErrors[0]
          const reason = firstInvoiceError
            ? ` Primeiro erro em ${firstInvoiceError.blId}: ${firstInvoiceError.message}`
            : missingCustomer > 0
              ? ` ${missingCustomer} B/L(s) sem cliente vinculado.`
              : ''
          showToast(`${missing} B/L(s) ficaram em pronto faturar sem invoice automatica.${reason}`, 'info')
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.summary() }),
      ])
      setSelectedOpsRows([])
    } catch {
      showToast('Falha ao executar processamento em lote.', 'error')
    }
  }

  async function runGraniteBatch(
    ids: string[],
    action: 'recalculate' | 'review' | 'ready',
  ): Promise<{ total: number; successCount: number; errorCount: number; errors: Array<{ blId: string; message: string }> }> {
    if (action === 'review') {
      return { total: ids.length, successCount: ids.length, errorCount: 0, errors: [] }
    }
    const worker = action === 'ready' ? markGraniteBlReady : calculateGraniteBlCharges
    const errors: Array<{ blId: string; message: string }> = []
    let ok = 0
    for (const id of ids) {
      try {
        await worker(id)
        ok++
      } catch (e) {
        errors.push({ blId: id, message: e instanceof Error ? e.message : 'Erro inesperado no processamento Granito.' })
      }
    }
    return { total: ids.length, successCount: ok, errorCount: errors.length, errors }
  }

  async function handleApproveQueueItem(queueId: number, customerId?: number | null) {
    if (!customerId) {
      showToast('Não há cliente vinculado para aprovação automática. Revise o cadastro antes.', 'error')
      return
    }

    try {
      await approveReconciliationMutation.mutateAsync({
        queueId,
        customerId,
        actorId: userId,
      })
      showToast('Reconciliação aprovada.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao aprovar reconciliação.', 'error')
    }
  }

  async function handleRejectQueueItem(queueId: number) {
    try {
      await rejectReconciliationMutation.mutateAsync({
        queueId,
        actorId: userId,
      })
      showToast('Reconciliação rejeitada.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao rejeitar reconciliação.', 'error')
    }
  }

  return (
    <>
      <Card className="mb-5">
        <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div className="app-table__cell-stack">
            <div className="app-panel__title">Filtro operacional</div>
            <div className="app-table__cell-meta">Trabalhe bloqueios, conciliação e prontidão de faturamento sobre a mesma base filtrada.</div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Texto livre">
            <Input
              value={opsFilters.search}
              onChange={(event) => updateOpsFilter('search', event.target.value)}
              placeholder="B/L ou cliente"
            />
          </Field>
          <Field label="Modo">
            <Select
              value={opsFilters.cargoMode}
              onChange={(event) => updateOpsFilter('cargoMode', event.target.value as OpsFilters['cargoMode'])}
            >
              <option value="">Todos</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="granito">Granito</option>
            </Select>
          </Field>
          <Field label="Viagem">
            <Select value={opsFilters.voyageId} onChange={(event) => updateOpsFilter('voyageId', event.target.value)}>
              <option value="">Todas</option>
              {voyageOptions?.map((voyage) => (
                <option key={voyage.id} value={voyage.id}>
                  {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="POD">
            <Input
              value={opsFilters.pod}
              onChange={(event) => updateOpsFilter('pod', event.target.value.toUpperCase())}
              placeholder="BRVIT / BRSSA"
            />
          </Field>
          <Field label="Status taxas">
            <Select
              value={opsFilters.chargeStatus}
              onChange={(event) =>
                updateOpsFilter('chargeStatus', event.target.value as OpsFilters['chargeStatus'])
              }
            >
              <option value="">Todos</option>
              <option value="review_required">Revisao</option>
              <option value="ready_for_billing">Pronto faturar</option>
              <option value="exempt">Isento</option>
            </Select>
          </Field>
          <div className="app-metric-tile">
            <div className="app-metric-tile__label">Selecionados</div>
            <div className="app-metric-tile__value">{selectedOpsRows.length}</div>
            <div className="app-panel__meta">Acoes em lote por selecao manual</div>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="app-panel__title">Fila de prioridades</div>
            <div className="app-panel__meta">Clique em um passo para filtrar a grade abaixo.</div>
          </div>
          {pipelineBottleneck === null && !operationsLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-2">
              <CheckCircle size={16} className="text-green-700" />
              <span className="text-sm font-medium text-green-800">Tudo em dia</span>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <PipelineStep
            number={1}
            label="Conciliação"
            count={operationsSummary.reconciliationPending}
            isBottleneck={pipelineBottleneck === 'reconciliation'}
            active={reconciliationFilter}
            onClick={() => handlePipelineStep('reconciliation')}
          />
          <PipelineStep
            number={2}
            label="Em revisao"
            count={operationsSummary.reviewRequired}
            isBottleneck={pipelineBottleneck === 'review_required'}
            active={opsFilters.chargeStatus === 'review_required' && !reconciliationFilter}
            onClick={() => handlePipelineStep('review_required')}
          />
          <PipelineStep
            number={3}
            label="Pronto faturar"
            count={operationsSummary.ready}
            isBottleneck={pipelineBottleneck === 'ready_for_billing'}
            active={opsFilters.chargeStatus === 'ready_for_billing' && !reconciliationFilter}
            onClick={() => handlePipelineStep('ready_for_billing')}
          />
        </div>
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Pronto faturar: {operationsSummary.ready} | Faturado automatico: {operationsSummary.readyInvoiced} | Diferenca: {operationsSummary.readyPendingInvoice}
        </div>
      </Card>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => runBatchOperation('recalculate')}
            loading={batchCalculateMutation.isPending}
            disabled={batchReviewedMutation.isPending || batchReadyMutation.isPending}
          >
            <RefreshCw size={15} />
            Recalcular selecionados
          </Button>
          <Button
            variant="secondary"
            onClick={() => runBatchOperation('review')}
            loading={batchReviewedMutation.isPending}
            disabled={batchCalculateMutation.isPending || batchReadyMutation.isPending}
          >
            <CheckSquare size={15} />
            Aprovar revisao
          </Button>
          <Button
            onClick={() => runBatchOperation('ready')}
            loading={batchReadyMutation.isPending}
            disabled={batchCalculateMutation.isPending || batchReviewedMutation.isPending}
          >
            <CheckSquare size={15} />
            Marcar pronto faturar
          </Button>
          <Button variant="secondary" onClick={handleExportOperations} loading={exportingOps}>
            <Download size={15} />
            Exportar visao
          </Button>
          <span className="text-xs text-[var(--app-muted)]">{selectedOpsRows.length} B/L(s) selecionado(s)</span>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {operationsError ? <InlineError message="Falha ao carregar operação de taxas locais." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1100px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">
                  <button className="app-table__icon-button" type="button" onClick={toggleAllOpsRows} title="Selecionar todos">
                    {areAllOpsRowsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                </th>
                <th scope="col" className="px-4 py-3">B/L</th>
                <th scope="col" className="px-4 py-3">Modo</th>
                <th scope="col" className="px-4 py-3">Navio/Viagem</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Reconcil.</th>
                <th scope="col" className="px-4 py-3">Subtotal BRL</th>
                <th scope="col" className="px-4 py-3">Bloqueio</th>
                <th scope="col" className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {operationsLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={10}>
                    Carregando operação...
                  </td>
                </tr>
              ) : null}
              {!operationsLoading && displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-0">
                    <EmptyState title="Nenhum B/L encontrado." description="Ajuste os filtros de viagem ou status." />
                  </td>
                </tr>
              ) : null}
              {displayedRows.map((row) => {
                const isExpanded = expandedBlId === row.id
                const reconciliationPending = !['matched_document', 'reconciled'].includes(row.customer_reconciliation_status ?? '')
                const queueItem = reconciliationPending ? (reconciliationQueue?.find((q) => q.bl_id === row.id) ?? null) : null
                return (
                  <Fragment key={row.id}>
                    <tr className={isExpanded ? 'bg-[var(--app-surface-muted)]' : undefined}>
                      <td className="px-4 py-3">
                        <button
                          className="app-table__icon-button"
                          type="button"
                          onClick={() => toggleOpsRow(row.id)}
                          title="Selecionar B/L"
                        >
                          {selectedOpsRows.includes(row.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[var(--app-blue-btn)]">{row.id}</td>
                      <td className="px-4 py-3">{row.cargo_mode === 'carga_solta' ? 'Carga Solta' : row.cargo_mode === 'granito' ? 'Granito' : 'Container'}</td>
                      <td className="px-4 py-3">{row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}</td>
                      <td className="px-4 py-3">{renderChargeStatus(row.charge_status, row.financial_status)}</td>
                      <td className="px-4 py-3"><span className="app-table__truncate app-table__truncate--lg" title={row.customer?.name ?? '-'}>{row.customer?.name ?? '-'}</span></td>
                      <td className="px-4 py-3">{renderReconciliationStatus(row.customer_reconciliation_status)}</td>
                      <td className="px-4 py-3">{formatBRL(row.totals.total_brl)}</td>
                      <td className="px-4 py-3">
                        <span
                          className="app-table__truncate app-table__truncate--lg"
                          title={row.billing_hold_reason ?? row.customer_reconciliation_notes ?? row.charge_exemption_reason ?? '-'}
                        >
                          {row.billing_hold_reason ?? row.customer_reconciliation_notes ?? row.charge_exemption_reason ?? '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="app-table__icon-button"
                          type="button"
                          onClick={() => setExpandedBlId(isExpanded ? null : row.id)}
                          title={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`${row.id}-detail`} className="bg-[var(--app-surface-muted)]">
                        <td colSpan={10} className="px-6 py-4">
                          <div className="grid gap-4 xl:grid-cols-2">
                            <div className="grid gap-3">
                              <div className="app-metric-tile__label">Detalhes</div>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                                <div>
                                  <div className="text-[var(--app-muted)]">Trecho</div>
                                  <div className="text-[var(--app-text-strong)]">{row.pol ?? '-'} → {row.pod ?? '-'}</div>
                                </div>
                                <div>
                                  <div className="text-[var(--app-muted)]">Linhas</div>
                                  <div className="text-[var(--app-text-strong)]">
                                    {Number(row.totals.line_count).toLocaleString('pt-BR')}
                                    {row.totals.review_required_count > 0 ? (
                                      <span className="ml-2 text-xs text-amber-300">rev: {row.totals.review_required_count}</span>
                                    ) : null}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[var(--app-muted)]">Subtotal USD</div>
                                  <div className="text-[var(--app-text-strong)]">{formatUSD(row.totals.total_usd)}</div>
                                </div>
                                <div>
                                  <div className="text-[var(--app-muted)]">Billing run</div>
                                  <div className="text-[var(--app-text-strong)]">{row.last_billing_run_id ?? '-'}</div>
                                </div>
                                <div>
                                  <div className="text-[var(--app-muted)]">Ult. calculo</div>
                                  <div className="text-[var(--app-text-strong)]">{formatDate(row.charges_calculated_at)}</div>
                                </div>
                                <div>
                                  <div className="text-[var(--app-muted)]">Ult. revisao</div>
                                  <div className="text-[var(--app-text-strong)]">{formatDate(row.charges_reviewed_at)}</div>
                                </div>
                                <div className="col-span-2">
                                  <div className="text-[var(--app-muted)]">Ult. evento</div>
                                  <div className="text-[var(--app-text-strong)]">{row.trail.last_event_field ?? '-'} | {formatDate(row.trail.last_event_at)}</div>
                                </div>
                              </div>
                              {row.charge_status === 'review_required' ? (
                                <ReviewRequiredReasons blId={row.id} holdReason={row.billing_hold_reason} />
                              ) : null}
                              <div className="mt-1">
                                <Link
                                  className="app-table__action"
                                  to={row.cargo_mode === 'granito' ? '/granito' : `/manifestos/${row.id}`}
                                >
                                  Abrir B/L →
                                </Link>
                              </div>
                            </div>
                            {reconciliationPending && queueItem ? (
                              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-700">Conciliação pendente</div>
                                <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                  <div>
                                    <div className="text-[var(--app-muted)]">Cliente no manifesto</div>
                                    <div className="text-[var(--app-text-strong)]">{queueItem.manifest_customer_name ?? '-'}</div>
                                  </div>
                                  <div>
                                    <div className="text-[var(--app-muted)]">CNPJ/CPF</div>
                                    <div className="text-[var(--app-text-strong)]">{queueItem.cnpj_cpf ?? '-'}</div>
                                  </div>
                                  <div>
                                    <div className="text-[var(--app-muted)]">Cliente sugerido</div>
                                    <div className="text-[var(--app-text-strong)]">{queueItem.current_customer_name ?? '-'}</div>
                                  </div>
                                  <div>
                                    <div className="text-[var(--app-muted)]">Deteccao</div>
                                    <div>{renderDetectionType(queueItem.detection_type)}</div>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    variant="secondary"
                                    onClick={() => handleApproveQueueItem(queueItem.id, queueItem.customer_id)}
                                    loading={approveReconciliationMutation.isPending}
                                    disabled={!queueItem.customer_id || rejectReconciliationMutation.isPending}
                                  >
                                    Aprovar
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={() => handleRejectQueueItem(queueItem.id)}
                                    loading={rejectReconciliationMutation.isPending}
                                    disabled={approveReconciliationMutation.isPending}
                                  >
                                    Rejeitar
                                  </Button>
                                </div>
                              </div>
                            ) : reconciliationPending ? (
                              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">Conciliação pendente</div>
                                <div className="text-sm text-[var(--app-muted)]">Nenhum item de conciliação encontrado na fila para este B/L.</div>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function ReviewRequiredReasons({ blId, holdReason }: { blId: string; holdReason: string | null }) {
  const { data, isLoading } = useBlLocalChargeLines(blId)
  const pendingLines = (data ?? []).filter(
    (line) => line.status === 'review_required' && (line.review_reason ?? '').trim().length > 0,
  )

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
        Pendências de revisão das taxas
      </div>
      {holdReason ? (
        <div className="mb-2 text-sm text-amber-900">
          <span className="font-medium">Bloqueio:</span> {holdReason}
        </div>
      ) : null}
      {isLoading ? (
        <div className="text-sm text-amber-800">Carregando motivos...</div>
      ) : pendingLines.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
          {pendingLines.map((line) => (
            <li key={line.id}>
              <span className="font-medium">{line.charge_name}:</span> {line.review_reason}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-amber-800">Nenhum motivo detalhado encontrado nas linhas de cálculo.</div>
      )}
    </div>
  )
}

function renderChargeStatus(status: string | null, financialStatus?: string | null) {
  if (financialStatus === 'invoiced') return <Badge tone="blue">Faturado</Badge>
  if (status === 'review_required') return <Badge tone="yellow">Revisao</Badge>
  if (status === 'ready_for_billing') return <Badge tone="green">Pronto</Badge>
  if (status === 'exempt') return <Badge tone="slate">Isento</Badge>
  return <Badge tone="slate">Pendente</Badge>
}

function renderReconciliationStatus(status: string | null) {
  if (status === 'reconciled') return <Badge tone="green">Reconciliado</Badge>
  if (status === 'matched_document') return <Badge tone="blue">Match CNPJ</Badge>
  if (status === 'matched_name') return <Badge tone="yellow">Match nome</Badge>
  if (status === 'rejected') return <Badge tone="red">Rejeitado</Badge>
  return <Badge tone="yellow">Pendente</Badge>
}

function renderDetectionType(type: string | null) {
  if (type === 'document') return <Badge tone="blue">Documento</Badge>
  if (type === 'name') return <Badge tone="yellow">Nome</Badge>
  if (type === 'manual') return <Badge tone="green">Manual</Badge>
  return <Badge tone="red">Ausente</Badge>
}

function PipelineStep({
  number,
  label,
  count,
  isBottleneck,
  active,
  onClick,
}: {
  number: number
  label: string
  count: number
  isBottleneck: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
        active
          ? 'border-[var(--app-blue-btn)] bg-[var(--app-blue-soft)]'
          : isBottleneck && count > 0
            ? 'border-amber-500 bg-amber-50 hover:border-amber-600'
            : count === 0
              ? 'cursor-default border-[var(--app-border)] bg-[var(--app-surface-muted)] opacity-50'
              : 'border-[var(--app-border)] bg-[var(--app-surface)] hover:border-[var(--app-blue-btn)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
            active
              ? 'bg-[var(--app-blue-btn)] text-white'
              : isBottleneck && count > 0
                ? 'bg-amber-500 text-white'
                : 'bg-[var(--app-panel-strong)] text-[var(--app-muted)]'
          }`}
        >
          {number}
        </span>
        <span className="text-xs font-medium text-[var(--app-muted)]">{label}</span>
      </div>
      <div
        className={`text-2xl font-bold ${
          active ? 'text-[var(--app-blue-btn)]' : isBottleneck && count > 0 ? 'text-amber-700' : count === 0 ? 'text-[var(--app-muted-soft)]' : 'text-[var(--app-text-strong)]'
        }`}
      >
        {count}
      </div>
    </button>
  )
}

function formatUSD(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}
