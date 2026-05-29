import type { ConsolidatableReceivable } from '../../types/database'

// Only receivables flagged 'eligible' by the ledger can enter a consolidated invoice.
export function isReceivableSelectable(r: Pick<ConsolidatableReceivable, 'eligibility_status'>): boolean {
  return r.eligibility_status === 'eligible'
}

export type ConsolidationSummary = {
  selectedCount: number
  eligibleCount: number
  total: number
}

export function summarizeConsolidation(
  rows: ConsolidatableReceivable[],
  selectedIds: number[],
): ConsolidationSummary {
  const selectedRows = rows.filter((r) => selectedIds.includes(r.receivable_id))
  return {
    selectedCount: selectedRows.length,
    eligibleCount: rows.filter(isReceivableSelectable).length,
    total: selectedRows.reduce((s, r) => s + Number(r.balance_brl ?? 0), 0),
  }
}
