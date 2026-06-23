import { supabase } from '../supabase'
import { escapeFilterTerm } from '../../lib/utils'

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

type OverrideCustomerOption = {
  id: number
  name: string
  cnpj_cpf: string
}

export async function listCustomerRateOverrides(filters?: {
  customerSearch?: string
  cargoMode?: '' | 'container' | 'carga_solta' | 'granito'
  pod?: string
  limit?: number
}) {
  const limit = Math.max(20, Math.min(500, Number(filters?.limit ?? 200)))
  const pageSize = 500
  const rows: LocalChargeOverrideItem[] = []

  for (let from = 0; ; from += pageSize) {
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
      .range(from, from + pageSize - 1)
      .overrideTypes<LocalChargeOverrideItem[], { merge: false }>()

    if (error) throw error
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < pageSize) break
  }

  const search = String(filters?.customerSearch ?? '').trim().toLowerCase()
  const modeFilter = filters?.cargoMode ?? ''
  const podFilter = String(filters?.pod ?? '').trim().toUpperCase()

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
  }).slice(0, limit)
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
    .overrideTypes<OverrideChargeItemOption[], { merge: false }>()

  if (error) throw error

  return data ?? []
}

export async function listOverrideCustomers(search?: string) {
  let query = supabase
    .from('customers')
    .select('id, name, cnpj_cpf')
    .order('name', { ascending: true })
    .range(0, 199)

  const normalizedSearch = escapeFilterTerm(String(search ?? ''))
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
