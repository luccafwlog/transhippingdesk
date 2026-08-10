import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../ui/Toast'
import { useBatchCalculateLocalCharges, useCustomerReconciliationQueue, useApproveCustomerReconciliation, useRejectCustomerReconciliation, useLocalChargeOperations } from '../../hooks/useLocalCharges'
import { queryKeys } from '../../services/queryKeys'
import { issueOperationalInvoice } from '../../services/graniteBillingWorkflow'
import { getBillingBlock, isBlLockedForRecalc } from './validacaoPipeline'
import { ValidacaoControls } from './ValidacaoControls'
import { ValidacaoOperationsTable } from './ValidacaoOperationsTable'
import type { LocalChargeOperationalRow } from '../../services/charges/chargeOperationsService'
import type { BillingBlockCode, BatchOperation, OpsFilters } from './validacaoTypes'

export function ValidacaoTab({ userId, initialBlockCode }: { userId: string | null; initialBlockCode?: BillingBlockCode }) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const [opsFilters, setOpsFilters] = useState<OpsFilters>({ search: '', cargoMode: '', pod: '', voyageId: '', blockCode: initialBlockCode ?? '', includeResolved: false })
  const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
  const [exportingOps, setExportingOps] = useState(false)
  const [exportingConference, setExportingConference] = useState(false)
  const { data: operationsRows, isLoading: operationsLoading, error: operationsError } = useLocalChargeOperations({ search: opsFilters.search, cargoMode: opsFilters.cargoMode, pod: opsFilters.pod, voyageId: opsFilters.voyageId ? Number(opsFilters.voyageId) : null, includeResolved: opsFilters.includeResolved, limit: 1200 })
  const batchCalculateMutation = useBatchCalculateLocalCharges()
  const { data: reconciliationQueue } = useCustomerReconciliationQueue('pending', 50)
  const approveReconciliationMutation = useApproveCustomerReconciliation()
  const rejectReconciliationMutation = useRejectCustomerReconciliation()

  const displayedRows = useMemo(() => {
    return (operationsRows ?? []).filter((row) => {
      const block = getBillingBlock(row)
      if (!opsFilters.includeResolved && (block.code === 'faturado' || block.code === 'isento')) return false
      return !opsFilters.blockCode || block.code === opsFilters.blockCode
    })
  }, [operationsRows, opsFilters.blockCode, opsFilters.includeResolved])
  const selectedRows = useMemo(() => new Set(selectedOpsRows), [selectedOpsRows])
  const areAllOpsRowsSelected = displayedRows.length > 0 && displayedRows.every((row) => selectedRows.has(row.id))

  function updateOpsFilter<K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) {
    setOpsFilters((current) => ({ ...current, [field]: value }))
    setSelectedOpsRows([])
  }
  function toggleOpsRow(blId: string) { setSelectedOpsRows((current) => current.includes(blId) ? current.filter((id) => id !== blId) : [...current, blId]) }
  function toggleAllOpsRows() { setSelectedOpsRows(areAllOpsRowsSelected ? [] : displayedRows.map((row) => row.id)) }

  async function runBatchOperation(action: BatchOperation, explicitIds?: string[]) {
    const ids = explicitIds ?? selectedOpsRows
    if (!ids.length) return
    const invoiced = new Set((operationsRows ?? []).filter((row) => ids.includes(row.id) && isBlLockedForRecalc(row.financial_status)).map((row) => row.id))
    const eligible = ids.filter((id) => !invoiced.has(id))
    if (!eligible.length) return
    const result = await batchCalculateMutation.mutateAsync({ blIds: eligible, actorId: userId, recalculate: action === 'recalculate' })
    showToast(`${result.successCount} B/L(s) recalculado(s).${result.errorCount ? ` ${result.errorCount} falharam.` : ''}`, result.errorCount ? 'info' : 'success')
    setSelectedOpsRows([])
  }

  async function handleExportOperations() {
    if (!displayedRows.length) return showToast('Não há dados para exportar com os filtros atuais.', 'info')
    setExportingOps(true)
    try { const { exportLocalChargeOperationsWorkbook } = await import('../../services/exports'); await exportLocalChargeOperationsWorkbook(displayedRows); showToast(`Exportação concluída com ${displayedRows.length} B/L(s).`, 'success') } catch { showToast('Falha ao exportar operação de taxas locais.', 'error') } finally { setExportingOps(false) }
  }
  async function handleExportConference() {
    const scope = selectedOpsRows.length ? selectedOpsRows : displayedRows.map((row) => row.id)
    if (!scope.length) return showToast('Não há B/Ls para exportar com o filtro/seleção atual.', 'info')
    setExportingConference(true)
    try {
      const { buildLocalChargeConferenceRows } = await import('../../services/charges/chargeOperationsService')
      const { exportLocalChargeConferenceWorkbook } = await import('../../services/exports')
      const rows = await buildLocalChargeConferenceRows(scope)
      await exportLocalChargeConferenceWorkbook(rows, selectedOpsRows.length ? `${scope.length} B/L(s) selecionado(s)` : `${scope.length} B/L(s) filtrado(s)`)
      showToast(`Planilha de conferência exportada com ${rows.length} linha(s).`, 'success')
    } catch { showToast('Falha ao exportar planilha de conferência.', 'error') } finally { setExportingConference(false) }
  }
  async function handleIssueSingleInvoice(row: LocalChargeOperationalRow) {
    if (!row.customer?.id) return showToast('Nao ha cliente vinculado para emitir esta fatura.', 'error')
    try { await issueOperationalInvoice({ blId: row.id, cargoMode: row.cargo_mode, customerId: row.customer.id, actorId: userId }); await queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }); showToast(`Fatura emitida para ${row.id}.`, 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao emitir fatura individual.', 'error') }
  }
  async function handleRecalculateRow(row: LocalChargeOperationalRow) { try { await runBatchOperation('recalculate', [row.id]) } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao recalcular B/L.', 'error') } }
  async function handleApproveQueueItem(queueId: number, customerId?: number | null) { if (!customerId) return showToast('Não há cliente vinculado para aprovação automática.', 'error'); try { await approveReconciliationMutation.mutateAsync({ queueId, customerId, actorId: userId }); showToast('Reconciliação aprovada.', 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao aprovar reconciliação.', 'error') } }
  async function handleRejectQueueItem(queueId: number) { try { await rejectReconciliationMutation.mutateAsync({ queueId, actorId: userId }); showToast('Reconciliação rejeitada.', 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao rejeitar reconciliação.', 'error') } }

  return <>
    <ValidacaoControls filters={opsFilters} blockedCount={displayedRows.length} selectedCount={selectedOpsRows.length} operationsLoading={operationsLoading} calculatePending={batchCalculateMutation.isPending} exporting={exportingOps} exportingConference={exportingConference} onUpdateFilter={updateOpsFilter} onRunBatchOperation={(action) => void runBatchOperation(action)} onExport={() => void handleExportOperations()} onExportConference={() => void handleExportConference()} />
    <ValidacaoOperationsTable rows={displayedRows} isLoading={operationsLoading} hasError={Boolean(operationsError)} selectedRowIds={selectedOpsRows} areAllRowsSelected={areAllOpsRowsSelected} expandedBlId={expandedBlId} reconciliationQueue={reconciliationQueue ?? []} approvePending={approveReconciliationMutation.isPending} rejectPending={rejectReconciliationMutation.isPending} onToggleAllRows={toggleAllOpsRows} onToggleRow={toggleOpsRow} onToggleExpandedRow={(id) => setExpandedBlId((current) => current === id ? null : id)} onIssueSingleInvoice={(row) => void handleIssueSingleInvoice(row)} onRecalculateRow={(row) => void handleRecalculateRow(row)} onApproveQueueItem={(id, customerId) => void handleApproveQueueItem(id, customerId)} onRejectQueueItem={(id) => void handleRejectQueueItem(id)} />
  </>
}
