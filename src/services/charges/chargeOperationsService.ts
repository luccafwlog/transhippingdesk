import { supabase } from '../supabase'
import { escapeFilterTerm, sanitizeLikeTerm } from '../../lib/utils'

const OPERATIONAL_PAGE_SIZE = 1000

type LocalChargeLine = {
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
  cargo_mode: 'container' | 'carga_solta' | 'granito' | null
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
  cargoMode?: '' | 'container' | 'carga_solta' | 'granito'
  pod?: string
  voyageId?: number | null
  chargeStatus?: '' | 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  limit?: number
}

export type LocalChargeOperationalRow = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | 'granito' | null
  pol: string | null
  pod: string | null
  charge_status: string | null
  financial_status: string | null
  review_status: string | null
  notes: string | null
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
export async function calculateBlLocalCharges(
  blId: string,
  options?: {
    actorId?: string | null
    recalculate?: boolean
  },
) {
  const { data, error } = await supabase.rpc('calculate_bl_local_charges', {
    p_bl_id: blId,
    ...(options?.actorId == null ? {} : { p_actor: options.actorId }),
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
      financial_status,
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
    .overrideTypes<LocalChargePendencyItem[], { merge: false }>()

  if (error) throw error
  return data ?? []
}

export async function listLocalChargeOperationalRows(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRow[]> {
  const cargoMode = filters?.cargoMode ?? ''
  const wantBls = cargoMode === '' || cargoMode === 'container' || cargoMode === 'carga_solta'
  const wantGranite = cargoMode === '' || cargoMode === 'granito'

  const [blRows, graniteRows] = await Promise.all([
    wantBls ? loadBlOperationalRows(filters) : Promise.resolve([] as LocalChargeOperationalRow[]),
    wantGranite ? loadGraniteOperationalRows(filters) : Promise.resolve([] as LocalChargeOperationalRow[]),
  ])

  return [...blRows, ...graniteRows]
}

async function loadBlOperationalRows(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRow[]> {
  const limit = Math.max(50, Math.min(5000, Number(filters?.limit ?? 400)))
  const rows: LocalChargeOperationalRow[] = []

  // Pagina internamente a fila operacional para nao ocultar B/Ls em volumes maiores.
  for (let offset = 0; offset < limit; offset += OPERATIONAL_PAGE_SIZE) {
    const pageSize = Math.min(OPERATIONAL_PAGE_SIZE, limit - offset)
    let query = supabase
      .from('bls')
      .select(
        `
        id,
        cargo_mode,
        pol,
        pod,
        charge_status,
        financial_status,
        review_status,
        notes,
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
      .range(offset, offset + pageSize - 1)

    if (filters?.cargoMode === 'container' || filters?.cargoMode === 'carga_solta') {
      query = query.eq('cargo_mode', filters.cargoMode)
    }
    query = query.or('financial_status.is.null,financial_status.neq.invoiced')
    if (filters?.pod) {
      const pod = sanitizeLikeTerm(filters.pod)
      if (pod) query = query.ilike('pod', `%${pod}%`)
    }
    if (filters?.voyageId) {
      query = query.eq('voyage_id', filters.voyageId)
    }
    if (filters?.chargeStatus) {
      query = query.eq('charge_status', filters.chargeStatus)
    }
    if (filters?.search) {
      const search = escapeFilterTerm(filters.search)
      if (search) {
        query = query.or(`id.ilike.%${search}%,consignee.ilike.%${search}%`)
      }
    }

    const { data: blRows, error: blError } = await query.overrideTypes<LocalChargeOperationalRow[], { merge: false }>()
    if (blError) throw blError

    const pageRows = blRows ?? []
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

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

type GraniteOperationalRaw = {
  id: string
  charge_status: string | null
  loading_port: string | null
  discharge_port: string | null
  client_id: number | null
  created_at: string | null
  manifest: {
    voyage: {
      id: number
      voyage_number: string | null
      vessel: { name: string | null } | null
    } | null
  } | null
  customer: { id: number; name: string | null; cnpj_cpf: string | null } | null
}

async function loadGraniteOperationalRows(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRow[]> {
  const limit = Math.max(50, Math.min(5000, Number(filters?.limit ?? 400)))

  // Mapeia o filtro de chargeStatus do mundo bls para o domínio enxuto de granite_bls.
  // granite_bls aceita: not_calculated | calculated | ready_for_billing | invoiced.
  // Filtros bls que não existem em granite (review_required, reviewed, exempt) eliminam o resultado.
  const requested = filters?.chargeStatus ?? ''
  if (requested === 'review_required' || requested === 'reviewed' || requested === 'exempt') {
    return []
  }

  let granRows: GraniteOperationalRaw[] = []

  // Pagina internamente a fila de Granito para manter cobertura em listas grandes.
  for (let offset = 0; offset < limit; offset += OPERATIONAL_PAGE_SIZE) {
    const pageSize = Math.min(OPERATIONAL_PAGE_SIZE, limit - offset)
    let query = supabase
      .from('granite_bls')
      .select(
        `
        id,
        charge_status,
        loading_port,
        discharge_port,
        client_id,
        created_at,
        manifest:granite_manifests(voyage:voyages(id,voyage_number,vessel:vessels(name))),
        customer:customers!granite_bls_client_id_fkey(id,name,cnpj_cpf)
      `,
      )
      .neq('charge_status', 'invoiced')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (requested === 'not_calculated' || requested === 'calculated' || requested === 'ready_for_billing') {
      query = query.eq('charge_status', requested)
    }
    if (filters?.pod) {
      const pod = sanitizeLikeTerm(filters.pod)
      if (pod) query = query.ilike('discharge_port', `%${pod}%`)
    }
    if (filters?.search) {
      const search = escapeFilterTerm(filters.search)
      if (search) {
        query = query.or(`bl_number.ilike.%${search}%,shipper_name.ilike.%${search}%`)
      }
    }

    const { data, error } = await query.overrideTypes<GraniteOperationalRaw[], { merge: false }>()
    if (error) throw error

    const pageRows = data ?? []
    granRows = [...granRows, ...pageRows]
    if (pageRows.length < pageSize) break
  }

  // Filtro por viagem em granite_bls passa pelo manifest.voyage (lookup client-side).
  if (filters?.voyageId) {
    granRows = granRows.filter((row) => row.manifest?.voyage?.id === filters.voyageId)
  }

  if (granRows.length === 0) return []

  const graniteIds = granRows.map((row) => row.id)
  const { data: chargeRows, error: chargeErr } = await supabase
    .from('granite_bl_charges')
    .select('bl_id,subtotal,currency')
    .in('bl_id', graniteIds)
  if (chargeErr) throw chargeErr

  const totalsMap = new Map<
    string,
    { total_brl: number; total_usd: number; line_count: number; review_required_count: number }
  >()
  for (const row of chargeRows ?? []) {
    const blId = String(row.bl_id ?? '')
    if (!blId) continue
    const subtotal = Number(row.subtotal ?? 0)
    const current = totalsMap.get(blId) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 }
    if (row.currency === 'USD') current.total_usd += subtotal
    else if (row.currency === 'BRL') current.total_brl += subtotal
    current.line_count += 1
    totalsMap.set(blId, current)
  }

  return granRows.map((row) => ({
    id: row.id,
    cargo_mode: 'granito' as const,
    pol: row.loading_port,
    pod: row.discharge_port,
    charge_status: row.charge_status,
    financial_status: row.charge_status === 'invoiced' ? 'invoiced' : null,
    // granito não passa pelo gate de revisão de BL comum (workflow próprio).
    review_status: null,
    notes: null,
    // granite_bls não tem workflow de conciliação de cliente — se há client_id,
    // tratamos como conciliado pra não bloquear o pipeline; caso contrário, sinaliza pendência.
    customer_reconciliation_status: row.client_id ? 'reconciled' : 'pending',
    customer_reconciliation_notes: row.client_id ? null : 'Granito: cliente nao vinculado',
    billing_hold_reason: null,
    last_billing_run_id: null,
    charge_exemption_reason: null,
    charges_calculated_at: null,
    charges_reviewed_at: null,
    created_at: row.created_at,
    voyage: row.manifest?.voyage
      ? {
          id: row.manifest.voyage.id,
          voyage_number: row.manifest.voyage.voyage_number ?? '',
          vessel: { name: row.manifest.voyage.vessel?.name ?? null },
        }
      : null,
    customer: row.customer
      ? { id: row.customer.id, name: row.customer.name, cnpj_cpf: row.customer.cnpj_cpf }
      : null,
    totals: totalsMap.get(row.id) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 },
    trail: { last_event_at: null, last_event_by: null, last_event_field: null, last_event_message: null },
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
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
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
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return data
}

export async function deleteManualBlCharge(chargeCalculationId: number, actorId?: string | null) {
  const { data, error } = await supabase.rpc('delete_manual_bl_charge', {
    p_charge_calculation_id: chargeCalculationId,
    ...(actorId == null ? {} : { p_actor: actorId }),
  })

  if (error) throw error
  return data
}

export async function markBlChargesReviewed(blId: string, actorId?: string | null) {
  const { data, error } = await supabase.rpc('mark_bl_charges_reviewed', {
    p_bl_id: blId,
    ...(actorId == null ? {} : { p_actor: actorId }),
  })

  if (error) throw error
  return data
}

export async function markBlReadyForBilling(blId: string, actorId?: string | null) {
  const { data, error } = await supabase.rpc('mark_bl_ready_for_billing', {
    p_bl_id: blId,
    ...(actorId == null ? {} : { p_actor: actorId }),
  })

  if (error) throw error
  return data
}

// Helpers para a integracao Granito → Taxas Locais.
// granite_bls usa motor próprio (graniteCharges) — aqui só expomos a transicao
// de estado pra "ready_for_billing", que e o único hook usado pelo lote.
export async function markGraniteBlReady(blId: string) {
  const { error } = await supabase
    .from('granite_bls')
    .update({ charge_status: 'ready_for_billing' })
    .eq('id', blId)
  if (error) throw error
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
