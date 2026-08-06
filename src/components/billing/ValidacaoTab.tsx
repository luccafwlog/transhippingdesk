import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../ui/Toast'
import {
  useBatchCalculateLocalCharges,
  useBatchMarkLocalChargesReady,
  useBatchMarkLocalChargesReviewed,
  useCustomerReconciliationQueue,
  useApproveCustomerReconciliation,
  useRejectCustomerReconciliation,
  useLocalChargeOperations,
} from '../../hooks/useLocalCharges'
import { runGraniteBatch } from '../../services/graniteBillingWorkflow'
import { queryKeys } from '../../services/queryKeys'
import { isChargeReady } from '../../lib/chargeStatus'
import { createInvoiceFromBls } from '../../services/billing'
import { isCustomerReconciliationResolved } from '../../services/customerReconciliation'
import { isBlLockedForRecalc, isPendingBillingReview } from './validacaoPipeline'
import { ValidacaoControls } from './ValidacaoControls'
import { ValidacaoOperationsTable } from './ValidacaoOperationsTable'
import type { BatchOperation, OpsFilters, PipelineStep } from './validacaoTypes'

export function ValidacaoTab({ userId }: { userId: string | null }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const [reconciliationFilter, setReconciliationFilter] = useState(false)
  const [reviewFilter, setReviewFilter] = useState(false)
  const [opsFilters, setOpsFilters] = useState<OpsFilters>({
    search: '',
    cargoMode: '',
    pod: '',
    voyageId: '',
    chargeStatus: '',
  })
  const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
  const [exportingOps, setExportingOps] = useState(false)

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
    const readyRows = rows.filter((row) => isChargeReady(row.charge_status))
    const readyInvoiced = readyRows.filter((row) => row.financial_status === 'invoiced').length
    return {
      total: rows.length,
      reviewPending: rows.filter(isPendingBillingReview).length,
      ready: readyRows.length,
      readyInvoiced,
      readyPendingInvoice: Math.max(readyRows.length - readyInvoiced, 0),
      reconciliationPending: rows.filter((row) => !isCustomerReconciliationResolved(row.customer_reconciliation_status)).length,
      blocked: rows.filter((row) => Boolean(row.billing_hold_reason)).length,
      totalBrl: rows.reduce((sum, row) => sum + Number(row.totals.total_brl ?? 0), 0),
      totalUsd: rows.reduce((sum, row) => sum + Number(row.totals.total_usd ?? 0), 0),
    }
  }, [operationsRows])

  const displayedRows = useMemo(() => {
    const rows = operationsRows ?? []
    if (reconciliationFilter) {
      return rows.filter((row) => !isCustomerReconciliationResolved(row.customer_reconciliation_status))
    }
    if (reviewFilter) {
      return rows.filter(isPendingBillingReview)
    }
    return rows
  }, [operationsRows, reconciliationFilter, reviewFilter])

  const pipelineBottleneck = useMemo<PipelineStep | null>(() => {
    if (operationsSummary.reconciliationPending > 0) return 'reconciliation'
    if (operationsSummary.reviewPending > 0) return 'review'
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
    setReviewFilter(false)
  }

  function handlePipelineStep(step: PipelineStep) {
    // Passo funciona como toggle: clicar no passo já ativo limpa o filtro. Um
    // único filtro por vez — os três mecanismos convergem aqui (#317).
    const isActive =
      (step === 'reconciliation' && reconciliationFilter) ||
      (step === 'review' && reviewFilter) ||
      (step === 'ready_for_billing' && opsFilters.chargeStatus === 'ready_for_billing')
    setReconciliationFilter(!isActive && step === 'reconciliation')
    setReviewFilter(!isActive && step === 'review')
    setOpsFilters((f) => ({ ...f, chargeStatus: !isActive && step === 'ready_for_billing' ? step : '' }))
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
      showToast(`Exportação concluída com ${rows.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar operação de taxas locais.', 'error')
    } finally {
      setExportingOps(false)
    }
  }

  async function runBatchOperation(action: BatchOperation) {
    const allIds = selectedOpsRows
    if (allIds.length === 0) {
      showToast('Selecione ao menos um B/L para executar acao em lote.', 'error')
      return
    }

    const financialStatusById = new Map((operationsRows ?? []).map((row) => [row.id, row.financial_status] as const))
    const cargoModeById = new Map((operationsRows ?? []).map((row) => [row.id, row.cargo_mode] as const))
    const allLocalIds = allIds.filter((id) => cargoModeById.get(id) !== 'granito')
    const graniteIds = allIds.filter((id) => cargoModeById.get(id) === 'granito')

    // B/L ja faturado nunca e recalculado (etapa 2 do plano de faturamento):
    // pula em vez de deixar o RPC recusar como erro generico, e reporta quanto pulou.
    const invoicedIds =
      action === 'recalculate' ? allLocalIds.filter((id) => isBlLockedForRecalc(financialStatusById.get(id))) : []
    const localIds = allLocalIds.filter((id) => !invoicedIds.includes(id))

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

      if (invoicedIds.length > 0) {
        showToast(
          `${successCount} recalculado(s), ${invoicedIds.length} ignorado(s) (ja faturados)` +
            (errorCount > 0 && firstError ? `, ${errorCount} falharam. Primeiro erro em ${firstError.blId}: ${firstError.message}` : '.'),
          errorCount > 0 ? 'info' : 'success',
        )
      } else if (errorCount > 0 && firstError) {
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

  async function handleIssueSingleInvoice(row: { id: string; customer?: { id: number | null } | null }) {
    if (!row.customer?.id) {
      showToast('Nao ha cliente vinculado para emitir esta fatura.', 'error')
      return
    }

    try {
      await createInvoiceFromBls({
        blIds: [row.id],
        customerId: row.customer.id,
        issueNow: true,
        actorId: userId,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.summary() }),
      ])
      showToast(`Fatura emitida para ${row.id}.`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao emitir fatura individual.', 'error')
    }
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
      <ValidacaoControls
        filters={opsFilters}
        selectedCount={selectedOpsRows.length}
        operationsLoading={operationsLoading}
        reconciliationPending={operationsSummary.reconciliationPending}
        reviewPending={operationsSummary.reviewPending}
        ready={operationsSummary.ready}
        readyInvoiced={operationsSummary.readyInvoiced}
        readyPendingInvoice={operationsSummary.readyPendingInvoice}
        pipelineBottleneck={pipelineBottleneck}
        reconciliationFilter={reconciliationFilter}
        reviewFilter={reviewFilter}
        calculatePending={batchCalculateMutation.isPending}
        reviewPendingMutation={batchReviewedMutation.isPending}
        readyPendingMutation={batchReadyMutation.isPending}
        exporting={exportingOps}
        onUpdateFilter={updateOpsFilter}
        onPipelineStep={handlePipelineStep}
        onRunBatchOperation={(action) => void runBatchOperation(action)}
        onExport={() => void handleExportOperations()}
      />
      <ValidacaoOperationsTable
        rows={displayedRows}
        isLoading={operationsLoading}
        hasError={Boolean(operationsError)}
        selectedRowIds={selectedOpsRows}
        areAllRowsSelected={areAllOpsRowsSelected}
        expandedBlId={expandedBlId}
        reconciliationQueue={reconciliationQueue ?? []}
        approvePending={approveReconciliationMutation.isPending}
        rejectPending={rejectReconciliationMutation.isPending}
        onToggleAllRows={toggleAllOpsRows}
        onToggleRow={toggleOpsRow}
        onToggleExpandedRow={(blId) => setExpandedBlId((current) => (current === blId ? null : blId))}
        onIssueSingleInvoice={(row) => void handleIssueSingleInvoice(row)}
        onApproveQueueItem={(queueId, customerId) => void handleApproveQueueItem(queueId, customerId)}
        onRejectQueueItem={(queueId) => void handleRejectQueueItem(queueId)}
      />
    </>
  )
}
