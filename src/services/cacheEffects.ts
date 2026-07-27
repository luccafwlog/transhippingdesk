export type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => Promise<unknown>
}

const LINEUP_KEYS: readonly (readonly unknown[])[] = [['lineup-tv-v3'], ['lineup-tv-display-v2']]
const SCHEDULE_KEYS: readonly (readonly unknown[])[] = [
  ['voyage-pod-schedules'],
  ['voyage-pol-schedules'],
  ['voyage-export-schedules'],
]

function voyageTimelineKey(voyageId: number | string): readonly unknown[] {
  return ['voyage-timeline', String(voyageId)]
}

async function invalidate(queryClient: QueryInvalidator, keys: readonly (readonly unknown[])[]): Promise<void> {
  const seen = new Set<string>()
  const unique = keys.filter((key) => {
    const id = JSON.stringify(key)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  await Promise.all(unique.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export async function afterViagemAlterada(
  queryClient: QueryInvalidator,
  options: { voyageId?: number | string } = {},
): Promise<void> {
  await invalidate(queryClient, [
    ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['bls'], ['containers'], ['dashboard'],
    ...(options.voyageId === undefined ? [] : [voyageTimelineKey(options.voyageId)]), ...LINEUP_KEYS,
  ])
}

export async function afterEscalaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [...SCHEDULE_KEYS, voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterRotaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [['voyage-route-ce-masters'], ['voyage-pol-schedules'], ['voyage-pod-schedules'], voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterManifestoImportado(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [['bls'], ['containers'], ['voyages'], ['port-options'], voyageTimelineKey(options.voyageId), ...LINEUP_KEYS])
}
