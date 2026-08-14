// Helpers puros para rótulos, métricas e resumos da tela de Viagens.
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'
import { formatDate } from '../lib/utils'
import { formatMetric, formatPortDisplayName, normalizePortName, stripFileExtension } from '../lib/voyageFormat'
import { normalizePortCode } from './portCode'

export function summarizeContainerTypes(
  containers:
    | Array<{
        container_number?: string | null
        type?: string | null
      }>
    | null
    | undefined,
) {
  const groups = new Map<string, Array<{ container_number?: string | null }>>()

  for (const container of containers ?? []) {
    const type = String(container.type ?? '').trim() || 'Não informado'
    const current = groups.get(type)

    if (current) {
      current.push(container)
    } else {
      groups.set(type, [container])
    }
  }

  return Array.from(groups.entries())
    .map(([type, items]) => ({ type, count: countDistinctContainerNumbers(items) }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type, 'pt-BR'))
    .map(({ type, count }) => `${type}: ${count}`)
    .join(' | ')
}

export function summarizeUniqueValues(values: Array<string | null | undefined>) {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return normalized.join(' | ')
}

export function summarizeOccurrences<T>(
  items: T[] | null | undefined,
  getLabel: (item: T) => string | null | undefined,
  fallbackLabel: string,
) {
  const counts = new Map<string, number>()

  for (const item of items ?? []) {
    const label = String(getLabel(item) ?? '').trim() || fallbackLabel
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}

export function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

// Estatísticas de módulos da viagem.

export type VoyageBl = {
  id: string
  batch_id?: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  pol: string | null
  pod: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  bl_containers?: Array<{
    id: number
    container_number: string
    type?: string | null
    is_oog?: boolean | null
    is_imo?: boolean | null
  }> | null
  bl_breakbulk_items?: Array<{
    id: number
    gross_weight_kg?: number | null
    cbm?: number | null
  }> | null
}

export type VoyageGraniteManifest = {
  id: string
  voyage_id: number | null
  loading_port: string | null
  discharge_port: string | null
  total_bls: number | null
  total_weight_kg: number | null
  granite_bls?: Array<{
    id: string
    charge_status: 'not_calculated' | 'calculated' | 'ready_for_billing' | 'invoiced' | null
  }> | null
}

export type VoyageVaziosManifest = {
  id: string
  voyage_id: number | null
  description: string | null
  total_bookings: number | null
  vazios_bookings?: Array<{
    id: string
    container_number: string | null
    container_type: string | null
    local_id: string
    condition: string
    local?: {
      id: string
      code: string
      name: string | null
      tipo: string
    } | null
  }> | null
}

export function splitVoyageBls(bls: VoyageBl[] | null | undefined) {
  const containerBls: VoyageBl[] = []
  const breakbulkBls: VoyageBl[] = []

  for (const bl of bls ?? []) {
    if (bl.cargo_mode === 'carga_solta') {
      breakbulkBls.push(bl)
    } else {
      containerBls.push(bl)
    }
  }

  return { containerBls, breakbulkBls }
}

export function countDistinctBatchIds(bls: VoyageBl[] | null | undefined) {
  return new Set((bls ?? []).map((bl) => bl.batch_id).filter((batchId): batchId is number => Number.isInteger(batchId))).size
}

/** Agrupa B/Ls por batch e rota, preservando a contagem usada pela timeline. */
export function groupBlsByRoute(bls: VoyageBl[] | null | undefined) {
  const grouped = new Map<number, Map<string, { pol: string; pod: string; blCount: number }>>()
  for (const bl of bls ?? []) {
    if (bl.batch_id == null) continue
    const pol = formatPortDisplayName(bl.pol?.trim() || '-')
    const pod = formatPortDisplayName(bl.pod?.trim() || '-')
    const routes = grouped.get(bl.batch_id) ?? new Map()
    const key = `${pol}\u0000${pod}`
    const current = routes.get(key)
    routes.set(key, { pol, pod, blCount: (current?.blCount ?? 0) + 1 })
    grouped.set(bl.batch_id, routes)
  }
  return new Map(Array.from(grouped, ([batchId, routes]) => [batchId, Array.from(routes.values())]))
}

/**
 * Conta rotas distintas (par POL/POD normalizado) de um conjunto de B/Ls. A
 * "quantidade de manifestos" de uma viagem passa a ser o número de rotas, não
 * de arquivos importados: uma viagem pode nascer só de B/Ls (sem batch de
 * manifesto), e dois arquivos da mesma rota são uma rota só (ADR 0017).
 */
export function countDistinctRoutes(bls: Array<{ pol?: string | null; pod?: string | null }> | null | undefined) {
  const routes = new Set<string>()
  for (const bl of bls ?? []) {
    const pol = String(bl.pol ?? '').trim().toUpperCase() || '-'
    const pod = String(bl.pod ?? '').trim().toUpperCase() || '-'
    routes.add(`${pol}__${pod}`)
  }
  return routes.size
}

export function getGraniteModuleStats(manifests: VoyageGraniteManifest[] | null | undefined) {
  const totalManifests = manifests?.length ?? 0
  const totalBls = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bls ?? manifest.granite_bls?.length ?? 0),
    0,
  )
  const totalWeightTon = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_weight_kg ?? 0) / 1000,
    0,
  )
  const graniteBls = (manifests ?? []).flatMap((manifest) => manifest.granite_bls ?? [])

  return {
    totalManifests,
    totalBls,
    totalWeightTon,
    readyForBillingCount: graniteBls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
    invoicedCount: graniteBls.filter((bl) => bl.charge_status === 'invoiced').length,
    dischargePorts: summarizeUniqueValues((manifests ?? []).map((manifest) => manifest.discharge_port)),
  }
}

