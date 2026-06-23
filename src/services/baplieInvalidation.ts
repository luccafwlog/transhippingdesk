type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => Promise<unknown>
}

export async function invalidateBaplieDependentQueries(
  queryClient: QueryInvalidator,
  voyageId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] }),
    queryClient.invalidateQueries({ queryKey: ['bls'] }),
    queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
    queryClient.invalidateQueries({ queryKey: ['voyages'] }),
    queryClient.invalidateQueries({ queryKey: ['voyage-timeline', voyageId] }),
  ])
}
