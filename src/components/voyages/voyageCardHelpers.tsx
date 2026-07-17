import {
  buildVoyagePolEntityId,
  getVoyagePodCeStatusLabel,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import { formatPortDisplayName, stripFileExtension } from '../../lib/voyageFormat'
import type { VoyageBl } from '../../services/voyageSummaries'

export function renderEscalaNumber(value: string | null) {
  if (!value) return <span className="text-[var(--app-muted-soft)]">-</span>
  return <span className="font-mono text-xs text-[var(--app-text-strong)]">{value}</span>
}

export function formatPolDeparture(etd: string | null, atd: string | null) {
  return atd ? { value: atd, isActual: true as const } : { value: etd, isActual: false as const }
}

export function renderCeStatusLabel(status: VoyagePodCeStatus | null) {
  return getVoyagePodCeStatusLabel(status)
}

export function renderLinkedLabel(linked: boolean | null) {
  return linked ? 'SIM' : 'NÃO'
}

export function renderCeCoverage(filled: number, total: number) {
  if (total === 0) return <span className="text-[var(--app-muted-soft)]">-</span>
  const color = filled >= total ? '#1f7a4d' : filled > 0 ? '#b8860b' : '#cf4b3f'
  return (
    <span className="font-semibold" style={{ color }}>
      {filled}/{total}
    </span>
  )
}

export type VoyageImportBatch = {
  id: number
  voyage_id: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  filename: string
  uploaded_at: string | null
  status: 'processing' | 'completed' | 'partial' | 'failed' | null
  total_bls: number | null
  ce_master: string | null
}

export function collectVoyageManifestBatchRows({
  voyageId,
  batches,
  bls,
  polSchedules,
  routeCeMasters,
}: {
  voyageId: number
  batches: VoyageImportBatch[] | null | undefined
  bls: VoyageBl[] | null | undefined
  polSchedules?: Map<string, { etd: string | null; atd?: string | null; escalaNumber?: string | null }> | undefined
  /** CE Master por rota (#322): fallback para viagens só-B/L sem batch. Chave `${voyageId}::${POL}__${POD}`. */
  routeCeMasters?: Map<string, string> | undefined
}) {
  const batchesById = new Map<number, VoyageImportBatch>()
  for (const batch of batches ?? []) {
    batchesById.set(batch.id, batch)
  }

  const blsByBatch = new Map<number, VoyageBl[]>()
  for (const bl of bls ?? []) {
    if (bl.batch_id === null || bl.batch_id === undefined) continue
    const current = blsByBatch.get(bl.batch_id) ?? []
    current.push(bl)
    blsByBatch.set(bl.batch_id, current)
  }

  // A linha nasce da rota dos B/Ls; batches entram como metadados quando existem.
  // Assim importacoes de B/L sem arquivo de manifesto tambem aparecem na tela.
  type ManifestGroup = {
    routeKey: string
    pol: string
    pod: string
    routeLabel: string
    batchIds: number[]
    filenames: string[]
    modes: Set<'container' | 'carga_solta'>
    etd: string | null
    atd: string | null
    blCount: number
    ceFilled: number
    ceTotal: number
    ceMaster: string | null
    sortDate: number
  }

  const groups = new Map<string, ManifestGroup>()

  function normalizeManifestPort(value: string | null | undefined) {
    return String(value ?? '').trim().toUpperCase() || '-'
  }

  function getGroup(polValue: string | null | undefined, podValue: string | null | undefined) {
    const pol = normalizeManifestPort(polValue)
    const pod = normalizeManifestPort(podValue)
    const routeKey = `${pol}__${pod}`
    const existing = groups.get(routeKey)
    if (existing) return existing

    const polEntity = polSchedules?.get(buildVoyagePolEntityId(voyageId, pol))

    const group: ManifestGroup = {
      routeKey,
      pol,
      pod,
      routeLabel: `${formatPortDisplayName(pol)} -> ${formatPortDisplayName(pod)}`,
      batchIds: [],
      filenames: [],
      modes: new Set(),
      etd: polEntity?.etd ?? null,
      atd: polEntity?.atd ?? null,
      blCount: 0,
      ceFilled: 0,
      ceTotal: 0,
      ceMaster: null,
      sortDate: Number.POSITIVE_INFINITY,
    }

    groups.set(routeKey, group)
    return group
  }

  function attachBatchMetadata(group: ManifestGroup, batch: VoyageImportBatch) {
    if (!group.batchIds.includes(batch.id)) {
      group.batchIds.push(batch.id)
    }
    const filename = stripFileExtension(batch.filename || `manifesto-${batch.id}`)
    if (!group.filenames.includes(filename)) {
      group.filenames.push(filename)
    }
    if (batch.cargo_mode) group.modes.add(batch.cargo_mode)
    if (!group.ceMaster && batch.ce_master) group.ceMaster = batch.ce_master
    const sortDate = Date.parse(batch.uploaded_at ?? '')
    if (Number.isFinite(sortDate)) group.sortDate = Math.min(group.sortDate, sortDate)
  }

  for (const bl of bls ?? []) {
    const group = getGroup(bl.pol, bl.pod)
    group.blCount += 1
    group.ceTotal += 1
    if (String(bl.ce_mercante ?? '').trim()) group.ceFilled += 1
    group.modes.add(bl.cargo_mode === 'carga_solta' ? 'carga_solta' : 'container')

    if (bl.batch_id !== null && bl.batch_id !== undefined) {
      const batch = batchesById.get(bl.batch_id)
      if (batch) attachBatchMetadata(group, batch)
    }
  }

  for (const batch of batches ?? []) {
    if (Array.from(groups.values()).some((group) => group.batchIds.includes(batch.id))) continue

    const batchBls = blsByBatch.get(batch.id) ?? []
    const group = getGroup(batchBls[0]?.pol, batchBls[0]?.pod)
    attachBatchMetadata(group, batch)
    group.blCount += Number(batch.total_bls ?? batchBls.length)
    group.ceFilled += batchBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    group.ceTotal += batchBls.length
  }

  return Array.from(groups.values())
    .map((group) => ({
      routeKey: group.routeKey,
      pol: group.pol,
      pod: group.pod,
      routeLabel: group.routeLabel,
      modeLabel:
        group.modes.has('container') && group.modes.has('carga_solta')
          ? 'CNTR/BB'
          : group.modes.has('carga_solta')
            ? 'BB'
            : 'CNTR',
      filenames: group.filenames.length ? group.filenames : ['Rota derivada dos B/Ls'],
      batchIds: group.batchIds,
      etd: group.etd,
      atd: group.atd,
      blCount: group.blCount,
      ceFilled: group.ceFilled,
      ceTotal: group.ceTotal,
      ceMaster: group.ceMaster ?? routeCeMasters?.get(`${voyageId}::${group.routeKey}`) ?? null,
      sortDate: group.sortDate,
    }))
    .sort((left, right) => {
      if (Number.isFinite(left.sortDate) && Number.isFinite(right.sortDate) && left.sortDate !== right.sortDate) {
        return left.sortDate - right.sortDate
      }
      return left.routeLabel.localeCompare(right.routeLabel, 'pt-BR')
    })
}
