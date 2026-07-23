import type {
  VaziosBooking,
  VaziosExportOperation,
  VaziosExportOvertimeDepot,
  VaziosReorgRate,
  VaziosReorgService,
  VaziosReorgServiceType,
} from '../types/database'
import { supabase } from './supabase'
import { listVaziosBookings } from './vaziosImport'

const OPERATION_BOOKINGS_PAGE_SIZE = 1000

export async function listVaziosBookingsForOperation(voyageId: string) {
  const rows: Awaited<ReturnType<typeof listVaziosBookings>>['rows'] = []
  let page = 1
  let count = Number.POSITIVE_INFINITY

  while (rows.length < count) {
    const result = await listVaziosBookings({
      voyageId,
      page,
      pageSize: OPERATION_BOOKINGS_PAGE_SIZE,
    })
    rows.push(...result.rows)
    count = result.count
    if (result.rows.length === 0) break
    page += 1
  }

  return { rows, count: Number.isFinite(count) ? count : 0 }
}

export function computeStorageTotals(
  rows: Array<Pick<VaziosBooking, 'hand_in_date' | 'hand_out_date'>>,
): { containers: number; days: number } {
  let containers = 0
  let days = 0

  for (const row of rows) {
    if (!row.hand_in_date || !row.hand_out_date) continue
    const handIn = Date.parse(row.hand_in_date)
    const handOut = Date.parse(row.hand_out_date)
    if (!Number.isFinite(handIn) || !Number.isFinite(handOut)) continue
    const diff = Math.round((handOut - handIn) / 86_400_000)
    if (diff < 0) continue
    containers += 1
    days += diff
  }

  return { containers, days }
}

export async function updateVaziosBooking(
  id: string,
  patch: Partial<Pick<
    VaziosBooking,
    | 'embark_port'
    | 'depot'
    | 'material'
    | 'bundle'
    | 'transporte'
    | 'hand_in_date'
    | 'hand_out_date'
    | 'overtime_handling'
    | 'overtime_transport'
    | 'condition'
    | 'visual_check'
    | 'overtime_handling_pct'
    | 'overtime_transport_pct'
  >>,
) {
  const { error } = await supabase.from('vazios_bookings').update(patch).eq('id', id)
  if (error) throw error
}

export async function getVaziosExportOperation(voyageId: number, embarkPort: string) {
  const { data, error } = await supabase
    .from('vazios_export_operations')
    .select('*, overtime:vazios_export_overtime_depots(*), reorg:vazios_reorg_services(*)')
    .eq('voyage_id', voyageId)
    .eq('embark_port', embarkPort)
    .maybeSingle()
  if (error) throw error
  return data as (VaziosExportOperation & {
    overtime: VaziosExportOvertimeDepot[]
    reorg: VaziosReorgService[]
  }) | null
}

export async function upsertVaziosExportOperation(input: {
  voyageId: number
  embarkPort: string
  osNumber: string | null
}) {
  const { data, error } = await supabase
    .from('vazios_export_operations')
    .upsert(
      {
        voyage_id: input.voyageId,
        embark_port: input.embarkPort,
        os_number: input.osNumber,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'voyage_id,embark_port' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function upsertOvertimeDepot(input: {
  operationId: string
  depot: string
  percent: number
}) {
  const { error } = await supabase
    .from('vazios_export_overtime_depots')
    .upsert(
      { operation_id: input.operationId, depot: input.depot, percent: input.percent },
      { onConflict: 'operation_id,depot' },
    )
  if (error) throw error
}

export async function upsertReorgService(input: {
  operationId: string
  service: VaziosReorgService['service']
  containerType: string
  qty: number
}) {
  const { error } = await supabase
    .from('vazios_reorg_services')
    .upsert(
      {
        operation_id: input.operationId,
        service: input.service,
        container_type: input.containerType,
        qty: input.qty,
      },
      { onConflict: 'operation_id,service,container_type' },
    )
  if (error) throw error
}

export async function listActiveReorgRates(): Promise<VaziosReorgRate[]> {
  const { data, error } = await supabase
    .from('vazios_reorg_rates')
    .select('*')
    .eq('active', true)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return (data ?? []) as VaziosReorgRate[]
}

export async function listVaziosReorgRates(): Promise<VaziosReorgRate[]> {
  const { data, error } = await supabase
    .from('vazios_reorg_rates')
    .select('*')
    .order('service', { ascending: true })
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as VaziosReorgRate[]
}

export async function upsertVaziosReorgRate(input: {
  id?: string
  service: VaziosReorgServiceType
  rate_brl: number
  active: boolean
  valid_from: string
  valid_to: string | null
}): Promise<void> {
  if (!(input.rate_brl >= 0)) throw new Error('Tarifa deve ser um valor não negativo.')
  if (input.valid_to && input.valid_to < input.valid_from) throw new Error('Vigência final anterior à inicial.')
  const payload = {
    service: input.service,
    rate_brl: input.rate_brl,
    active: input.active,
    valid_from: input.valid_from,
    valid_to: input.valid_to,
  }
  const query = input.id
    ? supabase.from('vazios_reorg_rates').update(payload).eq('id', input.id)
    : supabase.from('vazios_reorg_rates').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteVaziosReorgRate(id: string): Promise<void> {
  const { error } = await supabase.from('vazios_reorg_rates').delete().eq('id', id)
  if (error) throw error
}