export function getVaziosModuleStats(manifests: VoyageVaziosManifest[] | null | undefined) {
  const totalManifests = manifests?.length ?? 0
  const totalUnits = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bookings ?? manifest.vazios_bookings?.length ?? 0),
    0,
  )
  const bookings = (manifests ?? []).flatMap((manifest) => manifest.vazios_bookings ?? [])

  return {
    totalManifests,
    totalUnits,
    distinctContainers: countDistinctContainerNumbers(bookings),
    containerTypes: summarizeOccurrences(bookings, (booking) => booking.container_type, 'Não informado'),
    origins: summarizeUniqueValues(bookings.map((booking) => booking.local?.name ?? booking.local?.code)),
  }
}

export function summarizeModuleAvailability({
  hasCntrs,
  hasBreakbulk,
  hasVehicles,
  hasGranite,
  hasVazios,
}: {
  hasCntrs: boolean
  hasBreakbulk: boolean
  hasVehicles: boolean
  hasGranite: boolean
  hasVazios: boolean
}) {
  const modules = []
  if (hasCntrs) modules.push('CNTRS')
  if (hasBreakbulk) modules.push('BB')
  if (hasVehicles) modules.push('VEICULOS')
  if (hasGranite) modules.push('GRANITO')
  if (hasVazios) modules.push('VAZIOS')
  return modules.join('/') || '-'
}

export function collectVoyagePorts(
  bls: Array<{ pol: string | null; pod: string | null }> | null | undefined,
  field: 'pol' | 'pod',
  fallback: string | null,
  extraPorts: Array<string | { port?: string | null; pol?: string | null; pod?: string | null } | null | undefined> = [],
) {
  const ports = Array.from(new Set(
    [
      ...(bls ?? []).map((bl) => bl[field]),
      ...extraPorts.map((value) => normalizeCollectedPort(value, field)),
    ]
      .map((value) => normalizePortCode(value))
      .filter((value): value is string => Boolean(value)),
  )).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  if (!ports.length && fallback) {
    return [normalizePortCode(fallback) ?? fallback]
  }

  return ports
}

function normalizeCollectedPort(
  value: string | { port?: string | null; pol?: string | null; pod?: string | null } | null | undefined,
  field: 'pol' | 'pod',
) {
  if (typeof value === 'object' && value !== null) {
    return String(value.port ?? value[field] ?? '').trim()
  }
  return String(value ?? '').trim()
}

export function countPlannedPodRows(rows: Array<{ pod: string | null | undefined }> | null | undefined) {
  return new Set(
    (rows ?? [])
      .map((row) => normalizePortCode(row.pod))
      .filter(Boolean),
  ).size
}

function canonicalPort(value: string | null | undefined) {
  return normalizePortCode(value) ?? normalizePortName(value)
}

export type AdrEscalaPod = { pod: string; omitted: boolean }

/**
 * Escalas que compõem o ADR (Task 2 do ADR 2026-07-31): as não omitidas mais
 * as omitidas que já têm ADR fechado — o fechamento é um registro imutável e
 * não pode virar inalcançável por causa de uma omissão registrada depois. Uma
 * escala omitida sem ADR fechado continua fora: o navio não atracou lá.
 */
export function computeAdrEscalaPods(
  podRows: Array<{ pod: string; omitted?: boolean }> | null | undefined,
  closedAdrPorts: Iterable<string> | null | undefined,
): AdrEscalaPod[] {
  const closedSet = new Set(Array.from(closedAdrPorts ?? []).map((port) => normalizePortCode(port) ?? normalizePortName(port)))
  const byPort = new Map<string, AdrEscalaPod>()
  for (const row of podRows ?? []) {
    const pod = normalizePortCode(row.pod) ?? normalizePortName(row.pod)
    if (!pod || (row.omitted && !closedSet.has(pod))) continue
    const current = byPort.get(pod)
    byPort.set(pod, { pod, omitted: Boolean(current?.omitted || row.omitted) })
  }
  return [...byPort.values()]
}

// --- Estado de Conciliação da Viagem (ver CONTEXT.md) -----------------------

export type EstadoConciliacao = 'divergente' | 'incompleto' | 'conciliado'

