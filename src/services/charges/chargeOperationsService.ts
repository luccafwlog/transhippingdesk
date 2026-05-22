import { supabase } from '../supabase'

export type LocalChargeLine = {
  id: number
  bl_id: string
  charge_table_id: number | null
  charge_item_id: number | null
  charge_name: string
  source: 'auto' | 'manual' | null
  status: 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt' | null
  quantity: number | null
  currency: string | null
  unit_value_brl: number | null
  unit_value_usd: number | null
  total_value_brl: number | null
  total_value_usd: number | null
  override_applied: boolean | null
  calculation_key: string | null
  notes: string | null
  review_reason: string | null
  calculated_at: string | null
}

export type ManualChargeItemForBl = {
  charge_item_id: number
  charge_item_name: string
  charge_table_id: number
  charge_table_name: string
  cargo_mode: string
  pod: string
  currency: string
  default_unit_value_brl: number | null
  default_unit_value_usd: number | null
  effective_unit_value_brl: number | null
  effective_unit_value_usd: number | null
}

export type LocalChargeCalculationResult = {
  bl_id: string
  status: 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  table_id: number | null
  line_count: number
  total_brl: number
  total_usd: number
  review_required: boolean
  exempt: boolean
  reason: string
}

export type LocalChargePendencyItem = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | null
  pol: string | null
  pod: string | null
  charge_status: string | null
  charge_exemption_reason: string | null
  charges_calculated_at: string | null
  created_at: string | null
  voyage?: {
    voyage_number: string
    vessel?: { name: string | null } | null
  } | null
  customer?: {
    name: string | null
  } | null
}

export type LocalChargeOperationalFilters = {
  search?: string
  cargoMode?: '' | 'container' | 'carga_solta'
  pod?: string
  voyageId?: number | null
  chargeStatus?: '' | 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  limit?: number
}

export type LocalChargeOperationalRow = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | null
  pol: string | null
  pod: string | null
  charge_status: string | null
  customer_reconciliation_status: string | null
  customer_reconciliation_notes: string | null
  billing_hold_reason: string | null
  last_billing_run_id: number | null
  charge_exemption_reason: string | null
  charges_calculated_at: string | null
  charges_reviewed_at: string | null
  created_at: string | null
  voyage?: {
    id: number
    voyage_number: string
    vessel?: {
      name: string | null
    } | null
  } | null
  customer?: {
    id: number
    name: string | null
    cnpj_cpf: string | null
  } | null
  totals: {
    total_brl: number
    total_usd: number
    line_count: number
    review_required_count: number
  }
  trail: {
    last_event_at: string | null
    last_event_by: string | null
    last_event_field: string | null
    last_event_message: string | null
  }
}

export type BillingRunSummary = {
  id: number
  manifest_id: number
  filename: string
  trigger_source: string
  status: 'running' | 'completed' | 'completed_with_blocks' | 'failed'
  started_at: string
  completed_at: string | null
  total_bls: number
  eligible_bls: number
  blocked_bls: number
  calculated_bls: number
  total_brl: number
  total_usd: number
}

export type BillingRunDetail = {
  run: BillingRunSummary & {
    summary?: Record<string, unknown>
  }
  logs: Array<{
    id: number
    billing_run_id: number
    manifest_id: number
    bl_id: string | null
    level: 'info' | 'warning' | 'error'
    code: string
    message: string
    details: Record<string, unknown> | null
    created_at: string
  }>
}

export async function calculateBlLocalCharges(
  blId: string,
  options?: {
    actorId?: string | null
    recalculate?: boolean
  },
) {
  const { data, error } = await supabase.rpc('calculate_bl_local_charges', {
    p_bl_id: blId,
    p_actor: options?.actorId ?? null,
    p_recalculate: options?.recalculate ?? true,
  })

  if (error) throw error
  return normalizeCalculationResult(data)
}

export async function listBlLocalChargeLines(blId: string) {
  const { data, error } = await supabase.rpc('list_bl_local_charge_lines', {
    p_bl_id: blId,
  })

  if (error) throw error
  return (data ?? []) as LocalChargeLine[]
}

export async function listManualChargeItemsForBl(blId: string) {
  const { data, error } = await supabase.rpc('list_manual_charge_items_for_bl', {
    p_bl_id: blId,
  })

  if (error) throw error
  return (data ?? []) as ManualChargeItemForBl[]
}

