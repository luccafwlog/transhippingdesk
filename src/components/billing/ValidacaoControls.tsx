import { CheckCircle, CheckSquare, Download, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import type { BatchOperation, OpsFilters, PipelineStep } from './validacaoTypes'

export function ValidacaoControls({
  filters,
  selectedCount,
  operationsLoading,
  reconciliationPending,
  reviewPending,
  ready,
  readyInvoiced,
  readyPendingInvoice,
  pipelineBottleneck,
  reconciliationFilter,
  reviewFilter,
  calculatePending,
  reviewPendingMutation,
  readyPendingMutation,
  exporting,
  onUpdateFilter,
  onPipelineStep,
  onRunBatchOperation,
  onExport,
}: {
  filters: OpsFilters
  selectedCount: number
  operationsLoading: boolean
  reconciliationPending: number
  reviewPending: number
  ready: number
  readyInvoiced: number
  readyPendingInvoice: number
  pipelineBottleneck: PipelineStep | null
  reconciliationFilter: boolean
  reviewFilter: boolean
  calculatePending: boolean
  reviewPendingMutation: boolean
  readyPendingMutation: boolean
  exporting: boolean
  onUpdateFilter: <K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) => void
  onPipelineStep: (step: PipelineStep) => void
  onRunBatchOperation: (action: BatchOperation) => void
  onExport: () => void
}) {
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
              value={filters.search}
              onChange={(event) => onUpdateFilter('search', event.target.value)}
              placeholder="B/L ou cliente"
            />
          </Field>
          <Field label="Modo">
            <Select
              value={filters.cargoMode}
              onChange={(event) => onUpdateFilter('cargoMode', event.target.value as OpsFilters['cargoMode'])}
            >
              <option value="">Todos</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="granito">Granito</option>
            </Select>
          </Field>
          <VoyageCombobox
            clearable
            label="Viagem"
            selectedVoyageId={filters.voyageId}
            onSelect={(id) => onUpdateFilter('voyageId', id == null ? '' : String(id))}
          />
          <Field label="POD">
            <Input
              value={filters.pod}
              onChange={(event) => onUpdateFilter('pod', event.target.value.toUpperCase())}
              placeholder="BRVIT / BRSSA"
            />
          </Field>
          <Field label="Status taxas">
            <Select
              value={filters.chargeStatus}
              onChange={(event) => onUpdateFilter('chargeStatus', event.target.value as OpsFilters['chargeStatus'])}
            >
              <option value="">Todos</option>
              <option value="review_required">Revisão</option>
              <option value="ready_for_billing">Pronto faturar</option>
              <option value="exempt">Isento</option>
            </Select>
          </Field>
          <div className="app-metric-tile">
            <div className="app-metric-tile__label">Selecionados</div>
            <div className="app-metric-tile__value">{selectedCount}</div>
            <div className="app-panel__meta">Ações em lote por seleção manual</div>
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
            count={reconciliationPending}
            isBottleneck={pipelineBottleneck === 'reconciliation'}
            active={reconciliationFilter}
            onClick={() => onPipelineStep('reconciliation')}
          />
          <PipelineStep
            number={2}
            label="Em revisao"
            count={reviewPending}
            isBottleneck={pipelineBottleneck === 'review'}
            active={reviewFilter}
            onClick={() => onPipelineStep('review')}
          />
          <PipelineStep
            number={3}
            label="Pronto faturar"
            count={ready}
            isBottleneck={pipelineBottleneck === 'ready_for_billing'}
            active={filters.chargeStatus === 'ready_for_billing' && !reconciliationFilter && !reviewFilter}
            onClick={() => onPipelineStep('ready_for_billing')}
          />
        </div>
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Pronto faturar: {ready} | Faturado automatico: {readyInvoiced} | Diferenca: {readyPendingInvoice}
        </div>
      </Card>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => onRunBatchOperation('recalculate')}
            loading={calculatePending}
            disabled={reviewPendingMutation || readyPendingMutation}
          >
            <RefreshCw size={15} />
            Recalcular selecionados
          </Button>
          <Button
            variant="secondary"
            onClick={() => onRunBatchOperation('review')}
            loading={reviewPendingMutation}
            disabled={calculatePending || readyPendingMutation}
          >
            <CheckSquare size={15} />
            Aprovar revisao
          </Button>
          <Button
            onClick={() => onRunBatchOperation('ready')}
            loading={readyPendingMutation}
            disabled={calculatePending || reviewPendingMutation}
          >
            <CheckSquare size={15} />
            Marcar pronto faturar
          </Button>
          <Button variant="secondary" onClick={onExport} loading={exporting}>
            <Download size={15} />
            Exportar visao
          </Button>
          <span className="text-xs text-[var(--app-muted)]">{selectedCount} B/L(s) selecionado(s)</span>
        </div>
      </Card>
    </>
  )
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
