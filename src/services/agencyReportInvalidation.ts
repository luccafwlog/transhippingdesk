export type AgencyReportQueryClient = {
  invalidateQueries(input: { queryKey: readonly unknown[] }): Promise<unknown>
}

export function invalidateAgencyReportForVoyage(queryClient: AgencyReportQueryClient, voyageId: number) {
  return queryClient.invalidateQueries({ queryKey: ['agency-report', voyageId] })
}
