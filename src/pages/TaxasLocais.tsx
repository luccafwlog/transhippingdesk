import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, CheckCircle, CheckSquare, ChevronDown, ChevronUp, Download, Pencil, Plus, RefreshCw, Save, Square, Trash2, X } from 'lucide-react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import {
  useApproveCustomerReconciliation,
  useBatchCalculateLocalCharges,
  useBatchMarkLocalChargesReady,
  useBatchMarkLocalChargesReviewed,
  useCustomerReconciliationQueue,
  useDeleteChargeTableItem,
  useSaveChargeTable,
  useSaveChargeTableItem,
  useSetChargeTableActive,
  useCustomerRateOverrides,
  useDeleteCustomerRateOverride,
  useLocalChargeTables,
  useOverrideChargeItems,
  useOverrideCustomers,
  useRejectCustomerReconciliation,
  useSaveCustomerRateOverride,
  useLocalChargeOperations,
} from '../hooks/useLocalCharges'
import { formatBRL, formatDate } from '../lib/utils'
import { useVoyageOptions } from '../hooks/useBls'
import { createInvoiceFromBls } from '../services/billing'

type LocalChargeTab = 'tabelas' | 'overrides' | 'pendencias'

type OverrideForm = {
  id: number | null
  customerId: string
  chargeItemId: string
  overrideValue: string
  validFrom: string
  validTo: string
  notes: string
}

type ChargeTableForm = {
  id: number | null
  name: string
  cargoMode: 'container' | 'carga_solta'
  pod: string
  validFrom: string
  validTo: string
  active: boolean
  notes: string
}

type ChargeTableItemForm = {
  id: number | null
  chargeTableId: string
  name: string
  category: 'base' | 'other_charge'
  applicationBasis: 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu'
  cargoProfile: 'standard' | 'imo' | 'oog' | 'any'
  currency: 'BRL' | 'USD'
  unitValue: string
  manualOnly: boolean
  active: boolean
  sortOrder: string
}

type LocalChargeOpsFilters = {
  search: string
  cargoMode: '' | 'container' | 'carga_solta'
  pod: string
  voyageId: string
  chargeStatus: '' | 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
}

const EMPTY_OVERRIDE_FORM: OverrideForm = {
  id: null,
  customerId: '',
  chargeItemId: '',
  overrideValue: '',
  validFrom: '',
  validTo: '',
  notes: '',
}

const EMPTY_TABLE_FORM: ChargeTableForm = {
  id: null,
  name: '',
  cargoMode: 'container',
  pod: '',
  validFrom: '',
  validTo: '',
  active: true,
  notes: '',
}

const EMPTY_TABLE_ITEM_FORM: ChargeTableItemForm = {
  id: null,
  chargeTableId: '',
  name: '',
  category: 'base',
  applicationBasis: 'bl',
  cargoProfile: 'any',
  currency: 'BRL',
  unitValue: '',
  manualOnly: false,
  active: true,
  sortOrder: '100',
}

