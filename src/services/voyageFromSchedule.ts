import { DEFAULT_CARRIER_NAME, DEFAULT_CARRIER_SCAC } from './voyageForm'
import { supabase } from './supabase'
import {
  createVoyage,
  findVoyageByNumberAndVessel,
  setVoyageShowOnPortal,
} from './voyages'
import {
  buildVoyagePodEntityId,
  buildVoyagePolEntityId,
  deleteVoyagePodSchedule,
  listVoyagePodSchedules,
  listVoyagePolSchedules,
  saveVoyagePodSchedule,
  saveVoyagePolSchedule,
  type VoyagePodSchedule,
} from './voyageRouteSchedules'

export type ScheduleLaneInput = {
  /** Code canonico do porto (de portalLaneCode). */
  code: string
  kind: 'pol' | 'pod'
  /** Data ISO (YYYY-MM-DD) ou null/'' quando o porto nao escala. */
  date: string | null
}

export type VoyageScheduleInput = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
}

export type ScheduleWriteMode = 'form' | 'bulk'

export type ScheduleWriteOptions = {
  mode?: ScheduleWriteMode
  /** Viagem alvo conhecida (edicao): pula a deduplicacao por VOY+navio. */
  voyageId?: number
}

export function partitionScheduleLanes(lanes: ScheduleLaneInput[]) {
  const pols: Array<{ code: string; etd: string }> = []
  const pods: Array<{ pod: string; eta: string }> = []
  for (const lane of lanes) {
    const date = (lane.date ?? '').trim()
    if (!date) continue
    if (lane.kind === 'pol') pols.push({ code: lane.code, etd: date })
    else pods.push({ pod: lane.code, eta: date })
  }
  return { pols, pods }
}

function collectClearedLanes(lanes: ScheduleLaneInput[]) {
  const pols: string[] = []
  const pods: string[] = []
  for (const lane of lanes) {
    if ((lane.date ?? '').trim()) continue
    if (lane.kind === 'pol') pols.push(lane.code)
    else pods.push(lane.code)
  }
  return { pols, pods }
}

async function podHasOperationalAnchor(
  voyageId: number,
  podCode: string,
  current: VoyagePodSchedule | undefined,
): Promise<boolean> {
  if (current?.linked || current?.ata || current?.atd) return true
  const { data, error } = await supabase
    .from('bls')
    .select('id')
    .eq('voyage_id', voyageId)
    .eq('pod', podCode)
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

async function cancelClearedLanes(
  voyageId: number,
  lanes: ScheduleLaneInput[],
  changedBy: string | null,
) {
  const cleared = collectClearedLanes(lanes)

  const clearedPolIds = cleared.pols.map((code) => buildVoyagePolEntityId(voyageId, code))
  const currentPols = await listVoyagePolSchedules(clearedPolIds)
  await Promise.all(cleared.pols.map((code) => {
    const current = currentPols.get(buildVoyagePolEntityId(voyageId, code))
    if (!current?.etd) return Promise.resolve()
    return saveVoyagePolSchedule({ voyageId, pol: code, etd: null, changedBy })
  }))

  const clearedPodIds = cleared.pods.map((code) => buildVoyagePodEntityId(voyageId, code))
  const currentPods = await listVoyagePodSchedules(clearedPodIds)
  await Promise.all(cleared.pods.map(async (code) => {
    const current = currentPods.get(buildVoyagePodEntityId(voyageId, code))
    if (!current) return
    const anchored = await podHasOperationalAnchor(voyageId, code, current)
    if (anchored) {
      if (current.eta === null) return
      await saveVoyagePodSchedule({
        voyageId,
        pod: code,
        eta: null,
        etb: current.etb ?? null,
        ata: current.ata ?? null,
        atd: current.atd ?? null,
        rtw: current.rtw ?? null,
        ceStatus: current.ceStatus ?? null,
        linked: current.linked ?? false,
        changedBy,
      })
      return
    }
    await deleteVoyagePodSchedule({ voyageId, pod: code, changedBy })
  }))
}

export async function createOrAttachVoyageFromSchedule(
  input: VoyageScheduleInput,
  changedBy: string | null,
  options: ScheduleWriteOptions = {},
) {
  const mode = options.mode ?? 'bulk'
  const { pols, pods } = partitionScheduleLanes(input.lanes)
  const existingId = options.voyageId
    ?? await findVoyageByNumberAndVessel(input.voyageNumber, input.vesselImo, input.vesselName)
  const voyageId = existingId ?? (await createVoyage({
    carrierName: DEFAULT_CARRIER_NAME,
    carrierScac: DEFAULT_CARRIER_SCAC,
    vesselName: input.vesselName,
    vesselImo: input.vesselImo,
    voyageNumber: input.voyageNumber,
    status: 'active',
    loadPortEtds: [],
    dischargePortEtas: [],
  }, changedBy)).id

  await setVoyageShowOnPortal(voyageId, true)

  await Promise.all(pols.map((pol) => saveVoyagePolSchedule({
    voyageId,
    pol: pol.code,
    etd: pol.etd,
    changedBy,
  })))

  const entityIds = pods.map((pod) => buildVoyagePodEntityId(voyageId, pod.pod))
  const currentSchedules = await listVoyagePodSchedules(entityIds)

  await Promise.all(pods.map((pod) => {
    const current = currentSchedules.get(buildVoyagePodEntityId(voyageId, pod.pod))
    return saveVoyagePodSchedule({
      voyageId,
      pod: pod.pod,
      eta: pod.eta,
      etb: current?.etb ?? null,
      ata: current?.ata ?? null,
      atd: current?.atd ?? null,
      rtw: current?.rtw ?? null,
      ceStatus: current?.ceStatus ?? null,
      linked: current?.linked ?? false,
      changedBy,
    })
  }))

  if (mode === 'form') {
    await cancelClearedLanes(voyageId, input.lanes, changedBy)
  }

  return { voyageId, created: existingId === null }
}