/** Cobertura de CE Mercante: quantos B/Ls têm ce_mercante preenchido. */
export function voyageCeCoverage(bls: Array<{ ce_mercante: string | null }> | null | undefined) {
  const list = bls ?? []
  return {
    filled: list.filter((bl) => String(bl.ce_mercante ?? '').trim()).length,
    total: list.length,
  }
}

/**
 * Deriva o Estado de Conciliação a partir de sinais já computados. Pura e
 * desacoplada da consulta de divergências (que é por viagem e cara): o
 * chamador decide como obter `hasOpenDivergences`. Viagem sem carga (CE total
 * 0 e sem B/Ls) resulta em 'conciliado' (nada pendente).
 *
 * A ausência de manifesto NÃO é mais sinal de incompletude: uma viagem pode
 * nascer só de B/Ls (ADR 0017), fonte comercial co-primária. O que ainda torna
 * a viagem incompleta é cobertura de CE parcial.
 */
export function deriveEstadoConciliacao({
  hasOpenDivergences,
  ceFilled,
  ceTotal,
}: {
  hasOpenDivergences: boolean
  ceFilled: number
  ceTotal: number
}): EstadoConciliacao {
  if (hasOpenDivergences) return 'divergente'
  if (ceTotal > 0 && ceFilled < ceTotal) return 'incompleto'
  return 'conciliado'
}

/** Próxima escala: menor ETA entre PODs com ETA definido e sem ATA registrado. */
export function getProximaEscala(
  podRows: Array<{ pod?: string; port?: string; eta: string | null; etb?: string | null; ata: string | null; omitted?: boolean }> | null | undefined,
) {
  const pending = (podRows ?? []).filter((row) => row.eta && !row.ata && !row.omitted && getEscalaPort(row))
  if (!pending.length) return null
  const next = pending.reduce((earliest, row) => (String(row.eta) < String(earliest.eta) ? row : earliest))
  const pod = getEscalaPort(next)
  if (!pod) return null
  return { pod, eta: next.eta as string, etb: next.etb ?? null }
}

function getEscalaPort(row: { pod?: string; port?: string }) {
  return row.port ?? row.pod ?? null
}

export function isEtaOverdue(eta: string | null, now: Date = new Date()): boolean {
  if (!eta) return false
  return new Date(`${eta}T23:59:59`) < now
}

// --- Rail (lista master-detail) ----------------------------------------------

export type VoyageRailItem = {
  id: number
  carrierName: string
  vesselName: string
  voyageNumber: string
  status: 'active' | 'completed' | 'cancelled'
  /** Mantidos só para a busca do rail (`viagensFilters.ts`); o card não os exibe. */
  originPorts: string[]
  destinationPorts: string[]
  estado: EstadoConciliacao
  proximaEscala: { pod: string; eta: string; etb: string | null } | null
  /** Escalas brasileiras (não omitidas) com seus ETAs, ordenadas por ETA ascendente. */
  escalasBrasileiras: Array<{ port: string; eta: string | null; modules?: Partial<VoyageRailItem['modules']> }>
  /** Presença de cada tipo de carga/módulo na viagem, para os selos do card do rail. */
  modules: {
    container: boolean
    cargaSolta: boolean
    veiculos: boolean
    vazios: boolean
    vaziosExp?: boolean
    granito: boolean
  }
}

type VoyageRailSource = {
  id: number
  voyage_number: string
  status: string | null
  vessel?: { name: string; carrier?: { name: string } | null } | null
  pol?: { name: string } | null
  pod?: { name: string } | null
  bls?: VoyageBl[] | null
  import_batches?: Array<{ id: number }> | null
}

type PodScheduleRow = { pod: string; eta: string | null; etb: string | null; ata: string | null; omitted?: boolean }
type EscalaScheduleRow = {
  port: string
  eta: string | null
  etb: string | null
  ata: string | null
  omitted?: boolean
  temExportacao?: boolean
  hasGranite?: boolean
  containersQty?: number | null
  movementsQty?: number | null
}

/**
 * Monta os itens do rail. Estado de Conciliação usa apenas sinais baratos do
 * payload (CE + manifesto faltando); divergências (estado 'divergente') ficam
 * a cargo da view de detalhe, que consulta uma viagem por vez.
 */
/** Presença de módulos por viagem, calculada fora do payload de B/Ls (veículos, vazios de importação e granito vêm de consultas próprias). */
export type VoyageRailModuleStats = {
  hasVehicles?: boolean
  vehicleContainerNumbers?: string[]
  hasVaziosImportacao?: boolean
  hasGranite?: boolean
  hasVaziosExportacao?: boolean
}

