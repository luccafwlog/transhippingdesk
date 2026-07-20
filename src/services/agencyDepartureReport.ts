import type {
  BaplieContainer,
  GraniteBl,
  UserProfileRole,
  VaziosBooking,
  VaziosExportOperation,
  VaziosExportOvertimeDepot,
  VaziosReorgService,
  VaziosImportacaoContainer,
  Vehicle,
} from '../types/database'
import type { AgencyDepartureReport, AgencyReportOccurrence, AgencyReportSignoff } from '../types/database'
import { supabase } from './supabase'
import { computeStorageTotals } from './vaziosExportOperations'
import { buildVoyagePodEntityId, listVoyagePodSchedules } from './voyageRouteSchedules'

export type AgencyReportSection =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'
  | 'ocorrencias'

export const AGENCY_REPORT_SECTIONS: Record<AgencyReportSection, UserProfileRole> = {
  datas: 'operacoes',
  carga_descarregada: 'documentacao',
  carga_carregada: 'documentacao',
  veiculos: 'equipamentos',
  vazios_embarcados: 'equipamentos',
  vazios_descarregados: 'documentacao',
  ocorrencias: 'operacoes',
}

export type AgencyReportOwnData = AgencyDepartureReport & {
  signoffs: AgencyReportSignoff[]
  occurrences: AgencyReportOccurrence[]
}

export async function getAgencyReportOwnData(voyageId: number, port: string) {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('*, signoffs:agency_departure_report_signoffs(*), occurrences:agency_departure_report_occurrences(*)')
    .eq('voyage_id', voyageId)
    .eq('port', port)
    .maybeSingle()
  if (error) throw error
  return data as AgencyReportOwnData | null
}

export async function setSignoff(input: {
  voyageId: number
  port: string
  section: AgencyReportSection
  state: AgencyReportSignoff['state']
}) {
  const { error } = await supabase.rpc('set_agency_report_signoff', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_state: input.state,
  })
  if (error) throw error
}

export async function addOccurrence(input: { voyageId: number; port: string; body: string }) {
  const { error } = await supabase.rpc('add_agency_report_occurrence', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_body: input.body,
  })
  if (error) throw error
}

export async function setTerminal(input: { voyageId: number; port: string; terminal: string }) {
  const { error } = await supabase.rpc('set_agency_report_terminal', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_terminal: input.terminal,
  })
  if (error) throw error
}

export type MatrixCategory =
  | 'carga_geral'
  | 'veiculos'
  | 'transbordo'
  | 'imo'
  | 'vazio_cama'
  | 'vazio_cover_plate'

export function buildContainerTypeMatrix(
  items: Array<{ type: string; category: MatrixCategory | string }>,
) {
  const rows: Record<string, Record<string, number>> = {}
  const totals: Record<string, number> = {}

  for (const item of items) {
    const type = item.type || '—'
    rows[type] = rows[type] ?? {}
    rows[type][item.category] = (rows[type][item.category] ?? 0) + 1
    totals[item.category] = (totals[item.category] ?? 0) + 1
  }

  return { rows, totals }
}

export function groupVehiclesByBrand(
  vehicles: Array<{ brand: string; bl_id: string; chassis: string }>,
) {
  const byBrand = new Map<string, { bls: Set<string>; vins: Set<string> }>()

  for (const vehicle of vehicles) {
    const entry = byBrand.get(vehicle.brand) ?? { bls: new Set<string>(), vins: new Set<string>() }
    entry.bls.add(vehicle.bl_id)
    entry.vins.add(vehicle.chassis)
    byBrand.set(vehicle.brand, entry)
  }

  return [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, entry]) => ({ brand, blCount: entry.bls.size, vinCount: entry.vins.size }))
}

export async function getAgencyReportDerivedData(voyageId: number, port: string) {
  const entityId = buildVoyagePodEntityId(voyageId, port)
  const [schedules, vehiclesRes, vaziosExpRes, vaziosImpRes, graniteRes, containersRes, operationRes] = await Promise.all([
    listVoyagePodSchedules([entityId]),
    supabase
      .from('vehicles')
      .select('brand, bl_id, chassis, container_id, container:bl_containers(unpacking_location), bl:bls!inner(voyage_id, pod)')
      .eq('bl.voyage_id', voyageId)
      .eq('bl.pod', port),
    supabase
      .from('vazios_bookings')
      .select('*, manifest:vazios_manifests!inner(voyage_id)')
      .eq('manifest.voyage_id', voyageId)
      .eq('embark_port', port),
    supabase
      .from('vazios_importacao_containers')
      .select('container_type, natureza, pod, manifest:vazios_importacao_manifests!inner(voyage_id)')
      .eq('manifest.voyage_id', voyageId)
      .eq('pod', port),
    supabase
      .from('granite_bls')
      .select('real_weight_kg, blocks_qty, loading_port, manifest:granite_manifests!inner(voyage_id)')
      .eq('manifest.voyage_id', voyageId)
      .eq('loading_port', port),
    supabase
      .from('baplie_containers' as never)
      .select('container_number, size_type, status, is_imo, pod')
      .eq('voyage_id', voyageId)
      .eq('pod', port),
    supabase
      .from('vazios_export_operations')
      .select('*, overtime:vazios_export_overtime_depots(*), reorg:vazios_reorg_services(*)')
      .eq('voyage_id', voyageId)
      .eq('embark_port', port)
      .maybeSingle(),
  ])

  for (const result of [vehiclesRes, vaziosExpRes, vaziosImpRes, graniteRes, containersRes, operationRes]) {
    if (result.error) throw result.error
  }

  const vehicles = (vehiclesRes.data ?? []) as unknown as Array<Pick<Vehicle, 'brand' | 'bl_id' | 'chassis' | 'container_id'> & {
    container: { unpacking_location: string | null } | null
  }>
  const vaziosExp = (vaziosExpRes.data ?? []) as VaziosBooking[]
  const vaziosImp = (vaziosImpRes.data ?? []) as Pick<VaziosImportacaoContainer, 'container_type' | 'natureza' | 'pod'>[]
  const granite = (graniteRes.data ?? []) as Pick<GraniteBl, 'real_weight_kg' | 'blocks_qty' | 'loading_port'>[]
  const containers = (containersRes.data ?? []) as Pick<BaplieContainer, 'container_number' | 'size_type' | 'status' | 'is_imo' | 'pod'>[]
  const operation = operationRes.data as (VaziosExportOperation & {
    overtime: VaziosExportOvertimeDepot[]
    reorg: VaziosReorgService[]
  }) | null

  return {
    schedule: schedules.get(entityId) ?? null,
    vehicles,
    vaziosExp,
    vaziosImp,
    granite,
    containers,
    operation,
    storage: computeStorageTotals(vaziosExp),
  }
}
