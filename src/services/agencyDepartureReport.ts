import type {
  BaplieContainer,
  Depot,
  GraniteBl,
  UserProfileRole,
  VaziosBooking,
  VaziosExportOperation,
  VaziosExportServiceLine,
  VaziosImportacaoContainer,
  Vehicle,
  Json,
} from '../types/database'
import type { AgencyDepartureReport, AgencyReportDepartmentKey, AgencyReportDepartmentSignoff, AgencyReportOccurrence, AgencyReportSignoff } from '../types/database'
import { supabase } from './supabase'
import { computeStorageTotals } from './vaziosExportOperations'
import { listDepots } from './depots'
import { quantidadeEfetiva, totalEmbarque } from './vaziosCusto'
import { buildVoyagePodEntityId, listVoyagePodSchedules } from './voyageRouteSchedules'

export type AgencyReportSection =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'
  | 'operacao_patio'

export const AGENCY_REPORT_SECTIONS: Record<AgencyReportSection, UserProfileRole> = {
  datas: 'operacoes',
  carga_descarregada: 'documentacao',
  carga_carregada: 'documentacao',
  veiculos: 'equipamentos',
  vazios_embarcados: 'equipamentos',
  vazios_descarregados: 'documentacao',
  operacao_patio: 'equipamentos',
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
  operacao_patio: 'Operação de pátio',
}

// Ordem do ciclo da escala (ADR 0029/0030): Escala → Importação → Operação
// de pátio → Exportação. Usada pelo layout em faixas (Task 6).
export const AGENCY_REPORT_SECTION_ORDER: AgencyReportSection[] = [
  'datas',
  'carga_descarregada',
  'vazios_descarregados',
  'veiculos',
  'operacao_patio',
  'carga_carregada',
  'vazios_embarcados',
]

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
  departmentSignoffs: AgencyReportDepartmentSignoff[]
  occurrences: AgencyReportOccurrence[]
  closed_by_name?: string | null
  actor_names?: Record<string, string>
}

export async function getAgencyReportOwnData(voyageId: number, port: string) {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('*, signoffs:agency_departure_report_signoffs(*), departmentSignoffs:agency_departure_report_department_signoffs(*), occurrences:agency_departure_report_occurrences(*)')
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

// Observação por seção (ADR 0030): edição livre do dono da seção, sem
// justificativa nem histórico em audit_logs — não é um dado formal do ADR.
export async function setSectionObservation(input: {
  voyageId: number
  port: string
  section: AgencyReportSection
  observation: string
}) {
  const { error } = await supabase.rpc('set_agency_report_section_observation', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_observation: input.observation,
  })
  if (error) throw error
}

export async function setDepartmentSignoff(input: {
  voyageId: number
  port: string
  department: AgencyReportDepartmentKey
  signed: boolean
  justification?: string
}) {
  const { error } = await supabase.rpc('set_agency_report_department_signoff', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_department: input.department,
    p_signed: input.signed,
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

export async function addOccurrence(input: {
  voyageId: number
  port: string
  body: string
  section?: AgencyReportSection
}) {
  const { error } = await supabase.rpc('add_agency_report_occurrence', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_body: input.body,
    p_section: input.section,
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
      .select('*, operation:vazios_export_operations!inner(voyage_id, embark_port)')
      .eq('operation.voyage_id', voyageId)
      .eq('operation.embark_port', port),
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
      .select('*, linhas:vazios_export_service_lines(*, service:depot_services(*), local:depots(*), destino:depots!vazios_export_service_lines_destino_id_fkey(*))')
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
  const allDepots = await listDepots()
  const vaziosExp = (vaziosExpRes.data ?? []).map((booking) => ({
    ...booking,
    local: allDepots.find((depot) => depot.id === booking.local_id) ?? null,
  })) as Array<VaziosBooking & {
    local: Pick<Depot, 'id' | 'code' | 'name' | 'tipo'> | null
  }>
  const vaziosImp = (vaziosImpRes.data ?? []) as Pick<VaziosImportacaoContainer, 'container_type' | 'natureza' | 'pod'>[]
  const granite = (graniteRes.data ?? []) as Pick<GraniteBl, 'real_weight_kg' | 'blocks_qty' | 'loading_port'>[]
  const containers = (containersRes.data ?? []) as Pick<BaplieContainer, 'container_number' | 'size_type' | 'status' | 'is_imo' | 'pod'>[]
  const breakbulk = (breakbulkRes.data ?? []) as BreakbulkAgencyReportBl[]
  const operation = operationRes.data as (VaziosExportOperation & { linhas: Array<VaziosExportServiceLine & { service: { name: string; natureza: string } | null; local: { code: string; name: string | null } | null; destino: { code: string; name: string | null } | null }> }) | null
  const units = vaziosExp.map((booking) => ({ ...booking, container_number: booking.container_number, local_id: booking.local_id, condition: booking.condition }))
  const serviceLines = (operation?.linhas ?? []).map((row) => {
    const line = { ...row, natureza: row.service?.natureza ?? 'geral', local_id: row.local_id, quantidade: Number(row.quantidade), valor_unitario: Number(row.valor_unitario) }
    return { ...line, quantidade: quantidadeEfetiva(line, units, allDepots) }
  })
  const costs = { rows: [], qtyTotal: totalEmbarque({ unidades: units, linhas: serviceLines, depots: allDepots }), total: totalEmbarque({ unidades: units, linhas: serviceLines, depots: allDepots }), serviceLines }

  return {
    schedule: schedules.get(entityId) ?? null,
    vehicles,
    vaziosExp,
    vaziosImp,
    granite,
    containers,
    operation,
    costs,
    storage: computeStorageTotals(vaziosExp, allDepots),
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