/** Escalas brasileiras (não omitidas) por porto, com o menor ETA quando o porto aparece mais de uma vez, ordenadas por ETA ascendente (sem ETA vai ao final). */
function collectEscalasBrasileiras(
  escalaRows: Array<PodScheduleRow | EscalaScheduleRow>,
): Array<{ port: string; eta: string | null; modules?: Partial<VoyageRailItem['modules']> }> {
  const byPort = new Map<string, { eta: string | null; modules: Partial<VoyageRailItem['modules']> }>()

  for (const row of escalaRows) {
    if (row.omitted) continue
    const port = getEscalaPort(row)
    if (!port) continue
    const current = byPort.get(port)
    const modules = 'temExportacao' in row
      ? {
          ...(row.temExportacao && ((row.containersQty ?? 0) > 0 || (row.movementsQty ?? 0) > 0) ? { vaziosExp: true } : {}),
          ...(row.hasGranite ? { granito: true } : {}),
        }
      : {}
    if (!current) byPort.set(port, { eta: row.eta ?? null, modules })
    else {
      if (row.eta && (!current.eta || row.eta < current.eta)) current.eta = row.eta
      current.modules = { ...current.modules, ...modules }
    }
  }

  return Array.from(byPort.entries())
    .map(([port, value]) => ({ port, eta: value.eta, modules: value.modules }))
    .sort((left, right) => (left.eta ?? '￿').localeCompare(right.eta ?? '￿'))
}

export function buildVoyageRailItems(
  voyages: VoyageRailSource[] | null | undefined,
  escalaRowsByVoyageId: ReadonlyMap<number, Array<PodScheduleRow | EscalaScheduleRow>> = new Map(),
  moduleStatsByVoyageId: ReadonlyMap<number, VoyageRailModuleStats> = new Map(),
): VoyageRailItem[] {
  return (voyages ?? []).map((voyage) => {
    const escalaRows = escalaRowsByVoyageId.get(voyage.id) ?? []
    const exportEscalas = escalaRows.filter((row) => 'port' in row && row.temExportacao)
    const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
    const { filled, total } = voyageCeCoverage(voyage.bls)
    const moduleStats = moduleStatsByVoyageId.get(voyage.id)

    return {
      id: voyage.id,
      carrierName: voyage.vessel?.carrier?.name ?? '',
      vesselName: voyage.vessel?.name ?? 'Navio',
      voyageNumber: voyage.voyage_number,
      status: normalizeVoyageStatus(voyage.status),
      originPorts: collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null, exportEscalas),
      destinationPorts: collectVoyagePorts(
        voyage.bls,
        'pod',
        null,
        escalaRows,
      ),
      estado: deriveEstadoConciliacao({
        hasOpenDivergences: false,
        ceFilled: filled,
        ceTotal: total,
      }),
      proximaEscala: getProximaEscala(escalaRows),
      escalasBrasileiras: collectEscalasBrasileiras(escalaRows).map((escala) => {
        const vehicleContainers = new Set((moduleStats?.vehicleContainerNumbers ?? []).map((number) => String(number).trim().toUpperCase()))
        const hasVehiclesAtPort = containerBls
          .filter((bl) => canonicalPort(bl.pod) === canonicalPort(escala.port))
          .flatMap((bl) => bl.bl_containers ?? [])
          .some((container) => vehicleContainers.has(String(container.container_number ?? '').trim().toUpperCase()))
        const modules: Partial<VoyageRailItem['modules']> = { ...(escala.modules ?? {}) }
        if (moduleStats?.hasVehicles) modules.veiculos = hasVehiclesAtPort
        if (moduleStats?.hasVaziosExportacao) modules.vaziosExp = Boolean(modules.vaziosExp)
        if (moduleStats?.hasGranite) modules.granito = Boolean(modules.granito)
        return Object.keys(modules).length ? { ...escala, modules } : { port: escala.port, eta: escala.eta }
      }),
      modules: {
        container: containerBls.length > 0,
        cargaSolta: breakbulkBls.length > 0,
        veiculos: moduleStats?.hasVehicles ?? false,
    vazios: moduleStats?.hasVaziosImportacao ?? false,
    ...(moduleStats?.hasVaziosExportacao ? { vaziosExp: true } : {}),
        granito: moduleStats?.hasGranite ?? false,
      },
    }
  })
}

// --- Linha do tempo da viagem ------------------------------------------------

export type VoyageTimelineEventKind =
  | 'import'
  | 'baplie-import'
  | 'escala-date'
  | 'escala-number'
  | 'manifestos-linked'
  | 'ce-status'
  | 'restow'
  | 'pod-added'
  | 'divergence-resolved'
  | 'divergence-opened'
  | 'pod-removed'
  | 'voyage-completed'
  | 'ce-master'
  | 'voyage-data'
  | 'ce-coverage'
  | 'omission'
  | 'transshipment-info'

export type VoyageTimelineEvent = {
  id: string
  kind: VoyageTimelineEventKind
  at: string
  title: string
  detail: string
}

type TimelineAuditEvent = {
  entity_type?: string | null
  entity_id: string
  field_name: string
  old_value?: string | null
  new_value: string | null
  changed_by?: string | null
  actor_role?: string | null
  changed_at: string | null
  justification?: string | null
}

