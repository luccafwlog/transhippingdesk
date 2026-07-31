import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  closeReport,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
  listClosedAgencyReportPorts,
  listSignoffEvents,
  reopenReport,
  setDepartmentSignoff,
  setSectionObservation,
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

// Portos com ADR fechado da viagem (Task 2 do ADR 2026-07-31): usado por
// VoyageCard para não sumir com a escala omitida que já tem ADR fechado.
export function useClosedAgencyReportPorts(voyageId: number) {
  return useQuery({
    queryKey: ['agency-report-closed-ports', voyageId],
    queryFn: () => listClosedAgencyReportPorts(voyageId),
  })
}

function useAgencyReportOwnMutation<T>(mutationFn: (input: T) => Promise<void>, extraKeys: string[] = []) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const queryKey of [['agency-report-own'], ...extraKeys.map((key) => [key])]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useSetAgencyReportSignoff() {
  return useAgencyReportOwnMutation(setSignoff, ['agency-report-signoff-events'])
}

export function useSetAgencyReportDepartmentSignoff() {
  return useAgencyReportOwnMutation(setDepartmentSignoff)
}

export function useSetAgencyReportSectionObservation() {
  return useAgencyReportOwnMutation(setSectionObservation)
}

export function useAgencyReportSignoffEvents(voyageId: number, port: string | null) {
  return useQuery({
    queryKey: ['agency-report-signoff-events', voyageId, port],
    queryFn: () => listSignoffEvents(voyageId, port as string),
    enabled: Boolean(port),
  })
}

export function useSetAgencyReportTerminal() {
  return useAgencyReportOwnMutation(setTerminal)
}

// Fechamento/reabertura também altera alertas e os indicadores exibidos no
// header, no Painel e na tela de Alertas.
const CLOSE_REOPEN_KEYS = ['agency-report', 'agency-report-signoff-events', 'alerts', 'op-count', 'header-alert', 'dashboard']

export function useCloseAgencyReport() {
  return useAgencyReportOwnMutation(closeReport, CLOSE_REOPEN_KEYS)
}

export function useReopenAgencyReport() {
  return useAgencyReportOwnMutation(reopenReport, CLOSE_REOPEN_KEYS)
}
