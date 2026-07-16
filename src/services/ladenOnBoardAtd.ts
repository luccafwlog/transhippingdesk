import { normalizePortCode } from './portCode'
import { buildVoyagePolEntityId, listVoyagePolSchedules, saveVoyagePolSchedule } from './voyageRouteSchedules'

type LadenOnBoardAtdRow = {
  voyageId: number | null
  ladenOnBoard: string | null
  payload: { pol: string | null } | null
}

// ADR 0025: Laden on Board do B/L e a fonte documental do ATD do POL.
// Regra: entre B/Ls da mesma Viagem+POL, prevalece automaticamente a data mais antiga.
export function resolveCanonicalPolAtd(currentAtd: string | null, ladenDates: string[]): string | null {
  const candidates = [currentAtd, ...ladenDates].filter((date): date is string => Boolean(date))
  if (!candidates.length) return null
  return candidates.sort()[0]
}

/** Pos-commit do Importar B/L: aplica o menor Laden on Board como ATD do POL. */
export async function applyLadenOnBoardAtd(input: {
  rows: LadenOnBoardAtdRow[]
  changedBy: string | null
}) {
  const groups = new Map<string, { voyageId: number; pol: string; dates: string[] }>()

  for (const row of input.rows) {
    if (!row.voyageId || !row.payload || !row.ladenOnBoard) continue

    const pol = normalizePortCode(row.payload.pol)
    if (!pol) continue

    const entityId = buildVoyagePolEntityId(row.voyageId, pol)
    const group = groups.get(entityId) ?? { voyageId: row.voyageId, pol, dates: [] }
    group.dates.push(row.ladenOnBoard)
    groups.set(entityId, group)
  }

  if (!groups.size) return

  const currentSchedules = await listVoyagePolSchedules([...groups.keys()])

  for (const [entityId, group] of groups) {
    const current = currentSchedules.get(entityId)
    const currentAtd = current?.atd ?? null
    const nextAtd = resolveCanonicalPolAtd(currentAtd, group.dates)
    if (!nextAtd || nextAtd === currentAtd) continue

    await saveVoyagePolSchedule({
      voyageId: group.voyageId,
      pol: group.pol,
      etd: current?.etd ?? null,
      atd: nextAtd,
      changedBy: input.changedBy,
    })
  }
}