type TimelineImportBatch = {
  id: number
  filename: string
  cargo_mode: 'container' | 'carga_solta' | null
  uploaded_at: string | null
  uploaded_by?: string | null
  route_summary?: string | null
  route?: string | null
  routes?: Array<{ pol: string; pod: string; blCount: number }>
  total_bls?: number | null
  ce_master?: string | null
}
type TimelineBaplieImport = {
  imported_at?: string | null
  created_at?: string | null
  container_count?: number | null
}
type VoyageTimelineInput = {
  importBatches?: TimelineImportBatch[] | null
  scheduleEvents?: TimelineAuditEvent[] | null
  auditEvents?: TimelineAuditEvent[] | null
  resolutions?: Array<{ field_name: string | null; resolved_at: string | null }> | null
  baplieImports?: TimelineBaplieImport[] | null
  openDivergenceCount?: number | null
  voyageStatus?: string | null
  ceCoverage?: { filled: number; total: number } | null
  actorNames?: Record<string, string> | null
  actorDepartments?: Record<string, string> | null
}

const TIMELINE_SCHEDULE_DATE_LABELS: Record<string, string> = { etd: 'ETD', eta: 'ETA', etb: 'ETB', ata: 'ATA', atd: 'ATD' }
const TIMELINE_CE_STATUS_LABELS: Record<string, string> = {
  waiting: 'Aguardando',
  received: 'Recebido',
  launching: 'Lançando',
  approving: 'Em aprovação',
  approved: 'Aprovado',
  partial: 'Lançando',
  missing: 'Aguardando',
}
const TIMELINE_VOYAGE_FIELD_LABELS: Record<string, string> = {
  created: 'Viagem',
  voyage_number: 'Nº da viagem',
  vessel_id: 'Navio',
  status: 'Status',
}
const TIMELINE_KIND_ORDER: Record<VoyageTimelineEventKind, number> = {
  'voyage-completed': 0,
  'ce-master': 1,
  'ce-coverage': 2,
  import: 3,
  'divergence-opened': 4,
  'baplie-import': 5,
  'pod-added': 6,
  restow: 7,
  'ce-status': 8,
  'manifestos-linked': 9,
  'escala-number': 10,
  'escala-date': 11,
  'divergence-resolved': 12,
  'voyage-data': 13,
  'pod-removed': 14,
  omission: 15,
  'transshipment-info': 16,
}

export function buildVoyageTimeline({
  importBatches,
  scheduleEvents,
  auditEvents,
  resolutions,
  baplieImports,
  openDivergenceCount,
  voyageStatus,
  ceCoverage,
  actorNames,
  actorDepartments,
}: {
  importBatches?: Array<{ id: number; filename: string; cargo_mode: 'container' | 'carga_solta' | null; uploaded_at: string | null; route?: string | null; routes?: Array<{ pol: string; pod: string; blCount: number }>; total_bls?: number | null; ce_master?: string | null }> | null
  scheduleEvents?: TimelineAuditEvent[] | null
  auditEvents?: TimelineAuditEvent[] | null
  resolutions?: Array<{ field_name: string | null; resolved_at: string | null }> | null
  baplieImports?: Array<{ imported_at?: string | null; created_at?: string | null; container_count?: number | null }> | null
  openDivergenceCount?: number | null
  voyageStatus?: string | null
  ceCoverage?: { filled: number; total: number } | null
  actorNames?: Record<string, string> | null
  actorDepartments?: Record<string, string> | null
}): VoyageTimelineEvent[] {
  const imports = buildImportTimeline(importBatches)
  const events = [...imports.events]
  const appendActor = (detail: string, changedBy: string | null | undefined) =>
    appendTimelineActor(detail, changedBy, actorNames, actorDepartments)
  events.push(...buildCeCoverageTimeline(ceCoverage, imports.latestImportAt))

  events.push(...buildBaplieTimeline(baplieImports, openDivergenceCount))

  events.push(...buildScheduleTimeline(scheduleEvents, appendActor))

  events.push(...buildVoyageCompletionTimeline(voyageStatus, events))

  events.push(...buildAuditTimeline(auditEvents, appendActor))

  events.push(...buildResolutionTimeline(resolutions))

  return events.sort((left, right) => {
    if (left.at < right.at) return 1
    if (left.at > right.at) return -1
    return TIMELINE_KIND_ORDER[left.kind] - TIMELINE_KIND_ORDER[right.kind]
  })
}

