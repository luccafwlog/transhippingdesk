import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addOccurrence,
  closeReport,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
  reopenReport,
  setSignoff,
  setTerminal,
} from '../services/agencyDepartureReport'

export function useAgencyReportDerived(voyageId: number, port: string | null) {
  return useQuery({
    queryKey: ['agency-report', voyageId, port],
    queryFn: () => getAgencyReportDerivedData(voyageId, port as string),
    enabled: Boolean(port),
  })
}

export function useAgencyReportOwn(voyageId: number, port: string | null) {
  return useQuery({
    queryKey: ['agency-report-own', voyageId, port],
    queryFn: () => getAgencyReportOwnData(voyageId, port as string),
    enabled: Boolean(port),
  })
}

function useAgencyReportOwnMutation<T>(mutationFn: (input: T) => Promise<void>, invalidateRelated = false) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agency-report-own'] })
      if (invalidateRelated) {
        // Fechamento/reabertura também altera alertas e os indicadores exibidos
        // no header, no Painel e na tela de Alertas.
        for (const queryKey of [
          ['agency-report'],
          ['alerts'],
          ['op-count'],
          ['header-alert'],
          ['dashboard'],
        ]) {
          void queryClient.invalidateQueries({ queryKey })
        }
      }
    },
  })
}

export function useSetAgencyReportSignoff() {
  return useAgencyReportOwnMutation(setSignoff)
}

export function useAddAgencyReportOccurrence() {
  return useAgencyReportOwnMutation(addOccurrence)
}

export function useSetAgencyReportTerminal() {
  return useAgencyReportOwnMutation(setTerminal)
}

export function useCloseAgencyReport() {
  return useAgencyReportOwnMutation(closeReport, true)
}

export function useReopenAgencyReport() {
  return useAgencyReportOwnMutation(reopenReport, true)
}
