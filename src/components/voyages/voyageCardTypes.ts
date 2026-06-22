import type { useVoyages } from '../../hooks/useBls'
import type { VoyagePodCeStatus } from '../../services/voyageRouteSchedules'

export type Voyage = NonNullable<ReturnType<typeof useVoyages>['data']>[number]

export type EditingPodPayload = {
  voyageId: number
  voyageLabel: string
  pod: string
  eta: string | null
  etb: string | null
  ata: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber: string | null
}

export type EditingPolPayload = {
  voyageId: number
  voyageLabel: string
  pol: string
  etd: string | null
  ceMaster: string | null
  batchIds: number[]
}

export type EditingExportPayload = {
  voyageId: number
  voyageLabel: string
  existing: import('../../services/voyageExportSchedules').VoyageExportSchedule | null
}

export type AddingPodPayload = { voyageId: number; voyageLabel: string }

// Linha da tabela de planejamento POD, derivada do schedule + cobertura de CE.
export type VoyagePodRow = {
  pod: string
  eta: string | null
  etb: string | null
  ata: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  escalaNumber: string | null
}