function buildImportTimeline(importBatches: TimelineImportBatch[] | null | undefined) {
  const events: VoyageTimelineEvent[] = []
  let latestImportAt: string | null = null

  for (const batch of importBatches ?? []) {
    if (!batch.uploaded_at) continue
    if (!latestImportAt || batch.uploaded_at > latestImportAt) latestImportAt = batch.uploaded_at

    const ceMaster = String(batch.ce_master ?? '').trim()
    if (ceMaster) {
      events.push({
        id: `ce-master-batch-${batch.id}`,
        kind: 'ce-master',
        at: batch.uploaded_at,
        title: 'CE Master definido',
        detail: ceMaster,
      })
    }

    if (batch.routes?.length) {
      const grouped = new Map<string, { pol: string; pod: string; count: number }>()
      for (const route of batch.routes) {
        const key = `${route.pol}\u0000${route.pod}`
        const current = grouped.get(key)
        grouped.set(key, { pol: route.pol, pod: route.pod, count: (current?.count ?? 0) + route.blCount })
      }
      for (const [key, route] of grouped) {
        const plural = route.count === 1 ? '' : 's'
        events.push({
          id: `import-${batch.id}-${key}`,
          kind: 'import',
          at: batch.uploaded_at,
          title: `${route.count} B/L${plural} importado${plural} · ${route.pol} → ${route.pod}`,
          detail: batch.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR',
        })
      }
    } else {
      const count = Number(batch.total_bls ?? 0)
      const route = String(batch.route ?? '').trim()
      const countLabel = count > 0 ? `${formatMetric(count)} B/L${count === 1 ? '' : 's'} importado${count === 1 ? '' : 's'}` : 'Manifesto importado'
      events.push({
        id: `import-${batch.id}`,
        kind: 'import',
        at: batch.uploaded_at,
        title: route ? `${countLabel} · ${route}` : countLabel,
        detail: `${batch.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'} · ${route || stripFileExtension(batch.filename)}`,
      })
    }
  }

  return { events, latestImportAt }
}

function buildCeCoverageTimeline(
  ceCoverage: VoyageTimelineInput['ceCoverage'],
  latestImportAt: string | null,
): VoyageTimelineEvent[] {
  if (!ceCoverage || !(ceCoverage.total > 0 && ceCoverage.filled >= ceCoverage.total) || !latestImportAt) return []
  return [{
    id: 'ce-coverage-complete',
    kind: 'ce-coverage',
    at: latestImportAt,
    title: 'Cobertura de CE Mercante completa',
    detail: `${ceCoverage.filled}/${ceCoverage.total} B/Ls com CE`,
  }]
}

function buildBaplieTimeline(
  baplieImports: TimelineBaplieImport[] | null | undefined,
  openDivergenceCount: number | null | undefined,
): VoyageTimelineEvent[] {
  const firstBaplieImport = (baplieImports ?? [])
    .map((row) => ({
      at: row.imported_at ?? row.created_at ?? null,
      count: Number(row.container_count ?? 0),
    }))
    .filter((row): row is { at: string; count: number } => Boolean(row.at))
    .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))[0]

  if (!firstBaplieImport) return []

  const events: VoyageTimelineEvent[] = [{
    id: 'baplie-import',
    kind: 'baplie-import',
    at: firstBaplieImport.at,
    title: 'Baplie EDI importado',
    detail: firstBaplieImport.count > 0 ? `${formatMetric(firstBaplieImport.count)} containers` : 'Staging Baplie',
  }]
  if (Number(openDivergenceCount ?? 0) > 0) {
    events.push({
      id: 'divergence-opened',
      kind: 'divergence-opened',
      at: firstBaplieImport.at,
      title: 'Divergência detectada',
      detail: `${formatMetric(openDivergenceCount)} divergência${openDivergenceCount === 1 ? '' : 's'} aberta${openDivergenceCount === 1 ? '' : 's'}`,
    })
  }
  return events
}

function buildScheduleTimeline(
  scheduleEvents: TimelineAuditEvent[] | null | undefined,
  appendActor: (detail: string, changedBy: string | null | undefined) => string,
): VoyageTimelineEvent[] {
  const events: VoyageTimelineEvent[] = []
  for (const [index, row] of (scheduleEvents ?? []).entries()) {
    const at = row.changed_at
    if (!at) continue
    const port = row.entity_id.split('::')[1] || '-'
    const value = (row.new_value ?? '').trim()
    const oldValue = (row.old_value ?? '').trim()

    if (TIMELINE_SCHEDULE_DATE_LABELS[row.field_name]) {
      if (!value) continue
      const changed = Boolean(oldValue && oldValue !== value)
      events.push({
        id: `sched-${index}`,
        kind: 'escala-date',
        at,
        title: `${TIMELINE_SCHEDULE_DATE_LABELS[row.field_name]} de ${port} ${changed ? 'alterado' : 'registrado'}`,
        detail: appendActor(changed ? `${formatDate(oldValue)} -> ${formatDate(value)}` : formatDate(value), row.changed_by),
      })
    } else if (row.field_name === 'escala_number' && value) {
      events.push({
        id: `sched-${index}`,
        kind: 'escala-number',
        at,
        title: `Escala de ${port} criada no Mercante`,
        detail: appendActor(`Nº ${value}`, row.changed_by),
      })
    } else if (row.field_name === 'linked' && value === 'true') {
      events.push({
        id: `sched-${index}`,
        kind: 'manifestos-linked',
        at,
        title: `Manifestos vinculados à escala de ${port}`,
        detail: appendActor('ESCALA = SIM', row.changed_by),
      })
    } else if (row.field_name === 'ces' && value) {
      events.push({
        id: `sched-${index}`,
        kind: 'ce-status',
        at,
        title: `Status de CE de ${port} alterado`,
        detail: appendActor(oldValue ? `${formatTimelineCeStatus(oldValue)} -> ${formatTimelineCeStatus(value)}` : formatTimelineCeStatus(value), row.changed_by),
      })
    } else if (row.field_name === 'rtw' && value) {
      events.push({
        id: `sched-${index}`,
        kind: 'restow',
        at,
        title: `Restow de ${port} registrado`,
        detail: appendActor(`RTW ${value}`, row.changed_by),
      })
    } else if (row.field_name === 'deleted' && value === 'false') {
      events.push({
        id: `sched-${index}`,
        kind: 'pod-added',
        at,
        title: `Escala de ${port} adicionada ao planejamento`,
        detail: appendActor('POD ativo', row.changed_by),
      })
    } else if (row.field_name === 'deleted' && value === 'true') {
      events.push({
        id: `sched-${index}`,
        kind: 'pod-removed',
        at,
        title: `Escala de ${port} removida do planejamento`,
        detail: appendActor('Planejamento removido', row.changed_by),
      })
    }
  }
  return events
}

