import { supabase } from './supabase'
import type { Depot, DepotService, DepotTariff } from '../types/database'
export type { Depot, DepotService, DepotTariff }

const today = () => new Date().toISOString().slice(0, 10)

export async function listDepots(): Promise<Depot[]> {
  const { data, error } = await supabase.from('depots').select('*').order('code')
  if (error) throw error
  return (data ?? []) as unknown as Depot[]
}

export async function upsertDepot(input: Omit<Depot, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<void> {
  const payload = { code: input.code.trim(), name: input.name?.trim() || null, pol_port: input.pol_port?.trim() || null, active: input.active, updated_at: new Date().toISOString() }
  const query = input.id
    ? supabase.from('depots').update(payload).eq('id', input.id)
    : supabase.from('depots').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteDepot(id: string): Promise<void> {
  const { error } = await supabase.from('depots').delete().eq('id', id)
  if (error) throw error
}

export async function listDepotTariffs(depotId: string): Promise<DepotTariff[]> {
  const { data, error } = await supabase.from('depot_tariffs').select('*').eq('depot_id', depotId).order('valid_from', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as DepotTariff[]
}

export async function upsertDepotTariff(input: Omit<DepotTariff, 'id' | 'created_at'> & { id?: string }): Promise<void> {
  if (input.valid_to && input.valid_to < input.valid_from) throw new Error('Vigência final anterior à inicial.')
  const payload = input
  const query = input.id
    ? supabase.from('depot_tariffs').update(payload).eq('id', input.id)
    : supabase.from('depot_tariffs').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function listDepotServices(depotId: string): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('depot_id', depotId).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}

export async function upsertDepotService(input: Omit<DepotService, 'id' | 'created_at'> & { id?: string }): Promise<void> {
  if (input.valid_to && input.valid_to < input.valid_from) throw new Error('Vigência final anterior à inicial.')
  const payload = input
  const query = input.id
    ? supabase.from('depot_services').update(payload).eq('id', input.id)
    : supabase.from('depot_services').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteDepotService(id: string): Promise<void> {
  const { error } = await supabase.from('depot_services').delete().eq('id', id)
  if (error) throw error
}

export async function resolveDepot(codeOrPort: string | null | undefined): Promise<Depot | null> {
  const value = codeOrPort?.trim()
  if (!value) return null
  const { data, error } = await supabase.from('depots').select('*').eq('code', value).limit(1).maybeSingle()
  if (error) throw error
  return (data as unknown as Depot | null) ?? null
}

export async function resolveCurrentDepotTariff(depotId: string, on = today()): Promise<DepotTariff | null> {
  const { data, error } = await supabase.from('depot_tariffs').select('*').eq('depot_id', depotId).eq('active', true).lte('valid_from', on).or(`valid_to.is.null,valid_to.gte.${on}`).order('valid_from', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return (data as unknown as DepotTariff | null) ?? null
}

export async function listCurrentDepotServices(depotId: string, on = today()): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('depot_id', depotId).eq('active', true).lte('valid_from', on).or(`valid_to.is.null,valid_to.gte.${on}`).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}
