import { PORTAL_SCHEDULE_LANES, portalLaneCode, type PortalScheduleLaneKind } from './portalScheduleLanes'
import type { ScheduleLaneInput } from './voyageFromSchedule'

export type BulkScheduleRow = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  lanes: ScheduleLaneInput[]
}

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function laneColumn(label: string, kind: PortalScheduleLaneKind) {
  return `${label} ${kind === 'pol' ? 'ETD' : 'ETA'}`
}

function readCell(row: Record<string, unknown>, column: string) {
  return row[column] ?? row[stripAccents(column)]
}

export function scheduleTemplateColumns(): string[] {
  return ['VESSEL NAME', 'VOY', 'IMO', ...PORTAL_SCHEDULE_LANES.map((lane) => laneColumn(lane.label, lane.kind))]
}

export function parseCellDate(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!value || value.toUpperCase() === 'X') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return null
}

export function parseScheduleRows(rows: Array<Record<string, unknown>>): BulkScheduleRow[] {
  return rows
    .map((row) => {
      const vesselName = String(row['VESSEL NAME'] ?? row['Vessel Name'] ?? '').trim()
      const voyageNumber = String(row.VOY ?? '').trim()
      const vesselImo = String(row.IMO ?? '').trim()
      const lanes = PORTAL_SCHEDULE_LANES.map((lane) => ({
        code: portalLaneCode(lane),
        kind: lane.kind,
        date: parseCellDate(readCell(row, laneColumn(lane.label, lane.kind)) ?? row[lane.label]),
      }))
      return { vesselName, vesselImo, voyageNumber, lanes }
    })
    .filter((row) => row.vesselName && row.voyageNumber && row.vesselName !== 'EXEMPLO NAVIO')
}