function buildVoyageCompletionTimeline(
  voyageStatus: string | null | undefined,
  events: VoyageTimelineEvent[],
): VoyageTimelineEvent[] {
  if (voyageStatus !== 'completed') return []
  const latestAtd = events
    .filter((event) => event.kind === 'escala-date' && event.title.startsWith('ATD de '))
    .map((event) => event.at)
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))[0]
  if (!latestAtd) return []
  return [{
    id: 'voyage-completed',
    kind: 'voyage-completed',
    at: latestAtd,
    title: 'Viagem concluída',
    detail: 'Todos os PODs com ATD',
  }]
}

function buildAuditTimeline(
  auditEvents: TimelineAuditEvent[] | null | undefined,
  appendActor: (detail: string, changedBy: string | null | undefined) => string,
): VoyageTimelineEvent[] {
  const events: VoyageTimelineEvent[] = []
  for (const [index, row] of (auditEvents ?? []).entries()) {
    const at = row.changed_at
    const value = (row.new_value ?? '').trim()
    if (!at || !value) continue
    const oldValue = (row.old_value ?? '').trim()

    if (row.field_name === 'ce_master') {
      events.push({
        id: `audit-ce-master-${index}`,
        kind: 'ce-master',
        at,
        title: oldValue ? 'CE Master alterado' : 'CE Master definido',
        detail: appendActor(oldValue ? `${oldValue} -> ${value}` : value, row.changed_by),
      })
      continue
    }

    if (row.field_name === 'escala_omitida') {
      const omittedPod = oldValue || '—'
      const reason = String(row.justification ?? '').trim()
      const suffix = reason && reason !== 'Omissao de escala' ? ` · motivo: ${reason}` : ''
      events.push({
        id: `audit-omission-${index}`,
        kind: 'omission',
        at,
        title: `Escala de ${omittedPod} omitida · Porto de Transbordo — ${value}${suffix}`,
        detail: appendActor('Omissão registrada', row.changed_by),
      })
      continue
    }

    if (row.field_name === 'transshipment_info') {
      events.push({
        id: `audit-transshipment-${index}`,
        kind: 'transshipment-info',
        at,
        title: 'Informações de Transbordo complementadas',
        detail: appendActor('Registro global atualizado', row.changed_by),
      })
      continue
    }

    if (row.entity_type === 'voyages' || row.entity_type === 'voyage') {
      const label = TIMELINE_VOYAGE_FIELD_LABELS[row.field_name] ?? row.field_name
      events.push({
        id: `audit-voyage-${index}`,
        kind: 'voyage-data',
        at,
        title: oldValue ? 'Dados da viagem alterados' : 'Viagem criada',
        detail: appendActor(oldValue ? `${label}: ${oldValue} -> ${value}` : `${label}: ${value}`, row.changed_by),
      })
    }
  }
  return events
}

function buildResolutionTimeline(resolutions: VoyageTimelineInput['resolutions']): VoyageTimelineEvent[] {
  return (resolutions ?? []).flatMap((resolution, index) => {
    if (!resolution.resolved_at) return []
    return [{
      id: `res-${index}`,
      kind: 'divergence-resolved' as const,
      at: resolution.resolved_at,
      title: 'Divergência conciliada',
      detail: resolution.field_name ? `Campo ${resolution.field_name}` : 'Baplie -> Manifesto',
    }]
  })
}

function appendTimelineActor(
  detail: string,
  changedBy: string | null | undefined,
  actorNames: Record<string, string> | null | undefined,
  actorDepartments: Record<string, string> | null | undefined,
) {
  const actor = String(changedBy ?? '').trim()
  if (!actor) return detail
  const name = actorNames?.[actor]?.trim()
  const department = actorDepartments?.[actor]?.trim()
  if (name && department) return `${detail} · por ${name} (${department})`
  if (name) return `${detail} · por ${name}`
  return isUuid(actor) ? detail : `${detail} · por ${actor}`
}

