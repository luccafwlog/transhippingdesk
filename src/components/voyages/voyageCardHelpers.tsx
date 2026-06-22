import {
  buildVoyagePolEntityId,
  getVoyagePodCeStatusLabel,
  type VoyagePodCeStatus,
} from '../../services/voyageRouteSchedules'
import { formatPortDisplayName, stripFileExtension, type VoyageBl } from '../../pages/viagensHelpers'

export function renderEscalaNumber(value: string | null) {
  if (!value) return <span className="text-[var(--app-muted-soft)]">-</span>
  return <span className="font-mono text-xs text-[var(--app-text-strong)]">{value}</span>
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
}: {
  voyageId: number
  batches: VoyageImportBatch[] | null | undefined
  bls: VoyageBl[] | null | undefined
  polSchedules?: Map<string, { etd: string | null; escalaNumber?: string | null }> | undefined
}) {
  const blsByBatch = new Map<number, VoyageBl[]>()
  for (const bl of bls ?? []) {
    if (!bl.batch_id) continue
    const current = blsByBatch.get(bl.batch_id) ?? []
    current.push(bl)
    blsByBatch.set(bl.batch_id, current)
  }

  // Arquivos de manifesto distintos da mesma rota (POL -> POD) compõem o mesmo
  // manifesto: agrupamos por rota e somamos B/Ls e cobertura de CE numa única
  // linha. ETD é por POL; o CE Master é único (mesmo manifesto).
  type ManifestGroup = {
    routeKey: string
    pol: string
    routeLabel: string
    batchIds: number[]
    filenames: string[]
    modes: Set<'container' | 'carga_solta'>
    etd: string | null
    blCount: number
    ceFilled: number
    ceTotal: number
    ceMaster: string | null
    sortDate: number
  }

  const groups = new Map<string, ManifestGroup>()

  for (const batch of batches ?? []) {
    const batchBls = blsByBatch.get(batch.id) ?? []
    const pol = batchBls[0]?.pol?.trim() || '-'
    const pod = batchBls[0]?.pod?.trim() || '-'
    const routeKey = `${pol}__${pod}`
    const polEntity = polSchedules?.get(buildVoyagePolEntityId(voyageId, pol))
    const ceFilled = batchBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    const sortDate = Date.parse(batch.uploaded_at ?? '')

    const group: ManifestGroup =
      groups.get(routeKey) ?? {
        routeKey,
        pol,
        routeLabel: `${formatPortDisplayName(pol)} -> ${formatPortDisplayName(pod)}`,
        batchIds: [],
        filenames: [],
        modes: new Set(),
        etd: polEntity?.etd ?? null,
        blCount: 0,
        ceFilled: 0,
        ceTotal: 0,
        ceMaster: null,
        sortDate: Number.POSITIVE_INFINITY,
      }

    group.batchIds.push(batch.id)
    group.filenames.push(stripFileExtension(batch.filename || `manifesto-${batch.id}`))
    if (batch.cargo_mode) group.modes.add(batch.cargo_mode)
    group.blCount += Number(batch.total_bls ?? batchBls.length)
    group.ceFilled += ceFilled
    group.ceTotal += batchBls.length
    if (!group.ceMaster && batch.ce_master) group.ceMaster = batch.ce_master
    if (Number.isFinite(sortDate)) group.sortDate = Math.min(group.sortDate, sortDate)

    groups.set(routeKey, group)
  }

  return Array.from(groups.values())
    .map((group) => ({
      routeKey: group.routeKey,
      pol: group.pol,
      routeLabel: group.routeLabel,
      modeLabel:
        group.modes.has('container') && group.modes.has('carga_solta')
          ? 'CNTR/BB'
          : group.modes.has('carga_solta')
            ? 'BB'
            : 'CNTR',
      filenames: group.filenames,
      batchIds: group.batchIds,
      etd: group.etd,
      blCount: group.blCount,
      ceFilled: group.ceFilled,
      ceTotal: group.ceTotal,
      ceMaster: group.ceMaster,
      sortDate: group.sortDate,
    }))
    .sort((left, right) => {
      if (Number.isFinite(left.sortDate) && Number.isFinite(right.sortDate) && left.sortDate !== right.sortDate) {
        return left.sortDate - right.sortDate
      }
      return left.routeLabel.localeCompare(right.routeLabel, 'pt-BR')
    })
}
