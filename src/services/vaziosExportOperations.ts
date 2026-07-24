import type { VaziosBooking, VaziosExportOperation } from '../types/database'
import { supabase } from './supabase'
import { listVaziosBookings } from './vaziosImport'

const OPERATION_BOOKINGS_PAGE_SIZE = 1000

export async function listVaziosBookingsForOperation(voyageId: string) {
  const rows: Awaited<ReturnType<typeof listVaziosBookings>>['rows'] = []
  let page = 1
  let count = Number.POSITIVE_INFINITY
  while (rows.length < count) {
    const result = await listVaziosBookings({ voyageId, page, pageSize: OPERATION_BOOKINGS_PAGE_SIZE })
    rows.push(...result.rows); count = result.count
    if (result.rows.length === 0) break
    page += 1
  }
  return { rows, count: Number.isFinite(count) ? count : 0 }
}

export function computeStorageTotals(rows: Array<Pick<VaziosBooking, 'hand_in_date' | 'hand_out_date'>>): { containers: number; days: number } {
  let containers = 0; let days = 0
  for (const row of rows) {
    if (!row.hand_in_date || !row.hand_out_date) continue
    const diff = Math.round((Date.parse(row.hand_out_date) - Date.parse(row.hand_in_date)) / 86_400_000)
    if (!Number.isFinite(diff) || diff < 0) continue
    containers += 1; days += diff
  }
  return { containers, days }
}

export async function updateVaziosBooking(id: string, patch: Partial<Pick<VaziosBooking, 'embark_port' | 'depot' | 'material' | 'hand_in_date' | 'hand_out_date' | 'condition' | 'overtime_pct'>>) {
  const { error } = await supabase.from('vazios_bookings').update(patch).eq('id', id)
  if (error) throw error
}

export async function getVaziosExportOperation(voyageId: number, embarkPort: string) {
  const { data, error } = await supabase.from('vazios_export_operations')
    .select('*, service_qty:vazios_operation_service_qty(depot_service_id, qty, service:depot_services(name))')
    .eq('voyage_id', voyageId).eq('embark_port', embarkPort).maybeSingle()
  if (error) throw error
  return data as (VaziosExportOperation & { service_qty: Array<{ depot_service_id: string; qty: number; service: { name: string } | null }> }) | null
}

export async function upsertVaziosExportOperation(input: { voyageId: number; embarkPort: string; osNumber: string | null }) {
  const { data, error } = await supabase.from('vazios_export_operations').upsert({
    voyage_id: input.voyageId, embark_port: input.embarkPort, os_number: input.osNumber, updated_at: new Date().toISOString(),
  }, { onConflict: 'voyage_id,embark_port' }).select('id').single()
  if (error) throw error
  return data as { id: string }
}

export async function upsertOperationServiceQty(input: { operationId: string; depotServiceId: string; qty: number }) {
  const { error } = await supabase.from('vazios_operation_service_qty').upsert({
    operation_id: input.operationId, depot_service_id: input.depotServiceId, qty: input.qty,
  }, { onConflict: 'operation_id,depot_service_id' })
  if (error) throw error
}
