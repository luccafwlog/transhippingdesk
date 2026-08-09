import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import type { PortalScheduleVoyage } from '../services/portalScheduleVoyages'
import type { ScheduleLaneInput } from '../services/voyageFromSchedule'

export type ScheduleForm = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  /** Data ISO por label de lane; '' = nao escala. */
  dates: Record<string, string>
}

export const emptyScheduleForm: ScheduleForm = {
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  dates: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [lane.label, ''])),
}

export function buildScheduleLanes(form: ScheduleForm): ScheduleLaneInput[] {
  return PORTAL_SCHEDULE_LANES.map((lane) => ({
    code: portalLaneCode(lane),
    kind: lane.kind,
    date: form.dates[lane.label]?.trim() ? form.dates[lane.label].trim() : null,
  }))
}

export function scheduleFormFromVoyage(voyage: PortalScheduleVoyage): ScheduleForm {
  return {
    vesselName: voyage.vesselName,
    vesselImo: voyage.imoNumber ?? '',
    voyageNumber: voyage.voyage,
    dates: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [lane.label, voyage.forecastDatesByLabel?.[lane.label] ?? voyage.datesByLabel[lane.label] ?? ''])),
  }
}