export async function listLocalChargePendencies(limit = 100) {
  const { data, error } = await supabase
    .from('bls')
    .select(
      `
      id,
      cargo_mode,
      pol,
      pod,
      charge_status,
      charge_exemption_reason,
      charges_calculated_at,
      created_at,
      voyage:voyages(voyage_number,vessel:vessels(name)),
      customer:customers(name)
    `,
    )
    .in('charge_status', ['review_required', 'not_calculated'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as unknown as LocalChargePendencyItem[]
}

export async function listLocalChargeOperationalRows(filters?: LocalChargeOperationalFilters) {
  const limit = Math.max(50, Math.min(2000, Number(filters?.limit ?? 400)))

  let query = supabase
    .from('bls')
    .select(
      `
      id,
      cargo_mode,
      pol,
      pod,
      charge_status,
      customer_reconciliation_status,
      customer_reconciliation_notes,
      billing_hold_reason,
      last_billing_run_id,
      charge_exemption_reason,
      charges_calculated_at,
      charges_reviewed_at,
      created_at,
      voyage:voyages(id,voyage_number,vessel:vessels(name)),
      customer:customers(id,name,cnpj_cpf)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filters?.cargoMode) {
    query = query.eq('cargo_mode', filters.cargoMode)
  }
  if (filters?.pod) {
    query = query.ilike('pod', `%${filters.pod}%`)
  }
  if (filters?.voyageId) {
    query = query.eq('voyage_id', filters.voyageId)
  }
  if (filters?.chargeStatus) {
    query = query.eq('charge_status', filters.chargeStatus)
  }
  if (filters?.search) {
    const search = filters.search.trim()
    query = query.or(`id.ilike.%${search}%,consignee.ilike.%${search}%`)
  }

  const { data: blRows, error: blError } = await query
  if (blError) throw blError

  const rows = (blRows ?? []) as unknown as LocalChargeOperationalRow[]
  if (rows.length === 0) return []

  const blIds = rows.map((row) => row.id)

  const { data: calcRows, error: calcError } = await supabase
    .from('charge_calculations')
    .select('bl_id,total_value_brl,total_value_usd,status')
    .in('bl_id', blIds)

  if (calcError) throw calcError

  const totalsMap = new Map<
    string,
    { total_brl: number; total_usd: number; line_count: number; review_required_count: number }
  >()

  for (const row of calcRows ?? []) {
    const blId = String(row.bl_id ?? '')
    if (!blId) continue
    const current = totalsMap.get(blId) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 }
    current.total_brl += Number(row.total_value_brl ?? 0)
    current.total_usd += Number(row.total_value_usd ?? 0)
    current.line_count += 1
    if (row.status === 'review_required') {
      current.review_required_count += 1
    }
    totalsMap.set(blId, current)
  }

  const { data: auditRows, error: auditError } = await supabase
    .from('audit_logs')
    .select('id,entity_type,entity_id,field_name,new_value,changed_by,changed_at')
    .in('entity_id', blIds)
    .in('entity_type', ['bl', 'charge_calculation'])
    .order('changed_at', { ascending: false })
    .limit(Math.min(blIds.length * 8, 4000))

  if (auditError && !isPermissionError(auditError)) {
    throw auditError
  }

  const trailMap = new Map<
    string,
    { last_event_at: string | null; last_event_by: string | null; last_event_field: string | null; last_event_message: string | null }
  >()

  for (const row of auditRows ?? []) {
    const entityType = String(row.entity_type ?? '')
    const entityId = String(row.entity_id ?? '')
    if (!entityId) continue

    const targetBlId = entityType === 'bl' ? entityId : extractBlIdFromChargeAuditMessage(String(row.new_value ?? ''), blIds)
    if (!targetBlId || trailMap.has(targetBlId)) continue

    trailMap.set(targetBlId, {
      last_event_at: row.changed_at ?? null,
      last_event_by: row.changed_by ?? null,
      last_event_field: row.field_name ?? null,
      last_event_message: row.new_value ?? null,
    })
  }

  return rows.map((row) => ({
    ...row,
    totals: totalsMap.get(row.id) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 },
    trail:
      trailMap.get(row.id) ?? {
        last_event_at: null,
        last_event_by: null,
        last_event_field: null,
        last_event_message: null,
      },
  }))
}

export async function addManualBlCharge(
  blId: string,
  input: {
    chargeItemId: number
    quantity: number
    notes?: string | null
    actorId?: string | null
  },
) {
  const { data, error } = await supabase.rpc('add_manual_bl_charge', {
    p_bl_id: blId,
    p_charge_item_id: input.chargeItemId,
    p_quantity: input.quantity,
    p_notes: input.notes ?? null,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error
  return data
}

export async function updateManualBlCharge(
  chargeCalculationId: number,
  input: {
    quantity: number
    notes?: string | null
    actorId?: string | null
  },
) {
  const { data, error } = await supabase.rpc('update_manual_bl_charge', {
    p_charge_calculation_id: chargeCalculationId,
    p_quantity: input.quantity,
    p_notes: input.notes ?? null,
    p_actor: input.actorId ?? null,
  })

  if (error) throw error
  return data
}

export async function deleteManualBlCharge(chargeCalculationId: number, actorId?: string | null) {
  const { data, error } = await supabase.rpc('delete_manual_bl_charge', {
    p_charge_calculation_id: chargeCalculationId,
    p_actor: actorId ?? null,
  })

  if (error) throw error
  return data
}

export async function markBlChargesReviewed(blId: string, actorId?: string | null) {
  const { data, error } = await supabase.rpc('mark_bl_charges_reviewed', {
    p_bl_id: blId,
    p_actor: actorId ?? null,
  })

  if (error) throw error
  return data
}

export async function markBlReadyForBilling(blId: string, actorId?: string | null) {
  const { data, error } = await supabase.rpc('mark_bl_ready_for_billing', {
    p_bl_id: blId,
    p_actor: actorId ?? null,
  })

  if (error) throw error
  return data
}

export async function calculateLocalChargesBatch(
  blIds: string[],
  options?: {
    actorId?: string | null
    recalculate?: boolean
  },
) {
  return runBatch(blIds, (blId) => calculateBlLocalCharges(blId, options))
}

export async function markLocalChargesReviewedBatch(blIds: string[], actorId?: string | null) {
  return runBatch(blIds, (blId) => markBlChargesReviewed(blId, actorId))
}

export async function markLocalChargesReadyBatch(blIds: string[], actorId?: string | null) {
  return runBatch(blIds, (blId) => markBlReadyForBilling(blId, actorId))
}

export async function listBillingRuns(limit = 50) {
  const { data, error } = await supabase.rpc('list_billing_runs', {
    p_limit: limit,
  })

  if (error) throw error
  return (data ?? []) as BillingRunSummary[]
}

export async function getBillingRunDetails(billingRunId: number) {
  const { data, error } = await supabase.rpc('get_billing_run_details', {
    p_billing_run_id: billingRunId,
  })

  if (error) throw error
  const payload = (data ?? {}) as BillingRunDetail
  return {
    run: payload.run ?? null,
    logs: payload.logs ?? [],
  } as BillingRunDetail
}

function normalizeCalculationResult(data: unknown): LocalChargeCalculationResult {
  const payload = (data ?? {}) as Record<string, unknown>
  return {
    bl_id: String(payload.bl_id ?? ''),
    status: String(payload.status ?? 'not_calculated') as LocalChargeCalculationResult['status'],
    table_id: payload.table_id === null || payload.table_id === undefined ? null : Number(payload.table_id),
    line_count: Number(payload.line_count ?? 0),
    total_brl: Number(payload.total_brl ?? 0),
    total_usd: Number(payload.total_usd ?? 0),
    review_required: Boolean(payload.review_required),
    exempt: Boolean(payload.exempt),
    reason: String(payload.reason ?? ''),
  }
}

function extractBlIdFromChargeAuditMessage(message: string, candidates: string[]) {
  const normalized = String(message ?? '').toUpperCase()
  for (const candidate of candidates) {
    if (normalized.includes(candidate.toUpperCase())) return candidate
  }
  return null
}

function isPermissionError(error: { code?: string | null; message?: string | null }) {
  return error.code === '42501' || String(error.message ?? '').toLowerCase().includes('permission denied')
}

async function runBatch<T>(blIds: string[], worker: (blId: string) => Promise<T>) {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  const errors: Array<{ blId: string; message: string }> = []
  let successCount = 0

  for (const blId of normalizedIds) {
    try {
      await worker(blId)
      successCount += 1
    } catch (error) {
      errors.push({
        blId,
        message: error instanceof Error ? error.message : 'Erro inesperado no processamento em lote.',
      })
    }
  }

  return {
    total: normalizedIds.length,
    successCount,
    errorCount: errors.length,
    errors,
  }
}
