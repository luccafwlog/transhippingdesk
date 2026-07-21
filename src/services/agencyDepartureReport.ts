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
  Json,
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

// Labels pt-BR das seções e departamentos do ADR — espelham as funções SQL
// agency_report_section_label/agency_report_department_label (migration 219).
export const AGENCY_REPORT_SECTION_LABELS: Record<AgencyReportSection, string> = {
  datas: 'Datas',
  carga_descarregada: 'Carga descarregada',
  carga_carregada: 'Carga carregada',
  veiculos: 'Veículos',
  vazios_embarcados: 'Vazios embarcados',
  vazios_descarregados: 'Vazios descarregados',
  ocorrencias: 'Ocorrências',
}

export type SignoffState = AgencyReportSignoff['state']

export const signoffLabels: Record<SignoffState, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  nothing_to_declare: 'Nada a declarar',
}

export const AGENCY_REPORT_DEPARTMENT_LABELS: Record<string, string> = {
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}

export type AgencyReportOwnData = AgencyDepartureReport & {
  signoffs: AgencyReportSignoff[]
  occurrences: AgencyReportOccurrence[]
  closed_by_name?: string | null
  actor_names?: Record<string, string>
}

export async function getAgencyReportOwnData(voyageId: number, port: string) {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('*, signoffs:agency_departure_report_signoffs(*), occurrences:agency_departure_report_occurrences(*)')
    .eq('voyage_id', voyageId)
    .eq('port', port)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const report = data as unknown as AgencyReportOwnData

  // Nomes de todos os atores (sign-offs, ocorrências, fechamento) em uma
  // chamada; absorve get_agency_report_closer_name (migration 217 → 220).
  const actorNames: Record<string, string> = {}
  const { data: actorRows, error: actorError } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ user_id?: string; full_name?: string | null }> | null; error: { message?: string | null } | null }>)('get_agency_report_actor_names', {
    p_voyage_id: voyageId,
    p_port: port,
  })
  if (actorError) {
    // A RPC pode estar ausente no remoto (migration 220 pendente); o ADR
    // continua legível, só sem os nomes resolvidos.
    console.error('[agencyDepartureReport] erro ao resolver nomes dos atores:', actorError.message)
  } else if (Array.isArray(actorRows)) {
    for (const row of actorRows) {
      if (row.user_id && row.full_name) actorNames[row.user_id] = row.full_name
    }
  }

  return {
    ...report,
    actor_names: actorNames,
    closed_by_name: report.closed_by ? actorNames[report.closed_by] ?? null : null,
  }
}

export async function setSignoff(input: {
  voyageId: number
  port: string
  section: AgencyReportSection
  state: AgencyReportSignoff['state']
  justification?: string
}) {
  const { error } = await supabase.rpc('set_agency_report_signoff', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_state: input.state,
    p_justification: input.justification,
  })
  if (error) throw error
}

export type AgencyReportSignoffEvent = {
  id: number
  section: AgencyReportSection
  old_value: string | null
  new_value: string | null
  justification: string | null
  changed_by: string | null
  changed_at: string | null
}

// audit_logs é a trilha reutilizada para o histórico de sign-off (sem tabela
// nova); entity_id segue o padrão "{voyageId}::{PORT}::{section}" gravado
// pela migration 221.
export async function listSignoffEvents(voyageId: number, port: string) {
  const prefix = `${voyageId}::${port.toUpperCase()}::`
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, entity_id, old_value, new_value, justification, changed_by, changed_at')
    .eq('entity_type', 'agency_departure_report_signoff')
    .like('entity_id', `${prefix}%`)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row): AgencyReportSignoffEvent => ({
    id: row.id,
    section: row.entity_id.slice(prefix.length) as AgencyReportSection,
    old_value: row.old_value,
    new_value: row.new_value,
    justification: row.justification,
    changed_by: row.changed_by,
    changed_at: row.changed_at,
  }))
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

export async function closeReport(input: { voyageId: number; port: string; snapshot: Json }) {
  const { error } = await supabase.rpc('close_agency_departure_report', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_snapshot: input.snapshot,
  })
  if (error) throw error
}

export async function reopenReport(input: { voyageId: number; port: string; justification: string }) {
  const { error } = await supabase.rpc('reopen_agency_departure_report', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_justification: input.justification,
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

type BreakbulkAgencyReportBl = {
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_weight_ton: number | null
  total_weight_kg: number | null
  total_cbm: number | null
}

export async function getAgencyReportDerivedData(voyageId: number, port: string) {
  const entityId = buildVoyagePodEntityId(voyageId, port)
  const [schedules, vehiclesRes, vaziosExpRes, vaziosImpRes, graniteRes, containersRes, operationRes, breakbulkRes] = await Promise.all([
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
      .from('baplie_containers')
      .select('container_number, size_type, status, is_imo, pod')
      .eq('voyage_id', voyageId)
      .eq('pod', port),
    supabase
      .from('vazios_export_operations')
      .select('*, overtime:vazios_export_overtime_depots(*), reorg:vazios_reorg_services(*)')
      .eq('voyage_id', voyageId)
      .eq('embark_port', port)
      .maybeSingle(),
    supabase
      .from('bls')
      .select('bb_machine_qty, bb_packages_qty, bb_weight_ton, total_weight_kg, total_cbm')
      .eq('voyage_id', voyageId)
      .eq('pod', port)
      .eq('cargo_mode', 'carga_solta'),
  ])

  for (const result of [vehiclesRes, vaziosExpRes, vaziosImpRes, graniteRes, containersRes, operationRes, breakbulkRes]) {
    if (result.error) throw result.error
  }

  const vehicles = (vehiclesRes.data ?? []) as unknown as Array<Pick<Vehicle, 'brand' | 'bl_id' | 'chassis' | 'container_id'> & {
    container: { unpacking_location: string | null } | null
  }>
  const vaziosExp = (vaziosExpRes.data ?? []) as VaziosBooking[]
  const vaziosImp = (vaziosImpRes.data ?? []) as Pick<VaziosImportacaoContainer, 'container_type' | 'natureza' | 'pod'>[]
  const granite = (graniteRes.data ?? []) as Pick<GraniteBl, 'real_weight_kg' | 'blocks_qty' | 'loading_port'>[]
  const containers = (containersRes.data ?? []) as Pick<BaplieContainer, 'container_number' | 'size_type' | 'status' | 'is_imo' | 'pod'>[]
  const breakbulk = (breakbulkRes.data ?? []) as BreakbulkAgencyReportBl[]
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
    cargaSolta: {
      bls: breakbulk.length,
      machines: breakbulk.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0),
      packages: breakbulk.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0),
      weightTon: breakbulk.reduce(
        (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
        0,
      ),
      cbm: breakbulk.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0),
    },
  }
}
