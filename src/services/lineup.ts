import { buildVoyagePodEntityId, listVoyagePodSchedulesByVoyageIds, type VoyagePodCeStatus } from './voyageRouteSchedules'
import { supabase } from './supabase'

export type VoyageStatus = 'active' | 'completed' | 'cancelled' | null

type LineUpVoyageRow = {
  id: number
  voyage_number: string
  status: VoyageStatus
  vessel: { name: string | null } | null
}

type LineUpBlRow = {
  id: string
  voyage_id: number
  pod: string | null
  cargo_mode: 'container' | 'carga_solta' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
}

type LineUpContainerRow = {
  id: number
  bl_id: string | null
  container_number: string | null
  tare_weight_kg: number | null
  gross_weight_kg: number | null
}

type LineUpVehicleRow = {
  voyage_id: number
  bl_id: string
  container_id: number
}

export type LineUpRow = {
  id: string
  voyageId: number
  voyageNumber: string
  voyageStatus: VoyageStatus
  vesselName: string
  pod: string
  eta: string | null
  etb: string | null
  vin: number
  car: number
  cg: number
  total: number
  mty: number
  rtw: number | null
  bbMachines: number
  bbPackages: number
  bbTotal: number
  ceStatus: VoyagePodCeStatus
  linked: boolean
}

export type LineUpSnapshot = {
  rows: LineUpRow[]
  lastChangedAt: string | null
}

export async function fetchLineUpSnapshot(): Promise<LineUpSnapshot> {
  const voyages = await fetchVoyages()
  const voyageIds = voyages.map((voyage) => voyage.id)
  if (!voyageIds.length) return { rows: [], lastChangedAt: null }

  const [bls, vehicles, vaziosImportacaoMtyByVoyage] = await Promise.all([
    fetchBlsByVoyageIds(voyageIds),
    fetchVehiclesByVoyageIds(voyageIds),
    fetchVaziosImportacaoMtyByVoyageIds(voyageIds).catch(() => new Map<number, number>()),
  ])

  const blIds = bls.map((bl) => bl.id)
  const containers = await fetchContainersByBlIds(blIds)

  const podSchedules = await listVoyagePodSchedulesByVoyageIds(voyageIds)
  const podSchedulesByVoyage = groupPodSchedulesByVoyage(podSchedules)

  const blsByVoyage = new Map<number, LineUpBlRow[]>()
  for (const bl of bls) {
    const current = blsByVoyage.get(bl.voyage_id) ?? []
    current.push(bl)
    blsByVoyage.set(bl.voyage_id, current)
  }

  const containersByBl = new Map<string, LineUpContainerRow[]>()
  for (const container of containers) {
    const blId = String(container.bl_id ?? '')
    if (!blId) continue
    const current = containersByBl.get(blId) ?? []
    current.push(container)
    containersByBl.set(blId, current)
  }

  const vehiclesByVoyage = new Map<number, LineUpVehicleRow[]>()
  for (const vehicle of vehicles) {
    const current = vehiclesByVoyage.get(vehicle.voyage_id) ?? []
    current.push(vehicle)
    vehiclesByVoyage.set(vehicle.voyage_id, current)
  }

  const rows: LineUpRow[] = []

  for (const voyage of voyages) {
    const voyageBls = blsByVoyage.get(voyage.id) ?? []
    const scheduledPods = (podSchedulesByVoyage.get(voyage.id) ?? []).map((schedule) => normalizePort(schedule.pod))
    const routePods = Array.from(new Set([...voyageBls.map((bl) => normalizePort(bl.pod)), ...scheduledPods]))
    const voyageVehicles = vehiclesByVoyage.get(voyage.id) ?? []

    for (const pod of routePods) {
      const routeBls = voyageBls.filter((bl) => normalizePort(bl.pod) === pod)
      const routeBlIds = new Set(routeBls.map((bl) => bl.id))
      const schedule = podSchedules.get(buildVoyagePodEntityId(voyage.id, pod))
      if (schedule?.atd) continue

      const distinctContainers = new Map<string, { id: number }>()

      for (const bl of routeBls) {
        for (const container of containersByBl.get(bl.id) ?? []) {
          const key = normalizeContainerKey(container.container_number, container.id)
          if (!key || distinctContainers.has(key)) continue
          distinctContainers.set(key, { id: container.id })
        }
      }

      const routeContainerIds = new Set(Array.from(distinctContainers.values()).map((container) => container.id))
      const routeVehicles = voyageVehicles.filter(
        (vehicle) => routeBlIds.has(vehicle.bl_id) || routeContainerIds.has(vehicle.container_id),
      )

      const vehicleContainerKeys = new Set<string>()
      for (const vehicle of routeVehicles) {
        for (const [containerKey, container] of distinctContainers.entries()) {
          if (container.id === vehicle.container_id) {
            vehicleContainerKeys.add(containerKey)
            break
          }
        }
      }

      const totalContainers = distinctContainers.size
      const carContainers = vehicleContainerKeys.size
      const ceFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
      const autoCeStatus =
        ceFilledCount === routeBls.length && routeBls.length > 0
          ? 'approved'
          : ceFilledCount > 0
            ? 'partial'
            : 'missing'

      const bbMachines = routeBls.reduce((sum, bl) => sum + Number(bl.bb_machine_qty ?? 0), 0)
      const bbPackages = routeBls.reduce((sum, bl) => sum + Number(bl.bb_packages_qty ?? 0), 0)

      rows.push({
        id: `${voyage.id}::${pod}`,
        voyageId: voyage.id,
        voyageNumber: voyage.voyage_number,
        voyageStatus: voyage.status,
        vesselName: voyage.vessel?.name ?? '-',
        pod,
        eta: schedule?.eta ?? null,
        etb: schedule?.etb ?? null,
        vin: routeVehicles.length,
        car: carContainers,
        cg: Math.max(totalContainers - carContainers, 0),
        total: totalContainers,
        mty: 0,
        rtw: schedule?.rtw ?? null,
        bbMachines,
        bbPackages,
        bbTotal: bbMachines + bbPackages,
        ceStatus: schedule?.ceStatus ?? autoCeStatus,
        linked: schedule?.linked ?? Boolean(schedule?.eta || schedule?.etb || schedule?.ata || schedule?.atd),
      })
    }
  }

  const sortedRows = rows.sort((left, right) => {
    if (left.vesselName !== right.vesselName) return left.vesselName.localeCompare(right.vesselName, 'pt-BR')
    if (left.voyageNumber !== right.voyageNumber) return left.voyageNumber.localeCompare(right.voyageNumber, 'pt-BR')
    return left.pod.localeCompare(right.pod, 'pt-BR')
  })

  // MTY = exclusively Vazios Importacao containers, credited to the first route of each voyage
  const creditedVoyageIds = new Set<number>()
  for (const row of sortedRows) {
    if (creditedVoyageIds.has(row.voyageId)) continue
    const vaziosImportacaoCount = vaziosImportacaoMtyByVoyage.get(row.voyageId) ?? 0
    row.mty = vaziosImportacaoCount
    creditedVoyageIds.add(row.voyageId)
  }

  const lastChangedAt = await fetchLastLineUpChangeAt(voyageIds, blIds, Array.from(podSchedules.keys()))

  return {
    rows: sortedRows,
    lastChangedAt,
  }
}

