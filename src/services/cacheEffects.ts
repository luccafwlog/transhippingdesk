import type { QueryClient } from '@tanstack/react-query'
import { invalidateReviewQueueCaches, type ReviewCacheScope } from '../components/review/reviewCaches'
import { invalidateBaplieDependentQueries } from './baplieInvalidation'

export type QueryInvalidator = {
  invalidateQueries: (input: { queryKey: readonly unknown[] }) => Promise<unknown>
}

const LINEUP_KEYS: readonly (readonly unknown[])[] = [['lineup-tv-v3'], ['lineup-tv-display-v2']]
const SCHEDULE_KEYS: readonly (readonly unknown[])[] = [
  ['voyage-pod-schedules'],
  ['voyage-pol-schedules'],
  ['voyage-export-schedules'],
  ['voyage-escala-schedules'],
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

export async function afterViagemAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [
    ['voyages'], ['voyage-options'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], ['bls'], ['containers'], ['dashboard'],
    voyageTimelineKey(options.voyageId), ...LINEUP_KEYS,
  ])
}

export async function afterEscalaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [...SCHEDULE_KEYS, voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterRotaAlterada(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  await invalidate(queryClient, [['voyage-route-ce-masters'], ['voyage-pol-schedules'], ['voyage-pod-schedules'], ['voyage-escala-schedules'], voyageTimelineKey(options.voyageId), ['voyages'], ...LINEUP_KEYS])
}

export async function afterManifestoImportado(queryClient: QueryInvalidator, options: { voyageId: number | string }): Promise<void> {
  const vId = String(options.voyageId)
  await invalidate(queryClient, [
    ['bls'], ['containers'], ['voyages'], ['port-options'],
    ['vazios-importacao-containers'], ['vazios-importacao-manifests'], ['vazios-importacao-stats'],
    ['baplie-reconciliation', vId], ['baplie-staging', vId],
    ['voyage-escala-schedules'], voyageTimelineKey(options.voyageId), ...LINEUP_KEYS,
  ])
}

export async function afterBaplieImportado(queryClient: QueryInvalidator, options: { voyageId: string }): Promise<void> {
  await invalidateBaplieDependentQueries(queryClient, options.voyageId)
}

export async function afterBlRevisado(queryClient: QueryClient, scope: ReviewCacheScope = {}): Promise<void> {
  await invalidateReviewQueueCaches(queryClient, scope)
}

export async function afterCustomerCommunicationDispatched(
  queryClient: QueryInvalidator,
  options: { customerId?: number; blIds?: readonly string[] } = {},
): Promise<void> {
  const keys: readonly (readonly unknown[])[] = [
    ['customer-communications'],
    ...(options.customerId != null ? [['customer-ficha', 'timeline', options.customerId] as const] : []),
    ...(options.blIds ?? []).map((blId) => ['bl-timeline', blId] as const),
  ]
  await invalidate(queryClient, keys)
}
