import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded, calculateDemurrage } from './demurrageRates'
import type { DemurrageContainerListItem } from '../../types/database'

export type DemurrageContainerFilters = {
  customerId?: number | null
  blId?: string | null
  voyageId?: number | null
}

export async function listDemurrageContainers(filters?: DemurrageContainerFilters): Promise<DemurrageContainerListItem[]> {
  await ensureDemurrageRatesLoaded()

  let query = supabase
    .from('bl_containers')
    .select(`
      id, bl_id, container_number, type, discharge_date, return_date, demurrage_status,
      bl:bls(
        id, pol, pod, free_time_override,
        demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd,
        demurrage_roe_manual, demurrage_roe, voyage_id,
        customer:customers(id, name, cnpj_cpf),
        voyage:voyages(id, voyage_number, vessel:vessels(id, name))
      )
    `)
    .not('discharge_date', 'is', null)
    .neq('demurrage_status', 'returned')
    .order('discharge_date', { ascending: false })

  if (filters?.blId) query = query.eq('bl_id', filters.blId)

  const { data, error } = await query
  if (error) throw error

  let rows = (data ?? []) as unknown as DemurrageContainerListItem[]

  if (filters?.customerId) {
    rows = rows.filter((r) => (r.bl as { customer?: { id: number } | null } | null)?.customer?.id === filters.customerId)
  }
  if (filters?.voyageId) {
    rows = rows.filter((r) => (r.bl as { voyage_id?: number } | null)?.voyage_id === filters.voyageId)
  }

  return rows
}

export async function updateContainerDates(containerId: number, dischargeDate: string, returnDate: string | null): Promise<void> {
  if (!returnDate) {
    const { error } = await supabase.from('bl_containers').update({ discharge_date: dischargeDate, return_date: null, demurrage_status: 'within_free_time' }).eq('id', containerId)
    if (error) throw error
    return
  }

  const { data: row, error: fetchErr } = await supabase
    .from('bl_containers')
    .select('type, bl:bls(free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd)')
    .eq('id', containerId)
    .single()
  if (fetchErr) throw fetchErr

  const bl = (row as unknown as { bl?: { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null }).bl
  await ensureDemurrageRatesLoaded()
  const calc = calculateDemurrage(row.type, dischargeDate, returnDate, bl?.free_time_override, bl?.demurrage_rate_override_p1_usd, bl?.demurrage_rate_override_p2_usd)

  const demurrage_status = calc.status === 'overdue' ? 'overdue' : 'within_free_time'
  const { error } = await supabase.from('bl_containers').update({ discharge_date: dischargeDate, return_date: returnDate, demurrage_status }).eq('id', containerId)
  if (error) throw error
}

export async function updateContainerReturnDate(containerId: number, returnDate: string | null): Promise<void> {
  if (!returnDate) {
    const { error } = await supabase.from('bl_containers').update({ return_date: null, demurrage_status: 'within_free_time' }).eq('id', containerId)
    if (error) throw error
    return
  }

  const { data: row, error: fetchErr } = await supabase
    .from('bl_containers')
    .select('type, discharge_date, bl:bls(free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd)')
    .eq('id', containerId)
    .single()
  if (fetchErr) throw fetchErr

  const bl = (row as unknown as { bl?: { free_time_override?: number | null; demurrage_rate_override_p1_usd?: number | null; demurrage_rate_override_p2_usd?: number | null } | null }).bl
  await ensureDemurrageRatesLoaded()
  const calc = calculateDemurrage(row.type, row.discharge_date ?? '', returnDate, bl?.free_time_override, bl?.demurrage_rate_override_p1_usd, bl?.demurrage_rate_override_p2_usd)

  const demurrage_status = calc.status === 'overdue' ? 'overdue' : 'within_free_time'
  const { error } = await supabase.from('bl_containers').update({ return_date: returnDate, demurrage_status }).eq('id', containerId)
  if (error) throw error
}