export function TaxasLocais() {
  const { user, can } = useAuth()
  const { showToast } = useToast()
  const canManageTables = can('charge_tables')
  const canManageOverrides = can('charge_overrides')
  const [tab, setTab] = useState<LocalChargeTab>('tabelas')
  const [expandedTableId, setExpandedTableId] = useState<number | null>(null)
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const [reconciliationFilter, setReconciliationFilter] = useState(false)
  const [cargoModeFilter, setCargoModeFilter] = useState<'' | 'container' | 'carga_solta'>('')
  const [podFilter, setPodFilter] = useState('')
  const [tableForm, setTableForm] = useState<ChargeTableForm>(EMPTY_TABLE_FORM)
  const [tableItemForm, setTableItemForm] = useState<ChargeTableItemForm>(EMPTY_TABLE_ITEM_FORM)
  const [overrideCustomerSearch, setOverrideCustomerSearch] = useState('')
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(EMPTY_OVERRIDE_FORM)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideDeletingId, setOverrideDeletingId] = useState<number | null>(null)
  const [opsFilters, setOpsFilters] = useState<LocalChargeOpsFilters>({
    search: '',
    cargoMode: '',
    pod: '',
    voyageId: '',
    chargeStatus: '',
  })
  const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
  const [exportingOps, setExportingOps] = useState(false)
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useLocalChargeTables({
    cargoMode: cargoModeFilter,
    pod: podFilter,
  })
  const { data: overrideRows, isLoading: overridesLoading, error: overridesError } = useCustomerRateOverrides({
    customerSearch: overrideCustomerSearch,
    cargoMode: cargoModeFilter,
    pod: podFilter,
    limit: 300,
  })
  const { data: overrideChargeItems } = useOverrideChargeItems()
  const { data: overrideCustomers } = useOverrideCustomers(overrideCustomerSearch)
  const saveOverrideMutation = useSaveCustomerRateOverride()
  const deleteOverrideMutation = useDeleteCustomerRateOverride()
  const saveChargeTableMutation = useSaveChargeTable()
  const setChargeTableActiveMutation = useSetChargeTableActive()
  const saveChargeTableItemMutation = useSaveChargeTableItem()
  const deleteChargeTableItemMutation = useDeleteChargeTableItem()
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

  const tableSummary = useMemo(() => {
    const currentTables = tables ?? []
    return {
      tables: currentTables.length,
      active: currentTables.filter((item) => item.active).length,
      items: currentTables.reduce((sum, item) => sum + (item.charge_table_items?.length ?? 0), 0),
      manualOnly: currentTables.reduce(
        (sum, item) => sum + (item.charge_table_items?.filter((row) => row.manual_only).length ?? 0),
        0,
      ),
    }
  }, [tables])

  const operationsSummary = useMemo(() => {
    const rows = operationsRows ?? []
    return {
      total: rows.length,
      notCalculated: rows.filter((row) => row.charge_status === 'not_calculated').length,
      reviewRequired: rows.filter((row) => row.charge_status === 'review_required').length,
      reviewed: rows.filter((row) => row.charge_status === 'reviewed').length,
      ready: rows.filter((row) => row.charge_status === 'ready_for_billing').length,
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
    if (operationsSummary.notCalculated > 0) return 'not_calculated'
    if (operationsSummary.reviewRequired > 0) return 'review_required'
    if (operationsSummary.reviewed > 0) return 'reviewed'
    if (operationsSummary.ready > 0) return 'ready_for_billing'
    return null
  }, [operationsSummary])

  const areAllOpsRowsSelected = useMemo(() => {
    if (displayedRows.length === 0) return false
    return displayedRows.every((row) => selectedOpsRows.includes(row.id))
  }, [displayedRows, selectedOpsRows])

  function updateOpsFilter<K extends keyof LocalChargeOpsFilters>(field: K, value: LocalChargeOpsFilters[K]) {
    setOpsFilters((current) => ({ ...current, [field]: value }))
    setSelectedOpsRows([])
    setReconciliationFilter(false)
  }

  function handlePipelineStep(step: 'reconciliation' | 'not_calculated' | 'review_required' | 'reviewed' | 'ready_for_billing') {
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
      showToast('Nao ha dados para exportar com os filtros atuais.', 'info')
      return
    }

    setExportingOps(true)
    try {
      const { exportLocalChargeOperationsWorkbook } = await import('../services/exports')
      await exportLocalChargeOperationsWorkbook(rows)
      showToast(`Exportacao concluida com ${rows.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar operacao de taxas locais.', 'error')
    } finally {
      setExportingOps(false)
    }
  }

  async function runBatchOperation(action: 'calculate' | 'recalculate' | 'review' | 'ready') {
    const ids = selectedOpsRows
    if (ids.length === 0) {
      showToast('Selecione ao menos um B/L para executar acao em lote.', 'error')
      return
    }

    try {
      const actorId = user?.id ?? null
      const result =
        action === 'calculate'
          ? await batchCalculateMutation.mutateAsync({ blIds: ids, actorId, recalculate: false })
          : action === 'recalculate'
            ? await batchCalculateMutation.mutateAsync({ blIds: ids, actorId, recalculate: true })
            : action === 'review'
              ? await batchReviewedMutation.mutateAsync({ blIds: ids, actorId })
              : await batchReadyMutation.mutateAsync({ blIds: ids, actorId })

      if (result.errorCount > 0) {
        const firstError = result.errors[0]
        showToast(
          `Processamento parcial: ${result.successCount}/${result.total}. Primeiro erro em ${firstError.blId}: ${firstError.message}`,
          'info',
        )
      } else {
        showToast(`Processamento concluido para ${result.successCount} B/L(s).`, 'success')
      }

      // Auto-generate invoices for single-BL cases when marking ready for billing
      if (action === 'ready' && result.successCount > 0) {
        const failedIds = new Set(result.errors.map((e) => e.blId))
        const readyBls = (operationsRows ?? []).filter((row) => ids.includes(row.id) && !failedIds.has(row.id))
        let invoiced = 0
        for (const bl of readyBls) {
          if (!bl.customer?.id) continue
          try {
            await createInvoiceFromBls({ blIds: [bl.id], customerId: bl.customer.id, issueNow: true, actorId: user?.id })
            invoiced++
          } catch {
            // Non-fatal: BL is marked ready but invoice will need to be created manually
          }
        }
        if (invoiced > 0) {
          showToast(`${invoiced} fatura(s) gerada(s) automaticamente.`, 'success')
        }
      }

      setSelectedOpsRows([])
    } catch {
      showToast('Falha ao executar processamento em lote.', 'error')
    }
  }

  async function handleApproveQueueItem(queueId: number, customerId?: number | null) {
    if (!customerId) {
      showToast('Nao ha cliente vinculado para aprovacao automatica. Revise o cadastro antes.', 'error')
      return
    }

    try {
      await approveReconciliationMutation.mutateAsync({
        queueId,
        customerId,
        actorId: user?.id ?? null,
      })
      showToast('Reconciliacao aprovada.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao aprovar reconciliacao.', 'error')
    }
  }

  async function handleRejectQueueItem(queueId: number) {
    try {
      await rejectReconciliationMutation.mutateAsync({
        queueId,
        actorId: user?.id ?? null,
      })
      showToast('Reconciliacao rejeitada.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao rejeitar reconciliacao.', 'error')
    }
  }

  async function handleSaveOverride() {
    const customerId = Number(overrideForm.customerId)
    const chargeItemId = Number(overrideForm.chargeItemId)
    const overrideValue = Number(String(overrideForm.overrideValue).replace(',', '.'))

    if (!Number.isInteger(customerId) || customerId <= 0) {
      showToast('Selecione um cliente para salvar o override.', 'error')
      return
    }
    if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
      showToast('Selecione um item de taxa para salvar o override.', 'error')
      return
    }
    if (!Number.isFinite(overrideValue) || overrideValue <= 0) {
      showToast('Informe um valor de override valido (maior que zero).', 'error')
      return
    }
    if (overrideForm.validFrom && overrideForm.validTo && overrideForm.validTo < overrideForm.validFrom) {
      showToast('A vigencia final nao pode ser anterior a vigencia inicial.', 'error')
      return
    }

    setOverrideSaving(true)
    try {
      await saveOverrideMutation.mutateAsync({
        id: overrideForm.id,
        customerId,
        chargeItemId,
        overrideValue,
        validFrom: overrideForm.validFrom || null,
        validTo: overrideForm.validTo || null,
        notes: overrideForm.notes || null,
      })

      showToast(overrideForm.id ? 'Override atualizado com sucesso.' : 'Override criado com sucesso.', 'success')
      setOverrideForm(EMPTY_OVERRIDE_FORM)
    } catch {
      showToast('Falha ao salvar override de cliente.', 'error')
    } finally {
      setOverrideSaving(false)
    }
  }

  function handleEditOverride(id: number) {
    const row = overrideRows?.find((item) => item.id === id)
    if (!row) return

    setOverrideForm({
      id: row.id,
      customerId: String(row.customer_id ?? ''),
      chargeItemId: String(row.charge_item_id ?? ''),
      overrideValue: String(Number(row.override_value ?? 0)),
      validFrom: row.valid_from ?? '',
      validTo: row.valid_to ?? '',
      notes: row.notes ?? '',
    })
  }

  async function handleDeleteOverride(id: number) {
    if (!window.confirm('Excluir este override de cliente?')) return
    setOverrideDeletingId(id)
    try {
      await deleteOverrideMutation.mutateAsync(id)
      showToast('Override removido.', 'success')
      if (overrideForm.id === id) {
        setOverrideForm(EMPTY_OVERRIDE_FORM)
      }
    } catch {
      showToast('Falha ao remover override.', 'error')
    } finally {
      setOverrideDeletingId(null)
    }
  }

  async function handleSaveTable() {
    if (!tableForm.name.trim()) {
      showToast('Informe o nome da tabela.', 'error')
      return
    }
    if (!tableForm.pod.trim()) {
      showToast('Informe o POD da tabela.', 'error')
      return
    }
    if (!tableForm.validFrom) {
      showToast('Informe a vigencia inicial da tabela.', 'error')
      return
    }
    if (tableForm.validTo && tableForm.validTo < tableForm.validFrom) {
      showToast('Vigencia final nao pode ser anterior a inicial.', 'error')
      return
    }

    try {
      const savedTableId = await saveChargeTableMutation.mutateAsync({
        id: tableForm.id,
        name: tableForm.name,
        cargoMode: tableForm.cargoMode,
        pod: tableForm.pod,
        validFrom: tableForm.validFrom,
        validTo: tableForm.validTo || null,
        active: tableForm.active,
        notes: tableForm.notes || null,
      })
      showToast(tableForm.id ? 'Tabela atualizada.' : 'Tabela criada.', 'success')
      setTableForm(EMPTY_TABLE_FORM)
      setTableItemForm((current) => ({
        ...current,
        chargeTableId: String(tableForm.id ?? savedTableId),
      }))
    } catch {
      showToast('Falha ao salvar tabela.', 'error')
    }
  }

  function handleEditTable(id: number) {
    const table = (tables ?? []).find((row) => row.id === id)
    if (!table) return
    setTableForm({
      id: table.id,
      name: table.name ?? '',
      cargoMode: (table.cargo_mode ?? 'container') as 'container' | 'carga_solta',
      pod: table.pod ?? '',
      validFrom: table.valid_from,
      validTo: table.valid_to ?? '',
      active: Boolean(table.active),
      notes: table.notes ?? '',
    })
    setTableItemForm((current) => ({
      ...current,
      chargeTableId: String(table.id),
    }))
  }

  async function handleToggleTableActive(id: number, current: boolean | null) {
    const nextActive = current !== true
    try {
      await setChargeTableActiveMutation.mutateAsync({ id, active: nextActive })
      showToast(nextActive ? 'Tabela ativada.' : 'Tabela inativada.', 'success')
    } catch {
      showToast('Falha ao alterar status da tabela.', 'error')
    }
  }

  async function handleSaveTableItem() {
    const chargeTableId = Number(tableItemForm.chargeTableId)
    const unitValue = Number(String(tableItemForm.unitValue).replace(',', '.'))
    const sortOrder = Number(tableItemForm.sortOrder)

    if (!Number.isInteger(chargeTableId) || chargeTableId <= 0) {
      showToast('Selecione a tabela do item.', 'error')
      return
    }
    if (!tableItemForm.name.trim()) {
      showToast('Informe o nome do item de taxa.', 'error')
      return
    }
    if (!Number.isFinite(unitValue) || unitValue < 0) {
      showToast('Valor unitario invalido.', 'error')
      return
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      showToast('Sort order invalido.', 'error')
      return
    }

    try {
      await saveChargeTableItemMutation.mutateAsync({
        id: tableItemForm.id,
        chargeTableId,
        name: tableItemForm.name,
        category: tableItemForm.category,
        applicationBasis: tableItemForm.applicationBasis,
        cargoProfile: tableItemForm.cargoProfile,
        currency: tableItemForm.currency,
        unitValue,
        manualOnly: tableItemForm.manualOnly,
        active: tableItemForm.active,
        sortOrder,
      })
      showToast(tableItemForm.id ? 'Item de taxa atualizado.' : 'Item de taxa criado.', 'success')
      setTableItemForm(EMPTY_TABLE_ITEM_FORM)
    } catch {
      showToast('Falha ao salvar item de taxa.', 'error')
    }
  }

  function handleEditTableItem(tableId: number, itemId: number) {
    const table = (tables ?? []).find((row) => row.id === tableId)
    const item = table?.charge_table_items.find((row) => row.id === itemId)
    if (!table || !item) return

    const unitValue = item.currency === 'USD' ? Number(item.unit_value_usd ?? 0) : Number(item.unit_value_brl ?? 0)
    setTableItemForm({
      id: item.id,
      chargeTableId: String(table.id),
      name: item.name ?? '',
      category: (item.category === 'other_charge' ? 'other_charge' : 'base') as 'base' | 'other_charge',
      applicationBasis: (item.application_basis ?? 'bl') as 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu',
      cargoProfile: (item.cargo_profile ?? 'any') as 'standard' | 'imo' | 'oog' | 'any',
      currency: (item.currency === 'USD' ? 'USD' : 'BRL') as 'BRL' | 'USD',
      unitValue: String(unitValue),
      manualOnly: Boolean(item.manual_only),
      active: Boolean(item.active),
      sortOrder: String(Number(item.sort_order ?? 100)),
    })
  }

  async function handleDeleteTableItem(itemId: number) {
    if (!window.confirm('Excluir este item de taxa?')) return
    try {
      await deleteChargeTableItemMutation.mutateAsync(itemId)
      showToast('Item de taxa removido.', 'success')
      if (tableItemForm.id === itemId) {
        setTableItemForm(EMPTY_TABLE_ITEM_FORM)
      }
    } catch {
      showToast('Falha ao remover item de taxa. Pode haver calculos vinculados.', 'error')
    }
  }

  function handlePrepareTableItem(tableId: number) {
    setTableItemForm({
      ...EMPTY_TABLE_ITEM_FORM,
      chargeTableId: String(tableId),
    })
  }

  return (
    <>
      <PageHeader
        title="Taxas Locais"
        description="Motor de calculo por POD/cargo mode, overrides por cliente e pendencias de revisao."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {canManageTables ? <TabButton active={tab === 'tabelas'} label="Tabelas" onClick={() => setTab('tabelas')} /> : null}
        {canManageOverrides ? <TabButton active={tab === 'overrides'} label="Overrides" onClick={() => setTab('overrides')} /> : null}
        <TabButton active={tab === 'pendencias'} label="Operacao" onClick={() => setTab('pendencias')} />
      </div>

      {tab === 'tabelas' && canManageTables ? (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
              <div className="app-table__cell-stack">
                <div className="text-base font-semibold text-white">Filtro e cobertura das tabelas</div>
                <div className="app-table__cell-meta">
                  Refine por modo e POD antes de editar estrutura tarifaria ou publicar novos itens.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="green">{tableSummary.active} ativa(s)</Badge>
                <Badge tone="blue">{tableSummary.items} item(ns)</Badge>
                <Badge tone="slate">{tableSummary.manualOnly} manual(is)</Badge>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Modo de carga">
                <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as '' | 'container' | 'carga_solta')}>
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
                </Select>
              </Field>
              <Field label="POD">
                <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
              </Field>
              <MetricCard label="Tabelas" value={String(tableSummary.tables)} />
              <MetricCard label="Itens ativos" value={String(tableSummary.items - tableSummary.manualOnly)} />
            </div>
          </Card>

          <div className="mb-5 grid gap-5 xl:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="app-table__cell-stack">
                  <h3 className="text-base font-semibold text-white">{tableForm.id ? 'Editar tabela' : 'Nova tabela'}</h3>
                  <div className="app-table__cell-meta">Defina o escopo principal da tarifa antes de publicar itens.</div>
                </div>
                {tableForm.id ? (
                  <Button variant="ghost" type="button" onClick={() => setTableForm(EMPTY_TABLE_FORM)}>
                    <X size={15} />
                    Cancelar edicao
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Nome da tabela">
                  <Input
                    value={tableForm.name}
                    onChange={(event) => setTableForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ex: Vitoria CNTR 2026"
                  />
                </Field>
                <Field label="Modo de carga">
                  <Select
                    value={tableForm.cargoMode}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        cargoMode: event.target.value as 'container' | 'carga_solta',
                      }))
                    }
                  >
                    <option value="container">Container</option>
                    <option value="carga_solta">Carga Solta</option>
                  </Select>
                </Field>
                <Field label="POD">
                  <Input
                    value={tableForm.pod}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        pod: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="BRVIT / BRSSA"
                  />
                </Field>
                <Field label="Ativa">
                  <Select
                    value={tableForm.active ? '1' : '0'}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        active: event.target.value === '1',
                      }))
                    }
                  >
                    <option value="1">Sim</option>
                    <option value="0">Nao</option>
                  </Select>
                </Field>
                <Field label="Vigencia inicial">
                  <Input
                    type="date"
                    value={tableForm.validFrom}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        validFrom: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Vigencia final">
                  <Input
                    type="date"
                    value={tableForm.validTo}
                    onChange={(event) =>
                      setTableForm((current) => ({
                        ...current,
                        validTo: event.target.value,
                      }))
                    }
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Observacoes">
                    <Textarea
                      value={tableForm.notes}
                      onChange={(event) =>
                        setTableForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Escopo da tabela, versao, premissas"
                    />
                  </Field>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={handleSaveTable} loading={saveChargeTableMutation.isPending}>
                  <Save size={15} />
                  {tableForm.id ? 'Salvar tabela' : 'Criar tabela'}
                </Button>
              </div>
            </Card>

            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="app-table__cell-stack">
                  <h3 className="text-base font-semibold text-white">{tableItemForm.id ? 'Editar item de taxa' : 'Novo item de taxa'}</h3>
                  <div className="app-table__cell-meta">Mantenha a granularidade da regra aqui, sem inflar a grade principal.</div>
                </div>
                {tableItemForm.id ? (
                  <Button variant="ghost" type="button" onClick={() => setTableItemForm(EMPTY_TABLE_ITEM_FORM)}>
                    <X size={15} />
                    Cancelar edicao
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tabela">
                  <Select
                    value={tableItemForm.chargeTableId}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        chargeTableId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecione</option>
                    {(tables ?? []).map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'} | {table.pod ?? '-'} | {table.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nome do item">
                  <Input
                    value={tableItemForm.name}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="THD / BL Fee / ISPS"
                  />
                </Field>
                <Field label="Categoria">
                  <Select
                    value={tableItemForm.category}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        category: event.target.value as 'base' | 'other_charge',
                      }))
                    }
                  >
                    <option value="base">Base</option>
                    <option value="other_charge">Other charge</option>
                  </Select>
                </Field>
                <Field label="Base de aplicacao">
                  <Select
                    value={tableItemForm.applicationBasis}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        applicationBasis: event.target.value as 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu',
                      }))
                    }
                  >
                    <option value="bl">B/L</option>
                    <option value="container_distinct_voyage">Container distinto por viagem</option>
                    <option value="weight_ton">Tonelada</option>
                    <option value="teu">TEU</option>
                  </Select>
                </Field>
                <Field label="Perfil">
                  <Select
                    value={tableItemForm.cargoProfile}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        cargoProfile: event.target.value as 'standard' | 'imo' | 'oog' | 'any',
                      }))
                    }
                  >
                    <option value="any">Qualquer</option>
                    <option value="standard">Padrao</option>
                    <option value="imo">IMO</option>
                    <option value="oog">OOG</option>
                  </Select>
                </Field>
                <Field label="Moeda">
                  <Select
                    value={tableItemForm.currency}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        currency: event.target.value as 'BRL' | 'USD',
                      }))
                    }
                  >
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
                <Field label="Valor unitario">
                  <Input
                    value={tableItemForm.unitValue}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        unitValue: event.target.value,
                      }))
                    }
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Sort order">
                  <Input
                    value={tableItemForm.sortOrder}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        sortOrder: event.target.value,
                      }))
                    }
                    placeholder="100"
                  />
                </Field>
                <Field label="Manual only">
                  <Select
                    value={tableItemForm.manualOnly ? '1' : '0'}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        manualOnly: event.target.value === '1',
                      }))
                    }
                  >
                    <option value="0">Nao</option>
                    <option value="1">Sim</option>
                  </Select>
                </Field>
                <Field label="Ativo">
                  <Select
                    value={tableItemForm.active ? '1' : '0'}
                    onChange={(event) =>
                      setTableItemForm((current) => ({
                        ...current,
                        active: event.target.value === '1',
                      }))
                    }
                  >
                    <option value="1">Sim</option>
                    <option value="0">Nao</option>
                  </Select>
                </Field>
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={handleSaveTableItem} loading={saveChargeTableItemMutation.isPending}>
                  <Save size={15} />
                  {tableItemForm.id ? 'Salvar item' : 'Criar item'}
                </Button>
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            {tablesError ? (
              <div className="p-5 text-sm text-amber-200">
                Nao foi possivel consultar tabelas de taxas locais. Se voce for operador, este acesso pode estar restrito por role.
              </div>
            ) : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[860px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Tabela</th>
                    <th className="px-4 py-3">Modo</th>
                    <th className="px-4 py-3">POD</th>
                    <th className="px-4 py-3">Vigencia</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Itens</th>
                    <th className="px-4 py-3">Acoes</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {tablesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                        Carregando tabelas...
                      </td>
                    </tr>
                  ) : null}
                  {!tablesLoading && (tables?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <EmptyState title="Nenhuma tabela encontrada." />
                      </td>
                    </tr>
                  ) : null}
                  {tables?.map((table) => {
                    const isExpanded = expandedTableId === table.id
                    const autoCount = table.charge_table_items?.filter((i) => !i.manual_only).length ?? 0
                    const manualCount = table.charge_table_items?.filter((i) => i.manual_only).length ?? 0
                    return (
                      <>
                        <tr key={table.id} className={isExpanded ? 'bg-[#161b22]' : undefined}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-white">{table.name}</div>
                            {table.notes ? <div className="mt-0.5 text-xs text-slate-400">{table.notes}</div> : null}
                          </td>
                          <td className="px-4 py-3">{table.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container'}</td>
                          <td className="px-4 py-3">{table.pod ?? '-'}</td>
                          <td className="px-4 py-3">
                            {table.valid_from}{table.valid_to ? ` até ${table.valid_to}` : ' (aberta)'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={table.active ? 'green' : 'slate'}>{table.active ? 'Ativa' : 'Inativa'}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Badge tone="blue">{autoCount} auto</Badge>
                              {manualCount > 0 ? <Badge tone="yellow">{manualCount} manual</Badge> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                className="app-table__icon-button"
                                type="button"
                                onClick={() => handleEditTable(table.id)}
                                aria-label="Editar tabela"
                                title="Editar tabela"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                className="app-table__icon-button"
                                type="button"
                                onClick={() => handlePrepareTableItem(table.id)}
                                aria-label="Novo item nesta tabela"
                                title="Novo item nesta tabela"
                              >
                                <Plus size={13} />
                              </button>
                              <button
                                className={`app-table__icon-button ${table.active ? 'app-table__icon-button--danger' : ''}`}
                                type="button"
                                onClick={() => handleToggleTableActive(table.id, table.active)}
                                aria-label={table.active ? 'Inativar tabela' : 'Ativar tabela'}
                                title={table.active ? 'Inativar tabela' : 'Ativar tabela'}
                                disabled={setChargeTableActiveMutation.isPending}
                              >
                                {table.active ? <X size={13} /> : <Save size={13} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => setExpandedTableId(isExpanded ? null : table.id)}
                              title={isExpanded ? 'Recolher itens' : 'Ver itens'}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr key={`${table.id}-items`} className="bg-[#0d1117]">
                            <td colSpan={8} className="px-6 py-3">
                              {(table.charge_table_items?.length ?? 0) === 0 ? (
                                <div className="py-4 text-center text-sm text-slate-400">Nenhum item cadastrado nesta tabela.</div>
                              ) : (
                                <table className="w-full text-left text-sm">
                                  <thead className="text-xs uppercase tracking-wider text-slate-500">
                                    <tr>
                                      <th className="py-2 pr-4">Item</th>
                                      <th className="py-2 pr-4">Perfil</th>
                                      <th className="py-2 pr-4">Base</th>
                                      <th className="py-2 pr-4">Moeda</th>
                                      <th className="py-2 pr-4 text-right">Valor</th>
                                      <th className="py-2 pr-4">Tipo</th>
                                      <th className="py-2"></th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#30363d]">
                                    {table.charge_table_items?.map((item) => (
                                      <tr key={item.id}>
                                        <td className="py-2 pr-4 font-medium text-white">
                                          {item.name}
                                          {!item.active ? <span className="ml-2 text-xs text-slate-500">(inativo)</span> : null}
                                        </td>
                                        <td className="py-2 pr-4 text-slate-400">{item.cargo_profile ?? '-'}</td>
                                        <td className="py-2 pr-4 text-slate-400">{item.application_basis ?? '-'}</td>
                                        <td className="py-2 pr-4 text-slate-400">{item.currency ?? '-'}</td>
                                        <td className="py-2 pr-4 text-right font-semibold text-white">
                                          {item.currency === 'USD' ? formatUSD(item.unit_value_usd ?? 0) : formatBRL(item.unit_value_brl ?? 0)}
                                        </td>
                                        <td className="py-2 pr-4">
                                          {item.manual_only ? <Badge tone="yellow">Manual</Badge> : <Badge tone="blue">Auto</Badge>}
                                        </td>
                                        <td className="py-2">
                                          <div className="flex items-center gap-1">
                                            <button
                                              className="app-table__icon-button"
                                              type="button"
                                              onClick={() => handleEditTableItem(table.id, item.id)}
                                              title="Editar item"
                                            >
                                              <Pencil size={13} />
                                            </button>
                                            <button
                                              className="app-table__icon-button app-table__icon-button--danger"
                                              type="button"
                                              onClick={() => handleDeleteTableItem(item.id)}
                                              disabled={deleteChargeTableItemMutation.isPending}
                                              title="Excluir item"
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'pendencias' ? (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
              <div className="app-table__cell-stack">
                <div className="text-base font-semibold text-white">Filtro operacional</div>
                <div className="app-table__cell-meta">Trabalhe bloqueios, reconciliacao e prontidao de faturamento sobre a mesma base filtrada.</div>
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
                  onChange={(event) => updateOpsFilter('cargoMode', event.target.value as LocalChargeOpsFilters['cargoMode'])}
                >
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
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
                    updateOpsFilter('chargeStatus', event.target.value as LocalChargeOpsFilters['chargeStatus'])
                  }
                >
                  <option value="">Todos</option>
                  <option value="not_calculated">Nao calculado</option>
                  <option value="calculated">Calculado</option>
                  <option value="review_required">Revisao</option>
                  <option value="reviewed">Revisado</option>
                  <option value="ready_for_billing">Pronto faturar</option>
                  <option value="exempt">Isento</option>
                </Select>
              </Field>
              <div className="grid gap-1 rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase tracking-wider text-slate-500">Selecionados</div>
                <div className="text-2xl font-bold text-white">{selectedOpsRows.length}</div>
                <div className="text-xs text-slate-400">Acoes em lote por selecao manual</div>
              </div>
            </div>
          </Card>

          <Card className="mb-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-white">Fila de prioridades</div>
                <div className="text-sm text-slate-400">Clique em um passo para filtrar a grade abaixo.</div>
              </div>
              {pipelineBottleneck === null && !operationsLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-green-800 bg-green-950/40 px-4 py-2">
                  <CheckCircle size={16} className="text-green-400" />
                  <span className="text-sm font-medium text-green-300">Tudo em dia</span>
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <PipelineStep
                number={1}
                label="Reconciliacao"
                count={operationsSummary.reconciliationPending}
                isBottleneck={pipelineBottleneck === 'reconciliation'}
                active={reconciliationFilter}
                onClick={() => handlePipelineStep('reconciliation')}
              />
              <PipelineStep
                number={2}
                label="Nao calculados"
                count={operationsSummary.notCalculated}
                isBottleneck={pipelineBottleneck === 'not_calculated'}
                active={opsFilters.chargeStatus === 'not_calculated' && !reconciliationFilter}
                onClick={() => handlePipelineStep('not_calculated')}
              />
              <PipelineStep
                number={3}
                label="Em revisao"
                count={operationsSummary.reviewRequired}
                isBottleneck={pipelineBottleneck === 'review_required'}
                active={opsFilters.chargeStatus === 'review_required' && !reconciliationFilter}
                onClick={() => handlePipelineStep('review_required')}
              />
              <PipelineStep
                number={4}
                label="Revisados"
                count={operationsSummary.reviewed}
                isBottleneck={pipelineBottleneck === 'reviewed'}
                active={opsFilters.chargeStatus === 'reviewed' && !reconciliationFilter}
                onClick={() => handlePipelineStep('reviewed')}
              />
              <PipelineStep
                number={5}
                label="Pronto faturar"
                count={operationsSummary.ready}
                isBottleneck={pipelineBottleneck === 'ready_for_billing'}
                active={opsFilters.chargeStatus === 'ready_for_billing' && !reconciliationFilter}
                onClick={() => handlePipelineStep('ready_for_billing')}
              />
            </div>
          </Card>

          <Card className="mb-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => runBatchOperation('calculate')}
                loading={batchCalculateMutation.isPending}
                disabled={batchReviewedMutation.isPending || batchReadyMutation.isPending}
              >
                <Calculator size={15} />
                Calcular selecionados
              </Button>
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
                Marcar revisados
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
              <span className="text-xs text-slate-500">{selectedOpsRows.length} B/L(s) selecionado(s)</span>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {operationsError ? <InlineError message="Falha ao carregar operacao de taxas locais." /> : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[1100px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">
                      <button className="app-table__icon-button" type="button" onClick={toggleAllOpsRows} title="Selecionar todos">
                        {areAllOpsRowsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </th>
                    <th className="px-4 py-3">B/L</th>
                    <th className="px-4 py-3">Modo</th>
                    <th className="px-4 py-3">Navio/Viagem</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Reconcil.</th>
                    <th className="px-4 py-3">Subtotal BRL</th>
                    <th className="px-4 py-3">Bloqueio</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {operationsLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={10}>
                        Carregando operacao...
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
                      <>
                        <tr key={row.id} className={isExpanded ? 'bg-[#161b22]' : undefined}>
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
                          <td className="px-4 py-3 font-semibold text-[#58a6ff]">{row.id}</td>
                          <td className="px-4 py-3">{row.cargo_mode === 'carga_solta' ? 'Carga Solta' : 'Container'}</td>
                          <td className="px-4 py-3">{row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}</td>
                          <td className="px-4 py-3">{renderChargeStatus(row.charge_status)}</td>
                          <td className="px-4 py-3">{row.customer?.name ?? '-'}</td>
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
                          <tr key={`${row.id}-detail`} className="bg-[#0d1117]">
                            <td colSpan={10} className="px-6 py-4">
                              <div className="grid gap-4 xl:grid-cols-2">
                                <div className="grid gap-3">
                                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Detalhes</div>
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                                    <div>
                                      <div className="text-slate-500">Trecho</div>
                                      <div className="text-white">{row.pol ?? '-'} → {row.pod ?? '-'}</div>
                                    </div>
                                    <div>
                                      <div className="text-slate-500">Linhas</div>
                                      <div className="text-white">
                                        {Number(row.totals.line_count).toLocaleString('pt-BR')}
                                        {row.totals.review_required_count > 0 ? (
                                          <span className="ml-2 text-xs text-amber-300">rev: {row.totals.review_required_count}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-slate-500">Subtotal USD</div>
                                      <div className="text-white">{formatUSD(row.totals.total_usd)}</div>
                                    </div>
                                    <div>
                                      <div className="text-slate-500">Billing run</div>
                                      <div className="text-white">{row.last_billing_run_id ?? '-'}</div>
                                    </div>
                                    <div>
                                      <div className="text-slate-500">Ult. calculo</div>
                                      <div className="text-white">{formatDate(row.charges_calculated_at)}</div>
                                    </div>
                                    <div>
                                      <div className="text-slate-500">Ult. revisao</div>
                                      <div className="text-white">{formatDate(row.charges_reviewed_at)}</div>
                                    </div>
                                    <div className="col-span-2">
                                      <div className="text-slate-500">Ult. evento</div>
                                      <div className="text-white">{row.trail.last_event_field ?? '-'} | {formatDate(row.trail.last_event_at)}</div>
                                    </div>
                                  </div>
                                  <div className="mt-1">
                                    <Link className="app-table__action" to={`/manifestos/${row.id}`}>
                                      Abrir B/L →
                                    </Link>
                                  </div>
                                </div>
                                {reconciliationPending && queueItem ? (
                                  <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
                                    <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-400">Reconciliacao pendente</div>
                                    <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                      <div>
                                        <div className="text-slate-500">Cliente no manifesto</div>
                                        <div className="text-white">{queueItem.manifest_customer_name ?? '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-slate-500">CNPJ/CPF</div>
                                        <div className="text-white">{queueItem.cnpj_cpf ?? '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-slate-500">Cliente sugerido</div>
                                        <div className="text-white">{queueItem.current_customer_name ?? '-'}</div>
                                      </div>
                                      <div>
                                        <div className="text-slate-500">Deteccao</div>
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
                                  <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
                                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">Reconciliacao pendente</div>
                                    <div className="text-sm text-slate-400">Nenhum item de reconciliacao encontrado na fila para este B/L.</div>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

      {tab === 'overrides' && canManageOverrides ? (
        <>
          <Card className="mb-5">
            <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
              <div className="app-table__cell-stack">
                <div className="text-base font-semibold text-white">Overrides por cliente</div>
                <div className="app-table__cell-meta">Sobrescreva valores pontuais sem contaminar a tabela base.</div>
              </div>
              <Badge tone="blue">{overrideRows?.length ?? 0} override(s) na visao</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Buscar cliente">
                <Input
                  value={overrideCustomerSearch}
                  onChange={(event) => setOverrideCustomerSearch(event.target.value)}
                  placeholder="Razao social ou CNPJ"
                />
              </Field>
              <Field label="Modo de carga">
                <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as '' | 'container' | 'carga_solta')}>
                  <option value="">Todos</option>
                  <option value="container">Container</option>
                  <option value="carga_solta">Carga Solta</option>
                </Select>
              </Field>
              <Field label="POD">
                <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
              </Field>
              <MetricCard label="Overrides encontrados" value={String(overrideRows?.length ?? 0)} />
            </div>
          </Card>

          <Card className="mb-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-white">{overrideForm.id ? 'Editar override' : 'Novo override'}</h3>
              {overrideForm.id ? (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setOverrideForm(EMPTY_OVERRIDE_FORM)}
                >
                  <X size={15} />
                  Cancelar edicao
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Cliente">
                <Select
                  value={overrideForm.customerId}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, customerId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {(overrideCustomers ?? []).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.cnpj_cpf})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Item de taxa">
                <Select
                  value={overrideForm.chargeItemId}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, chargeItemId: event.target.value }))}
                >
                  <option value="">Selecione</option>
                  {(overrideChargeItems ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.charge_table?.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'} | {item.charge_table?.pod ?? '-'} | {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Valor override">
                <Input
                  value={overrideForm.overrideValue}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, overrideValue: event.target.value }))}
                  placeholder="Ex: 1500.00"
                />
              </Field>
              <Field label="Vigencia inicial">
                <Input
                  type="date"
                  value={overrideForm.validFrom}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, validFrom: event.target.value }))}
                />
              </Field>
              <Field label="Vigencia final">
                <Input
                  type="date"
                  value={overrideForm.validTo}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, validTo: event.target.value }))}
                />
              </Field>
              <Field label="Observacoes">
                <Textarea
                  value={overrideForm.notes}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={handleSaveOverride} loading={overrideSaving || saveOverrideMutation.isPending}>
                <Save size={15} />
                {overrideForm.id ? 'Salvar override' : 'Criar override'}
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {overridesError ? <InlineError message="Falha ao consultar overrides." /> : null}
            <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
                <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Taxa</th>
                    <th className="px-4 py-3">Modo/POD</th>
                    <th className="px-4 py-3">Vigencia</th>
                    <th className="px-4 py-3">Valor base</th>
                    <th className="px-4 py-3">Override</th>
                    <th className="px-4 py-3">Obs</th>
                    <th className="px-4 py-3">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]">
                  {overridesLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-400" colSpan={8}>
                        Carregando overrides...
                      </td>
                    </tr>
                  ) : null}
                  {!overridesLoading && (overrideRows?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <EmptyState title="Nenhum override encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {overrideRows?.map((row) => {
                    const currency = row.charge_item?.currency ?? 'BRL'
                    const baseValue =
                      currency === 'USD'
                        ? Number(row.charge_item?.unit_value_usd ?? 0)
                        : Number(row.charge_item?.unit_value_brl ?? 0)
                    const today = new Date().toISOString().slice(0, 10)
                    const validFrom = row.valid_from
                    const validTo = row.valid_to
                    const overrideStatus: 'ativa' | 'futura' | 'vencida' | 'aberta' =
                      !validFrom && !validTo
                        ? 'aberta'
                        : validTo && today > validTo
                          ? 'vencida'
                          : validFrom && today < validFrom
                            ? 'futura'
                            : 'ativa'
                    const statusStyle = {
                      ativa: 'text-emerald-400',
                      aberta: 'text-emerald-400',
                      futura: 'text-blue-400',
                      vencida: 'text-slate-500 line-through',
                    }[overrideStatus]
                    return (
                      <tr key={row.id} className={overrideStatus === 'vencida' ? 'opacity-60' : undefined}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-white">{row.customer?.name ?? '-'}</div>
                          <div className="text-xs text-slate-400">{row.customer?.cnpj_cpf ?? '-'}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-white">{row.charge_item?.name ?? '-'}</td>
                        <td className="px-4 py-3">
                          {(row.charge_item?.charge_table?.cargo_mode ?? '').toUpperCase()} / {row.charge_item?.charge_table?.pod ?? '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className={`text-xs font-medium uppercase tracking-wide ${statusStyle}`}>
                            {overrideStatus}
                          </div>
                          <div className="text-xs text-slate-400">
                            {validFrom ?? '-'}{validTo ? ` ate ${validTo}` : validFrom ? ' (aberta)' : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">{currency === 'USD' ? formatUSD(baseValue) : formatBRL(baseValue)}</td>
                        <td className="px-4 py-3 font-semibold text-green-300">
                          {currency === 'USD' ? formatUSD(Number(row.override_value ?? 0)) : formatBRL(Number(row.override_value ?? 0))}
                        </td>
                        <td className="px-4 py-3">{row.notes ?? '-'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => handleEditOverride(row.id)}
                              aria-label="Editar override"
                              title="Editar override"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="app-table__icon-button app-table__icon-button--danger"
                              type="button"
                              onClick={() => handleDeleteOverride(row.id)}
                              aria-label="Excluir override"
                              title="Excluir override"
                              disabled={overrideDeletingId === row.id}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}

    </>
  )
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`app-tab ${active ? 'app-tab--active' : ''}`} onClick={onClick} type="button">
      {label}
    </button>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </Card>
  )
}

function renderChargeStatus(status: string | null) {
  if (status === 'review_required') return <Badge tone="yellow">Revisao</Badge>
  if (status === 'ready_for_billing') return <Badge tone="green">Pronto</Badge>
  if (status === 'reviewed') return <Badge tone="green">Revisado</Badge>
  if (status === 'exempt') return <Badge tone="slate">Isento</Badge>
  if (status === 'calculated') return <Badge tone="blue">Calculado</Badge>
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
          ? 'border-[#58a6ff] bg-[#0d1117]'
          : isBottleneck && count > 0
            ? 'border-amber-600 bg-amber-950/20 hover:border-amber-500'
            : count === 0
              ? 'cursor-default border-[#30363d] bg-[#0d1117] opacity-40'
              : 'border-[#30363d] bg-[#0d1117] hover:border-[#58a6ff]'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
            active
              ? 'bg-[#58a6ff] text-[#0d1117]'
              : isBottleneck && count > 0
                ? 'bg-amber-500 text-[#0d1117]'
                : 'bg-[#30363d] text-slate-400'
          }`}
        >
          {number}
        </span>
        <span className="text-xs font-medium text-slate-400">{label}</span>
      </div>
      <div
        className={`text-2xl font-bold ${
          active ? 'text-[#58a6ff]' : isBottleneck && count > 0 ? 'text-amber-400' : count === 0 ? 'text-slate-600' : 'text-white'
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
