export type BaplieVoyageCardInput = {
  id: number
  voyageNumber: string
  vesselName: string | null
  carrierName: string | null
  hasBaplie: boolean
  escalas: Array<{
    port: string
    eta: string | null
    etd: string | null
    atd: string | null
    deleted?: boolean
  }>
}

export type BaplieVoyageCard = BaplieVoyageCardInput & {
  nextScheduleDate: string | null
  escalas: BaplieVoyageCardInput['escalas']
}

export function buildBaplieVoyageCards(voyages: BaplieVoyageCardInput[]): BaplieVoyageCard[] {
  return voyages
    .map((voyage) => {
      const escalas = voyage.escalas
        .filter((escala) => !escala.deleted)
        .sort((left, right) => (scheduleDate(left) ?? '9999').localeCompare(scheduleDate(right) ?? '9999'))
      return {
        ...voyage,
        escalas,
        nextScheduleDate: scheduleDate(escalas[0]),
      }
    })
    .sort((left, right) => {
      const leftDate = left.nextScheduleDate ?? '9999-12-31'
      const rightDate = right.nextScheduleDate ?? '9999-12-31'
      return leftDate.localeCompare(rightDate) || `${left.vesselName ?? ''}/${left.voyageNumber}`.localeCompare(`${right.vesselName ?? ''}/${right.voyageNumber}`, 'pt-BR')
    })
}

function scheduleDate(schedule: BaplieVoyageCardInput['escalas'][number] | undefined) {
  if (!schedule) return null
  return [schedule.eta, schedule.etd, schedule.atd].filter(Boolean).sort()[0] ?? null
}
