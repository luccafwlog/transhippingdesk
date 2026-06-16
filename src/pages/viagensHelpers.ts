// Helpers puros para rótulos, métricas e resumos da tela de Viagens.
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../lib/containerCounts'

export function normalizePortName(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

export function formatPortDisplayName(port: string | null | undefined) {
  const normalized = normalizePortName(port)

  const portNames: Record<string, string> = {
    CNNBO: 'NINGBO',
    CNNSA: 'NANSHA',
    CNSHG: 'SHANGHAI',
    CNTAC: 'TAICANG',
    BRVIT: 'VITORIA',
    VIX: 'VITORIA',
  }

  return portNames[normalized] ?? (String(port ?? '').trim() || '-')
}

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

export function formatMetric(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

export function tokenizeInfoValue(value: string) {
  if (!value || value === '-') return []

  const tokens = value
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens.length > 1 ? tokens : []
}

export function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
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
    origin_terminal: string | null
    destination: string | null
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
  const totalBookings = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bookings ?? manifest.vazios_bookings?.length ?? 0),
    0,
  )
  const bookings = (manifests ?? []).flatMap((manifest) => manifest.vazios_bookings ?? [])

  return {
    totalManifests,
    totalBookings,
    distinctContainers: countDistinctContainerNumbers(bookings),
    containerTypes: summarizeOccurrences(bookings, (booking) => booking.container_type, 'Não informado'),
    destinations: summarizeUniqueValues(bookings.map((booking) => booking.destination)),
    originTerminals: summarizeUniqueValues(bookings.map((booking) => booking.origin_terminal)),
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
  extraPorts: Array<string | null | undefined> = [],
) {
  const ports = Array.from(
    new Set(
      [
        ...(bls ?? []).map((bl) => bl[field]?.trim() ?? ''),
        ...extraPorts.map((value) => String(value ?? '').trim()),
      ]
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  if (!ports.length && fallback) {
    return [fallback]
  }

  return ports
}

export function countPlannedPodRows(rows: Array<{ pod: string | null | undefined }> | null | undefined) {
  return new Set(
    (rows ?? [])
      .map((row) => String(row.pod ?? '').trim())
      .filter(Boolean),
  ).size
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
 * Indica se a viagem tem manifesto faltando: há B/Ls mas nenhum batch de
 * manifesto, ou existem B/Ls órfãos (sem batch_id vinculado).
 */
export function voyageHasMissingManifest({
  bls,
  batches,
}: {
  bls: Array<{ batch_id?: number | null }> | null | undefined
  batches: Array<{ id: number }> | null | undefined
}) {
  const blList = bls ?? []
  if (blList.length === 0) return false
  if ((batches ?? []).length === 0) return true
  return blList.some((bl) => bl.batch_id == null)
}

/**
 * Deriva o Estado de Conciliação a partir de sinais já computados. Pura e
 * desacoplada da consulta de divergências (que é por viagem e cara): o
 * chamador decide como obter `hasOpenDivergences`. Viagem sem carga (CE total
 * 0 e sem B/Ls) resulta em 'conciliado' (nada pendente).
 */
export function deriveEstadoConciliacao({
  hasOpenDivergences,
  ceFilled,
  ceTotal,
  hasMissingManifest,
}: {
  hasOpenDivergences: boolean
  ceFilled: number
  ceTotal: number
  hasMissingManifest: boolean
}): EstadoConciliacao {
  if (hasOpenDivergences) return 'divergente'
  if (hasMissingManifest || (ceTotal > 0 && ceFilled < ceTotal)) return 'incompleto'
  return 'conciliado'
}

/** Próxima escala: menor ETA entre PODs com ETA definido e sem ATA registrado. */
export function getProximaEscala(
  podRows: Array<{ pod: string; eta: string | null; ata: string | null }> | null | undefined,
) {
  const pending = (podRows ?? []).filter((row) => row.eta && !row.ata)
  if (!pending.length) return null
  const next = pending.reduce((earliest, row) => (String(row.eta) < String(earliest.eta) ? row : earliest))
  return { pod: next.pod, eta: next.eta as string }
}

// --- Rail (lista master-detail) ----------------------------------------------

export type VoyageRailItem = {
  id: number
  carrierName: string
  vesselName: string
  voyageNumber: string
  status: 'active' | 'completed' | 'cancelled'
  originPorts: string[]
  destinationPorts: string[]
  blCount: number
  containerCount: number
  estado: EstadoConciliacao
  proximaEscala: { pod: string; eta: string } | null
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

type PodScheduleRow = { pod: string; eta: string | null; ata: string | null }

/**
 * Monta os itens do rail. Estado de Conciliação usa apenas sinais baratos do
 * payload (CE + manifesto faltando); divergências (estado 'divergente') ficam
 * a cargo da view de detalhe, que consulta uma viagem por vez.
 */
export function buildVoyageRailItems(
  voyages: VoyageRailSource[] | null | undefined,
  podRowsByVoyageId: ReadonlyMap<number, PodScheduleRow[]>,
): VoyageRailItem[] {
  return (voyages ?? []).map((voyage) => {
    const podRows = podRowsByVoyageId.get(voyage.id) ?? []
    const { containerBls } = splitVoyageBls(voyage.bls)
    const { filled, total } = voyageCeCoverage(voyage.bls)

    return {
      id: voyage.id,
      carrierName: voyage.vessel?.carrier?.name ?? '',
      vesselName: voyage.vessel?.name ?? 'Navio',
      voyageNumber: voyage.voyage_number,
      status: normalizeVoyageStatus(voyage.status),
      originPorts: collectVoyagePorts(voyage.bls, 'pol', voyage.pol?.name ?? null),
      destinationPorts: collectVoyagePorts(
        voyage.bls,
        'pod',
        voyage.pod?.name ?? null,
        podRows.map((row) => row.pod),
      ),
      blCount: (voyage.bls ?? []).length,
      containerCount: countDistinctContainerNumbers(containerBls.flatMap((bl) => bl.bl_containers ?? [])),
      estado: deriveEstadoConciliacao({
        hasOpenDivergences: false,
        ceFilled: filled,
        ceTotal: total,
        hasMissingManifest: voyageHasMissingManifest({ bls: voyage.bls, batches: voyage.import_batches }),
      }),
      proximaEscala: getProximaEscala(podRows),
    }
  })
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
      ...containerBls.map((bl) => normalizePortName(bl.pod)),
      ...breakbulkBls.map((bl) => normalizePortName(bl.pod)),
    ]),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return pods.map((pod) => {
    const flat = containerBls
      .filter((bl) => normalizePortName(bl.pod) === pod)
      .flatMap((bl) => bl.bl_containers ?? [])
    const isVehicle = (container: { container_number?: string | null }) =>
      vehicleSet.has(String(container.container_number ?? '').trim().toUpperCase())
    const general = flat.filter((container) => !isVehicle(container))
    const vehicles = flat.filter(isVehicle)
    const podBreakbulk = breakbulkBls.filter((bl) => normalizePortName(bl.pod) === pod)

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
  vazios: { bookings: number; distinctContainers: number; types: string; destinations: string }
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
      ...granite.map((manifest) => normalizePortName(manifest.loading_port)),
      ...allBookings.map((booking) => normalizePortName(booking.origin_terminal)),
    ]),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return pols.map((pol) => {
    const polGranite = granite.filter((manifest) => normalizePortName(manifest.loading_port) === pol)
    const polBookings = allBookings.filter((booking) => normalizePortName(booking.origin_terminal) === pol)
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
        bookings: polBookings.length,
        distinctContainers: countDistinctContainerNumbers(polBookings),
        types: summarizeOccurrences(polBookings, (booking) => booking.container_type, 'Não informado'),
        destinations: summarizeUniqueValues(polBookings.map((booking) => booking.destination)),
      },
    }
  })
}
