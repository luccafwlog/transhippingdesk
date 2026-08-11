import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, ChevronDown, ChevronUp, Square } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { useBlLocalChargeLines } from '../../hooks/useLocalCharges'
import { formatBRL, formatDate } from '../../lib/utils'
import { isChargeReady } from '../../lib/chargeStatus'
import { isCustomerReconciliationResolved } from '../../services/customerReconciliation'
import type { LocalChargeOperationalRow } from '../../services/charges/chargeOperationsService'
import { getBillingBlock, isBlLockedForRecalc } from './validacaoPipeline'

type ReconciliationQueueItem = {
  id: number
  bl_id: string
  customer_id: number | null
  current_customer_name: string | null
  cnpj_cpf: string | null
  manifest_customer_name: string | null
  detection_type: string | null
}

export function ValidacaoOperationsTable({
  rows,
  isLoading,
  hasError,
  selectedRowIds,
  areAllRowsSelected,
  expandedBlId,
  reconciliationQueue,
  approvePending,
  rejectPending,
  onToggleAllRows,
  onToggleRow,
  onToggleExpandedRow,
  onIssueSingleInvoice,
  onRecalculateRow,
  onApproveQueueItem,
  onRejectQueueItem,
}: {
  rows: LocalChargeOperationalRow[]
  isLoading: boolean
  hasError: boolean
  selectedRowIds: string[]
  areAllRowsSelected: boolean
  expandedBlId: string | null
  reconciliationQueue: ReconciliationQueueItem[]
  approvePending: boolean
  rejectPending: boolean
  onToggleAllRows: () => void
  onToggleRow: (blId: string) => void
  onToggleExpandedRow: (blId: string) => void
  onIssueSingleInvoice: (row: LocalChargeOperationalRow) => void
  onRecalculateRow?: (row: LocalChargeOperationalRow) => void
  onApproveQueueItem: (queueId: number, customerId?: number | null) => void
  onRejectQueueItem: (queueId: number) => void
}) {
  return (
    <Card className="overflow-hidden p-0">
      {hasError ? <InlineError message="Falha ao carregar operação de taxas locais." /> : null}
      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[1100px] text-left text-sm whitespace-nowrap">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">
                <button className="app-table__icon-button" type="button" onClick={onToggleAllRows} title="Selecionar todos" aria-label="Selecionar todos os B/Ls">
                  {areAllRowsSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
              </th>
              <th scope="col" className="px-4 py-3">B/L</th>
              <th scope="col" className="px-4 py-3">Motivo</th>
              <th scope="col" className="px-4 py-3">Modo</th>
              <th scope="col" className="px-4 py-3">Navio/Viagem</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Cliente</th>
              <th scope="col" className="px-4 py-3">Reconcil.</th>
              <th scope="col" className="px-4 py-3">Subtotal BRL</th>
              <th scope="col" className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={10}>
                  Carregando operação...
                </td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-0">
                  <EmptyState title="Nenhum B/L encontrado." description="Ajuste os filtros de viagem ou status." />
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const isExpanded = expandedBlId === row.id
              const reconciliationPending = !isCustomerReconciliationResolved(row.customer_reconciliation_status)
              const queueItem = reconciliationPending ? (reconciliationQueue.find((q) => q.bl_id === row.id) ?? null) : null
              const block = getBillingBlock(row)
              const canIssueSingleInvoice = isChargeReady(row.charge_status) && row.financial_status !== 'invoiced' && Boolean(row.customer?.id) && (row.cargo_mode !== 'granito' || Boolean(row.ce_mercante?.trim()))
              return (
                <Fragment key={row.id}>
                  <tr className={isExpanded ? 'bg-[var(--app-surface-muted)]' : undefined}>
                    <td className="px-4 py-3">
                      <button
                        className="app-table__icon-button"
                        type="button"
                        onClick={() => onToggleRow(row.id)}
                        title="Selecionar B/L"
                        aria-label={`Selecionar B/L ${row.id}`}
                      >
                        {selectedRowIds.includes(row.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[var(--app-blue-btn)]">{row.id}</td>
                    <td className="px-4 py-3"><div className="max-w-[360px] whitespace-normal"><Badge tone={block.code === 'aguardando_ce' ? 'slate' : block.code === 'sem_cliente' ? 'yellow' : block.code === 'calculo_incompleto' ? 'red' : 'blue'}>{block.label}</Badge><div className="mt-1 text-xs text-[var(--app-muted)]">{block.detail}</div></div></td>
                    <td className="px-4 py-3">{row.cargo_mode === 'carga_solta' ? 'Carga Solta' : row.cargo_mode === 'granito' ? 'Granito' : 'Container'}</td>
                    <td className="px-4 py-3">{row.voyage?.vessel?.name ?? '-'} / {row.voyage?.voyage_number ?? '-'}</td>
                    <td className="px-4 py-3">{renderChargeStatus(row.charge_status, row.financial_status)}</td>
                    <td className="px-4 py-3"><span className="app-table__truncate app-table__truncate--lg" title={row.customer?.name ?? '-'}>{row.customer?.name ?? '-'}</span></td>
                    <td className="px-4 py-3">{renderReconciliationStatus(row.customer_reconciliation_status)}</td>
                    <td className="px-4 py-3">{formatBRL(row.totals.total_brl)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => onRecalculateRow?.(row)} disabled={isBlLockedForRecalc(row.financial_status)} title={isBlLockedForRecalc(row.financial_status) ? 'B/L já faturado ou financeiramente bloqueado.' : undefined}>
                          Recalcular
                        </Button>
                        {canIssueSingleInvoice ? (
                          <Button variant="secondary" onClick={() => onIssueSingleInvoice(row)}>
                            Emitir
                          </Button>
                        ) : null}
                        <button
                          className="app-table__icon-button"
                          type="button"
                          onClick={() => onToggleExpandedRow(row.id)}
                          title={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                          aria-label={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr key={`${row.id}-detail`} className="bg-[var(--app-surface-muted)]">
                      <td colSpan={10} className="px-6 py-4">
                        <div className="grid gap-4 xl:grid-cols-2">
                          <div className="grid gap-3">
                            {block.detail ? (
                              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Por que não fatura?</div>
                                <div className="mt-0.5">{block.detail}</div>
                              </div>
                            ) : null}
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
                                  onClick={() => onApproveQueueItem(queueItem.id, queueItem.customer_id)}
                                  loading={approvePending}
                                  disabled={!queueItem.customer_id || rejectPending}
                                >
                                  Aprovar
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => onRejectQueueItem(queueItem.id)}
                                  loading={rejectPending}
                                  disabled={approvePending}
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
  if (status === 'review_required') return <Badge tone="yellow">Revisão</Badge>
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
