import { supabase } from './supabase'
import type { GraniteBlCharge, GraniteRate } from '../types/database'

export async function listGraniteRates(): Promise<GraniteRate[]> {
  const { data, error } = await supabase
    .from('granite_rates')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as GraniteRate[]
}

export async function upsertGraniteRate(
  rate: Omit<GraniteRate, 'id' | 'created_at'> & { id?: string },
): Promise<GraniteRate> {
  const { data, error } = await supabase
    .from('granite_rates')
    .upsert(rate, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data as GraniteRate
}

export async function deleteGraniteRate(id: string): Promise<void> {
  const { error } = await supabase.from('granite_rates').delete().eq('id', id)
  if (error) throw error
}

export async function calculateGraniteBlCharges(blId: string): Promise<GraniteBlCharge[]> {
  const { data: blRow, error: blError } = await supabase
    .from('granite_bls')
    .select('id, real_weight_kg')
    .eq('id', blId)
    .single()
  if (blError || !blRow) throw blError ?? new Error('BL nao encontrado.')

  const realWeightKg = Number(blRow.real_weight_kg ?? 0)

  const { data: rates, error: ratesError } = await supabase
    .from('granite_rates')
    .select('*')
    .eq('active', true)
  if (ratesError) throw ratesError

  // Remover linhas antigas
  const { error: delError } = await supabase.from('granite_bl_charges').delete().eq('bl_id', blId)
  if (delError) throw delError

  const today = new Date().toISOString().slice(0, 10)
  const activeRates = (rates ?? []).filter((r: GraniteRate) => {
    if (r.valid_from && r.valid_from > today) return false
    if (r.valid_to && r.valid_to < today) return false
    return true
  }) as GraniteRate[]

  if (!activeRates.length) {
    await supabase
      .from('granite_bls')
      .update({ charge_status: 'calculated' })
      .eq('id', blId)
    return []
  }

  const chargeRows = activeRates.map((rate) => {
    const quantity =
      rate.charge_type === 'per_kg'
        ? realWeightKg
        : rate.charge_type === 'per_ton'
          ? realWeightKg / 1000
          : 1
    const subtotal = Number((quantity * Number(rate.unit_value)).toFixed(2))
    return {
      bl_id: blId,
      rate_id: rate.id,
      description: rate.description,
      charge_type: rate.charge_type,
      unit_value: Number(rate.unit_value),
      quantity: Number(quantity.toFixed(6)),
      subtotal,
      currency: rate.currency,
    }
  })

  const { data: inserted, error: insertError } = await supabase
    .from('granite_bl_charges')
    .insert(chargeRows)
    .select()
  if (insertError) throw insertError

  await supabase
    .from('granite_bls')
    .update({ charge_status: 'calculated' })
    .eq('id', blId)

  return (inserted ?? []) as GraniteBlCharge[]
}

async function listGraniteBlCharges(blId: string): Promise<GraniteBlCharge[]> {
  const { data, error } = await supabase
    .from('granite_bl_charges')
    .select('*')
    .eq('bl_id', blId)
    .order('calculated_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as GraniteBlCharge[]
}

export async function listGraniteBls(filters: {
  voyageId?: string
  dischargePort?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('granite_bls')
    .select(
      `*, manifest:granite_manifests(id, vessel_voyage, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name))), customer:customers(id, name)`,
      { count: 'exact' },
    )
    .range(from, to)
    .order('created_at', { ascending: false })

  if (filters.search) {
    query = query.or(
      `bl_number.ilike.%${filters.search}%,shipper_name.ilike.%${filters.search}%,shipper_cnpj.ilike.%${filters.search}%`,
    )
  }

  if (filters.dischargePort) {
    query = query.eq('discharge_port', filters.dischargePort)
  }

  if (filters.voyageId) {
    // filter via granite_manifests.voyage_id
    const { data: manifestIds } = await supabase
      .from('granite_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    const ids = (manifestIds ?? []).map((m: { id: string }) => m.id)
    if (!ids.length) return { rows: [], count: 0 }
    query = query.in('manifest_id', ids)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}

async function listGraniteManifests(voyageId?: number) {
  let query = supabase
    .from('granite_manifests')
    .select('*, voyage:voyages(id, voyage_number, vessel:vessels(id, name))')
    .order('imported_at', { ascending: false })
  if (voyageId) query = query.eq('voyage_id', voyageId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
