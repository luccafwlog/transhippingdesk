import { supabase } from './supabase'

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

export type LocalChargeTableWithItems = {
  id: number
  name: string
  cargo_mode: 'container' | 'carga_solta' | null
  pod: string | null
  valid_from: string
  valid_to: string | null
  active: boolean | null
  notes: string | null
  charge_table_items: Array<{
    id: number
    name: string
    category: string | null
    application_basis: string | null
    cargo_profile: string | null
    currency: string | null
    unit_value_brl: number | null
    unit_value_usd: number | null
    manual_only: boolean | null
    active: boolean | null
    sort_order: number | null
  }>
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

export async function listLocalChargeTables(filters?: {
  cargoMode?: '' | 'container' | 'carga_solta'
  pod?: string
}) {
  let query = supabase
    .from('charge_tables')
    .select(
      `
      id,
      name,
      cargo_mode,
      pod,
      valid_from,
      valid_to,
      active,
      notes,
      charge_table_items(
        id,
        name,
        category,
        application_basis,
        cargo_profile,
        currency,
        unit_value_brl,
        unit_value_usd,
        manual_only,
        active,
        sort_order
      )
    `,
    )
    .order('valid_from', { ascending: false })
    .order('id', { ascending: false })

  if (filters?.cargoMode) {
    query = query.eq('cargo_mode', filters.cargoMode)
  }

  if (filters?.pod) {
    query = query.ilike('pod', `%${filters.pod}%`)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as unknown as LocalChargeTableWithItems[]

  return rows.map((table) => ({
    ...table,
    charge_table_items: [...(Array.isArray(table.charge_table_items) ? table.charge_table_items : [])].sort((left, right) => {
      const bySort = Number(left.sort_order ?? 999) - Number(right.sort_order ?? 999)
      if (bySort !== 0) return bySort
      return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'pt-BR')
    }),
  }))
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
