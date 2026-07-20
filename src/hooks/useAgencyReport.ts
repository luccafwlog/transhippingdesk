import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addOccurrence,
  closeReport,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
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

function useAgencyReportOwnMutation<T>(mutationFn: (input: T) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agency-report-own'] }),
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
  return useAgencyReportOwnMutation(closeReport)
}
