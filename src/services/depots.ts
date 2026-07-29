import { supabase } from './supabase'
import type { Depot, DepotService } from '../types/database'
export type { Depot, DepotService }

export type LocalType = 'depot' | 'terminal_portuario'
export type ServiceNature = 'armazenagem' | 'transporte' | 'geral'

export async function listDepots(): Promise<Depot[]> {
  const { data, error } = await supabase.from('depots').select('*').order('code')
  if (error) throw error
  return (data ?? []) as unknown as Depot[]
}

export async function upsertDepot(input: Omit<Depot, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<void> {
  if (!input.code.trim()) throw new Error('Código do local obrigatório.')
  if (input.tipo === 'terminal_portuario' && (input.free_time_vazio_days !== 0 || input.free_time_material_days !== 0)) {
    throw new Error('Terminal portuário não possui free time.')
  }
  const payload = {
    code: input.code.trim(), name: input.name?.trim() || null, tipo: input.tipo,
    active: input.active, free_time_vazio_days: input.free_time_vazio_days ?? 0,
    free_time_material_days: input.free_time_material_days ?? 0, updated_at: new Date().toISOString(),
  }
  const query = input.id ? supabase.from('depots').update(payload).eq('id', input.id) : supabase.from('depots').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteDepot(id: string): Promise<void> {
  const { error } = await supabase.from('depots').delete().eq('id', id)
  if (error) throw error
}

export async function listDepotServices(depotId: string): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('depot_id', depotId).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}

export async function upsertDepotService(input: Omit<DepotService, 'id' | 'created_at'> & { id?: string }): Promise<void> {
  const query = input.id ? supabase.from('depot_services').update(input).eq('id', input.id) : supabase.from('depot_services').insert(input)
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
  const { data, error } = await supabase.from('depots').select('*').ilike('code', value).eq('active', true).limit(1).maybeSingle()
  if (error) throw error
  return (data as unknown as Depot | null) ?? null
}

export async function listCurrentDepotServices(depotId: string): Promise<DepotService[]> {
  const { data, error } = await supabase.from('depot_services').select('*').eq('depot_id', depotId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as unknown as DepotService[]
}

export type SuggestionInput = {
  local: Pick<Depot, 'id'>
  servico: Pick<DepotService, 'id' | 'depot_id' | 'rate_brl'>
  tipo?: string | null
  rota?: string | null
  condicao?: string | null
  catalogo?: Array<Pick<DepotService, 'id' | 'depot_id' | 'rate_brl' | 'active' | 'container_type' | 'route_destino_id' | 'condition'>>
}

/** Casa do discriminante mais específico ao genérico; o valor efetivo fica na linha. */
export function valorSugerido({ local, servico, tipo, rota, condicao, catalogo = [servico as DepotService] }: SuggestionInput): number | null {
  const candidates = catalogo.filter((item) => item.active !== false && item.depot_id === local.id && item.id === servico.id)
  const matches = candidates.filter((item) =>
    (item.container_type == null || item.container_type === tipo) &&
    (item.route_destino_id == null || item.route_destino_id === rota) &&
    (item.condition == null || item.condition === condicao),
  )
  if (!matches.length) return null
  const best = [...matches].sort((a, b) => specificity(b, tipo, rota, condicao) - specificity(a, tipo, rota, condicao))[0]
  return best ? Number(best.rate_brl) : null
}

function specificity(item: Pick<DepotService, 'container_type' | 'route_destino_id' | 'condition'>, tipo?: string | null, rota?: string | null, condicao?: string | null): number {
  return Number(item.container_type != null && item.container_type === tipo)
    + Number(item.route_destino_id != null && item.route_destino_id === rota)
    + Number(item.condition != null && item.condition === condicao)
}
