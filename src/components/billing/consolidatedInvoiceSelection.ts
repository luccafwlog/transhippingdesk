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

export type ReceivableVoyageOption = {
  id: number
  label: string
}

export function listReceivableVoyageOptions(rows: ConsolidatableReceivable[]): ReceivableVoyageOption[] {
  const options = new Map<number, string>()

  for (const row of rows) {
    if (row.voyage_id == null) continue
    if (!['open', 'partially_settled'].includes(row.receivable_status)) continue
    if (Number(row.balance_brl ?? 0) <= 0) continue

    const vessel = row.vessel_name?.trim()
    const voyage = row.voyage_number?.trim()
    options.set(Number(row.voyage_id), [vessel, voyage].filter(Boolean).join(' / ') || `Viagem ${row.voyage_id}`)
  }

  return Array.from(options, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
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
