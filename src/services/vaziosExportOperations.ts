import type { VaziosBooking, VaziosExportOperation, VaziosExportServiceLine } from '../types/database'
import { supabase } from './supabase'
import { listVaziosBookings } from './vaziosImport'
import { diasCobraveis } from './vaziosCusto'

const OPERATION_BOOKINGS_PAGE_SIZE = 1000

export async function listVaziosBookingsForOperation(voyageId: string) {
  const rows: Awaited<ReturnType<typeof listVaziosBookings>>['rows'] = []
  let page = 1; let count = Number.POSITIVE_INFINITY
  while (rows.length < count) {
    const result = await listVaziosBookings({ voyageId, page, pageSize: OPERATION_BOOKINGS_PAGE_SIZE })
    rows.push(...result.rows); count = result.count
    if (result.rows.length === 0) break
    page += 1
  }
  return { rows, count: Number.isFinite(count) ? count : 0 }
}

export function computeStorageTotals(rows: Array<Pick<VaziosBooking, 'local_id' | 'condition' | 'hand_in_date' | 'hand_out_date'>>, depots: Array<{ id: string; tipo?: string; free_time_vazio_days?: number; free_time_material_days?: number }> = []): { containers: number; days: number } {
  let containers = 0; let days = 0
  for (const row of rows) {
    const depot = depots.find((item) => item.id === row.local_id)
    const chargeable = diasCobraveis(row, depot)
    if (chargeable <= 0 && (!row.hand_in_date || !row.hand_out_date)) continue
    if (row.hand_in_date && row.hand_out_date && Date.parse(row.hand_out_date) >= Date.parse(row.hand_in_date)) containers += 1
    days += chargeable
  }
  return { containers, days }
}

export async function getVaziosExportOperation(voyageId: number, embarkPort: string) {
  const { data, error } = await supabase.from('vazios_export_operations')
    .select('*, linhas:vazios_export_service_lines(*, service:depot_services(*), local:depots(*), destino:depots!vazios_export_service_lines_destino_id_fkey(*))')
    .eq('voyage_id', voyageId).eq('embark_port', embarkPort).maybeSingle()
  if (error) throw error
  return data as (VaziosExportOperation & { service_qty: Array<{ depot_service_id: string; qty: number; service: { name: string } | null }>; linhas: Array<VaziosExportServiceLine & { service: unknown; local: unknown; destino: unknown }> }) | null
}

export async function upsertVaziosExportOperation(input: { voyageId: number; embarkPort: string; osNumber?: string | null }) {
  const { data, error } = await supabase.from('vazios_export_operations').upsert({
    voyage_id: input.voyageId, embark_port: input.embarkPort, updated_at: new Date().toISOString(),
  }, { onConflict: 'voyage_id,embark_port' }).select('id').single()
  if (error) throw error
  return data as { id: string }
}

/** @deprecated linhas substituem a tabela de quantidades; mantido para a tela antiga durante a migração. */
export async function upsertOperationServiceQty(input: { operationId: string; depotServiceId: string; qty: number }) {
  const { error } = await supabase.from('vazios_export_service_lines').upsert({ operation_id: input.operationId, service_id: input.depotServiceId, local_id: input.operationId, quantidade: input.qty, valor_unitario: 0 }, { onConflict: 'id' })
  if (error) throw error
}

export async function upsertServiceLine(input: Omit<VaziosExportServiceLine, 'id' | 'created_at' | 'updated_at'> & { id?: string }) {
  const payload = { ...input, updated_at: new Date().toISOString() }
  const query = input.id ? supabase.from('vazios_export_service_lines').update(payload).eq('id', input.id) : supabase.from('vazios_export_service_lines').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteServiceLine(id: string) {
  const { error } = await supabase.from('vazios_export_service_lines').delete().eq('id', id)
  if (error) throw error
}

export async function updateVaziosBooking(id: string, patch: Partial<VaziosBooking> & Record<string, unknown>) {
  const { error } = await supabase.from('vazios_bookings').update(patch as never).eq('id', id)
  if (error) throw error
}
