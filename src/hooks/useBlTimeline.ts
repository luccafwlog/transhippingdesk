import { useInfiniteQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { BL_TIMELINE_PAGE_SIZE, fetchBlTimeline } from '../services/blTimeline'

export function useBlTimeline(blId?: string) {
  return useInfiniteQuery({
    queryKey: blId ? queryKeys.bls.timeline(blId) : queryKeys.bls.timeline('nil'),
    enabled: Boolean(blId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchBlTimeline(blId!, pageParam as number),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === BL_TIMELINE_PAGE_SIZE ? allPages.length * BL_TIMELINE_PAGE_SIZE : undefined,
  })
}