export async function fetchLineUpRows(): Promise<LineUpRow[]> {
  const snapshot = await fetchLineUpSnapshot()
  return snapshot.rows
}

async function fetchVoyages() {
  const { data, error } = await supabase
    .from('voyages')
    .select('id, voyage_number, status, vessel:vessels(name)')
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) throw error
  return (data ?? []) as unknown as LineUpVoyageRow[]
}

async function fetchBlsByVoyageIds(voyageIds: number[]) {
  const rows: LineUpBlRow[] = []

  for (const voyageChunk of chunkNumberArray(voyageIds, 25)) {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('bls')
        .select('id, voyage_id, pod, cargo_mode, ce_mercante, bb_machine_qty, bb_packages_qty')
        .in('voyage_id', voyageChunk)
        .order('id', { ascending: true })
        .range(from, from + 999)

      if (error) throw error
      const batch = (data ?? []) as unknown as LineUpBlRow[]
      if (!batch.length) break
      rows.push(...batch)
      if (batch.length < 1000) break
      from += 1000
    }
  }

  return rows
}

async function fetchContainersByBlIds(blIds: string[]) {
  const rows: LineUpContainerRow[] = []

  for (const blChunk of chunkStringArray(blIds, 250)) {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, tare_weight_kg, gross_weight_kg')
        .in('bl_id', blChunk)
        .order('id', { ascending: true })
        .range(from, from + 999)

      if (error) throw error
      const batch = (data ?? []) as unknown as LineUpContainerRow[]
      if (!batch.length) break
      rows.push(...batch)
      if (batch.length < 1000) break
      from += 1000
    }
  }

  return rows
}

async function fetchVehiclesByVoyageIds(voyageIds: number[]) {
  const rows: LineUpVehicleRow[] = []

  for (const voyageChunk of chunkNumberArray(voyageIds, 25)) {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('vehicles')
        .select('voyage_id, bl_id, container_id')
        .in('voyage_id', voyageChunk)
        .order('id', { ascending: true })
        .range(from, from + 999)

      if (error) throw error
      const batch = (data ?? []) as unknown as LineUpVehicleRow[]
      if (!batch.length) break
      rows.push(...batch)
      if (batch.length < 1000) break
      from += 1000
    }
  }

  return rows
}

