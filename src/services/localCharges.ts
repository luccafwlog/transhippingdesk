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

export type LocalChargeOverrideItem = {
  id: number
  customer_id: number | null
  charge_item_id: number | null
  override_value: number
  valid_from: string | null
  valid_to: string | null
  notes: string | null
  created_at: string | null
  customer: {
    id: number
    name: string
    cnpj_cpf: string
  } | null
  charge_item: {
    id: number
    name: string
    currency: string | null
    unit_value_brl: number | null
    unit_value_usd: number | null
    charge_table: {
      id: number
      name: string
      cargo_mode: 'container' | 'carga_solta' | null
      pod: string | null
      valid_from: string
      valid_to: string | null
      active: boolean | null
    } | null
  } | null
}

export type OverrideChargeItemOption = {
  id: number
  name: string
  currency: string | null
  unit_value_brl: number | null
  unit_value_usd: number | null
  cargo_profile: string | null
  application_basis: string | null
  charge_table: {
    id: number
    name: string
    cargo_mode: 'container' | 'carga_solta' | null
    pod: string | null
    valid_from: string
    valid_to: string | null
    active: boolean | null
  } | null
}

export type OverrideCustomerOption = {
  id: number
  name: string
  cnpj_cpf: string
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

export async function listCustomerRateOverrides(filters?: {
  customerSearch?: string
  cargoMode?: '' | 'container' | 'carga_solta'
  pod?: string
  limit?: number
}) {
  const limit = Math.max(20, Math.min(500, Number(filters?.limit ?? 200)))

  const { data, error } = await supabase
    .from('customer_rate_overrides')
    .select(
      `
      id,
      customer_id,
      charge_item_id,
      override_value,
      valid_from,
      valid_to,
      notes,
      created_at,
      customer:customers(
        id,
        name,
        cnpj_cpf
      ),
      charge_item:charge_table_items(
        id,
        name,
        currency,
        unit_value_brl,
        unit_value_usd,
        charge_table:charge_tables(
          id,
          name,
          cargo_mode,
          pod,
          valid_from,
          valid_to,
          active
        )
      )
    `,
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const search = String(filters?.customerSearch ?? '').trim().toLowerCase()
  const modeFilter = filters?.cargoMode ?? ''
  const podFilter = String(filters?.pod ?? '').trim().toUpperCase()
  const rows = (data ?? []) as unknown as LocalChargeOverrideItem[]

  return rows.filter((row) => {
    const customerName = String(row.customer?.name ?? '').toLowerCase()
    const customerDoc = String(row.customer?.cnpj_cpf ?? '').toLowerCase()
    const rowMode = row.charge_item?.charge_table?.cargo_mode ?? null
    const rowPod = String(row.charge_item?.charge_table?.pod ?? '').toUpperCase()

    if (search && !customerName.includes(search) && !customerDoc.includes(search)) {
      return false
    }
    if (modeFilter && rowMode !== modeFilter) {
      return false
    }
    if (podFilter && !rowPod.includes(podFilter)) {
      return false
    }
    return true
  })
}

export async function listOverrideChargeItems() {
  const { data, error } = await supabase
    .from('charge_table_items')
    .select(
      `
      id,
      name,
      currency,
      unit_value_brl,
      unit_value_usd,
      cargo_profile,
      application_basis,
      charge_table:charge_tables(
        id,
        name,
        cargo_mode,
        pod,
        valid_from,
        valid_to,
        active
      )
    `,
    )
    .eq('manual_only', false)
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(600)

  if (error) throw error

  return (data ?? []) as unknown as OverrideChargeItemOption[]
}

export async function listOverrideCustomers(search?: string) {
  let query = supabase
    .from('customers')
    .select('id, name, cnpj_cpf')
    .order('name', { ascending: true })
    .range(0, 199)

  const normalizedSearch = String(search ?? '').trim()
  if (normalizedSearch.length >= 2) {
    query = query.or(`name.ilike.%${normalizedSearch}%,cnpj_cpf.ilike.%${normalizedSearch}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as OverrideCustomerOption[]
}

export async function saveCustomerRateOverride(input: {
  id?: number | null
  customerId: number
  chargeItemId: number
  overrideValue: number
  validFrom?: string | null
  validTo?: string | null
  notes?: string | null
}) {
  const payload = {
    customer_id: input.customerId,
    charge_item_id: input.chargeItemId,
    override_value: Number(input.overrideValue),
    valid_from: input.validFrom?.trim() ? input.validFrom : null,
    valid_to: input.validTo?.trim() ? input.validTo : null,
    notes: input.notes?.trim() ? input.notes.trim() : null,
  }

  if (input.id) {
    const { error } = await supabase.from('customer_rate_overrides').update(payload).eq('id', input.id)
    if (error) throw error
    return input.id
  }

  const { data, error } = await supabase.from('customer_rate_overrides').insert(payload).select('id').single()
  if (error) throw error
  return Number(data.id)
}

export async function deleteCustomerRateOverride(id: number) {
  const { error } = await supabase.from('customer_rate_overrides').delete().eq('id', id)
  if (error) throw error
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