function formatTimelineCeStatus(value: string) {
  return TIMELINE_CE_STATUS_LABELS[value] ?? value
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

// --- Importação por POD ------------------------------------------------------

export type PodImportSummary = {
  pod: string
  containers: { distinct: number; imo: number; oog: number; types: string }
  generalCargo: { distinct: number; imo: number; oog: number }
  vehicles: { distinctContainers: number }
  breakbulk: { bls: number; machines: number; packages: number; weightTon: number; cbm: number }
}

/**
 * Resume as métricas de importação segmentadas por POD de descarga.
 * `vehicleContainerNumbers` (de useVoyageVehicleStats) identifica quais
 * containers carregam veículos, para separar carga geral de veículos sem
 * embutir regra de porto.
 */
export function summarizeImportByPod(
  bls: VoyageBl[] | null | undefined,
  vehicleContainerNumbers: string[] | null | undefined,
): PodImportSummary[] {
  const { containerBls, breakbulkBls } = splitVoyageBls(bls)
  const vehicleSet = new Set((vehicleContainerNumbers ?? []).map((n) => String(n).trim().toUpperCase()))

  const pods = Array.from(
    new Set([
      ...containerBls.map((bl) => canonicalPort(bl.pod)),
      ...breakbulkBls.map((bl) => canonicalPort(bl.pod)),
    ]),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return pods.map((pod) => {
    const flat = containerBls
      .filter((bl) => canonicalPort(bl.pod) === pod)
      .flatMap((bl) => bl.bl_containers ?? [])
    const isVehicle = (container: { container_number?: string | null }) =>
      vehicleSet.has(String(container.container_number ?? '').trim().toUpperCase())
    const general = flat.filter((container) => !isVehicle(container))
    const vehicles = flat.filter(isVehicle)
    const podBreakbulk = breakbulkBls.filter((bl) => canonicalPort(bl.pod) === pod)

    return {
      pod,
      containers: {
        distinct: countDistinctContainerNumbers(flat),
        imo: countDistinctContainerNumbersBy(flat, (container) => Boolean(container.is_imo)),
        oog: countDistinctContainerNumbersBy(flat, (container) => Boolean(container.is_oog)),
        types: summarizeContainerTypes(flat),
      },
      generalCargo: {
        distinct: countDistinctContainerNumbers(general),
        imo: countDistinctContainerNumbersBy(general, (container) => Boolean(container.is_imo)),
        oog: countDistinctContainerNumbersBy(general, (container) => Boolean(container.is_oog)),
      },
      vehicles: { distinctContainers: countDistinctContainerNumbers(vehicles) },
      breakbulk: {
        bls: podBreakbulk.length,
        machines: podBreakbulk.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0),
        packages: podBreakbulk.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0),
        weightTon: podBreakbulk.reduce(
          (sum, bl) => sum + Number(bl.bb_weight_ton ?? (bl.total_weight_kg ? Number(bl.total_weight_kg) / 1000 : 0)),
          0,
        ),
        cbm: podBreakbulk.reduce((sum, bl) => sum + Number(bl.total_cbm ?? 0), 0),
      },
    }
  })
}

// --- Exportação por terminal de embarque (POL/origem) ------------------------

export type PolExportSummary = {
  pol: string
  granite: { manifests: number; bls: number; weightTon: number; readyForBilling: number; invoiced: number }
  vazios: { units: number; distinctContainers: number; types: string; origins: string }
}

/** Resume Granito e Vazios de exportação por terminal de embarque. */
export function summarizeExportByPol(
  graniteManifests: VoyageGraniteManifest[] | null | undefined,
  vaziosManifests: VoyageVaziosManifest[] | null | undefined,
): PolExportSummary[] {
  const granite = graniteManifests ?? []
  const allBookings = (vaziosManifests ?? []).flatMap((manifest) => manifest.vazios_bookings ?? [])

  const pols = Array.from(
    new Set([
      ...granite.map((manifest) => canonicalPort(manifest.loading_port)),
      ...allBookings.map((booking) => canonicalPort(booking.local?.code)),
    ]),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return pols.map((pol) => {
    const polGranite = granite.filter((manifest) => canonicalPort(manifest.loading_port) === pol)
    const polBookings = allBookings.filter((booking) => canonicalPort(booking.local?.code) === pol)
    const graniteBls = polGranite.flatMap((manifest) => manifest.granite_bls ?? [])

    return {
      pol,
      granite: {
        manifests: polGranite.length,
        bls: polGranite.reduce((sum, manifest) => sum + Number(manifest.total_bls ?? manifest.granite_bls?.length ?? 0), 0),
        weightTon: polGranite.reduce((sum, manifest) => sum + Number(manifest.total_weight_kg ?? 0) / 1000, 0),
        readyForBilling: graniteBls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
        invoiced: graniteBls.filter((bl) => bl.charge_status === 'invoiced').length,
      },
      vazios: {
        units: polBookings.length,
        distinctContainers: countDistinctContainerNumbers(polBookings),
        types: summarizeOccurrences(polBookings, (booking) => booking.container_type, 'Não informado'),
        origins: summarizeUniqueValues(polBookings.map((booking) => booking.local?.name ?? booking.local?.code)),
      },
    }
  })
}