async function fetchVaziosImportacaoMtyByVoyageIds(voyageIds: number[]) {
  const countByVoyage = new Map<number, number>()
  if (!voyageIds.length) return countByVoyage

  for (const voyageChunk of chunkNumberArray(voyageIds, 50)) {
    const { data: manifestRows, error: manifestError } = await supabase
      .from('vazios_importacao_manifests')
      .select('id, voyage_id')
      .in('voyage_id', voyageChunk)
    if (manifestError) throw manifestError

    const manifestToVoyage = new Map<string, number>()
    for (const row of (manifestRows ?? []) as unknown as Array<{ id: string; voyage_id: number | null }>) {
      if (row.voyage_id != null) manifestToVoyage.set(row.id, row.voyage_id)
    }
    if (!manifestToVoyage.size) continue

    const manifestIds = Array.from(manifestToVoyage.keys())
    for (const manifestChunk of chunkStringArray(manifestIds, 200)) {
      let from = 0
      while (true) {
        const { data: containerRows, error: containerError } = await supabase
          .from('vazios_importacao_containers')
          .select('manifest_id')
          .in('manifest_id', manifestChunk)
          .range(from, from + 999)
        if (containerError) throw containerError
        const batch = (containerRows ?? []) as unknown as Array<{ manifest_id: string }>
        if (!batch.length) break
        for (const container of batch) {
          const voyageId = manifestToVoyage.get(container.manifest_id)
          if (voyageId == null) continue
          countByVoyage.set(voyageId, (countByVoyage.get(voyageId) ?? 0) + 1)
        }
        if (batch.length < 1000) break
        from += 1000
      }
    }
  }

  return countByVoyage
}

async function fetchLastLineUpChangeAt(voyageIds: number[], blIds: string[], scheduleEntityIds: string[]) {
  const [voyageLatest, blLatest, containerLatest, vehicleLatest, scheduleLatest] = await Promise.all([
    fetchLatestTimestamp(
      supabase
        .from('voyages')
        .select('created_at')
        .in('id', voyageIds)
        .order('created_at', { ascending: false })
        .limit(1),
      'created_at',
    ),
    blIds.length
      ? fetchLatestTimestamp(
          supabase
            .from('bls')
            .select('updated_at')
            .in('id', blIds)
            .order('updated_at', { ascending: false })
            .limit(1),
          'updated_at',
        )
      : Promise.resolve<string | null>(null),
    blIds.length
      ? fetchLatestTimestamp(
          supabase
            .from('bl_containers')
            .select('created_at')
            .in('bl_id', blIds)
            .order('created_at', { ascending: false })
            .limit(1),
          'created_at',
        )
      : Promise.resolve<string | null>(null),
    fetchLatestTimestamp(
      supabase
        .from('vehicles')
        .select('created_at')
        .in('voyage_id', voyageIds)
        .order('created_at', { ascending: false })
        .limit(1),
      'created_at',
    ),
    scheduleEntityIds.length
      ? fetchLatestTimestamp(
          supabase
            .from('audit_logs')
            .select('changed_at')
            .eq('entity_type', 'voyage_pod_schedule')
            .in('entity_id', scheduleEntityIds)
            .order('changed_at', { ascending: false })
            .limit(1),
          'changed_at',
        )
      : Promise.resolve<string | null>(null),
  ])

  return [voyageLatest, blLatest, containerLatest, vehicleLatest, scheduleLatest]
    .filter(Boolean)
    .sort((left, right) => new Date(right!).getTime() - new Date(left!).getTime())[0] ?? null
}

async function fetchLatestTimestamp<T extends Record<string, unknown>>(
  queryPromise: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  field: keyof T,
) {
  const result = await queryPromise
  if (result.error) throw result.error
  const value = result.data?.[0]?.[field]
  return typeof value === 'string' ? value : null
}

function chunkNumberArray(values: number[], chunkSize: number) {
  if (!values.length) return []
  const chunks: number[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

function chunkStringArray(values: string[], chunkSize: number) {
  if (!values.length) return []
  const chunks: string[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

function normalizePort(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

function groupPodSchedulesByVoyage(
  schedules: Map<
    string,
    {
      voyageId: number
      pod: string
    }
  >,
) {
  const grouped = new Map<number, Array<{ voyageId: number; pod: string }>>()

  for (const schedule of schedules.values()) {
    const current = grouped.get(schedule.voyageId) ?? []
    current.push(schedule)
    grouped.set(schedule.voyageId, current)
  }

  return grouped
}

function normalizeContainerKey(containerNumber: string | null | undefined, containerId: number) {
  const number = String(containerNumber ?? '').trim().toUpperCase()
  if (number) return number
  return Number.isInteger(containerId) ? `ID-${containerId}` : ''
}

