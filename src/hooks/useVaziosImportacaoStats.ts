import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'

export type VoyageVaziosImportacaoStat = {
  totalManifests: number
  distinctContainers: number
  containerTypes: string
  destinations: string
}

const EMPTY_STAT: VoyageVaziosImportacaoStat = {
  totalManifests: 0,
  distinctContainers: 0,
  containerTypes: '',
  destinations: '',
}

export function useVaziosImportacaoStats(voyageIds: number[]) {
  const normalizedIds = useMemo(
    () => Array.from(new Set(voyageIds)).filter((id) => Number.isFinite(id)).sort((a, b) => a - b),
    [voyageIds],
  )

  return useQuery({
    queryKey: ['vazios-importacao-stats', normalizedIds],
    enabled: normalizedIds.length > 0,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const byVoyageId: Record<number, VoyageVaziosImportacaoStat> = {}

      const { data: manifests, error: manifestError } = await supabase
        .from('vazios_importacao_manifests')
        .select('id, voyage_id')
        .in('voyage_id', normalizedIds)
      if (manifestError) throw manifestError

      const rows = (manifests ?? []) as Array<{ id: string; voyage_id: number | null }>
      const manifestToVoyage = new Map<string, number>()
      const manifestCountByVoyage = new Map<number, number>()
      for (const row of rows) {
        if (row.voyage_id == null) continue
        manifestToVoyage.set(row.id, row.voyage_id)
        manifestCountByVoyage.set(row.voyage_id, (manifestCountByVoyage.get(row.voyage_id) ?? 0) + 1)
      }

      const manifestIds = Array.from(manifestToVoyage.keys())
      const containersByVoyage = new Map<number, { numbers: Set<string>; types: Map<string, number>; pods: Set<string> }>()

      if (manifestIds.length > 0) {
        let from = 0
        while (true) {
          const { data: containers, error: containerError } = await supabase
            .from('vazios_importacao_containers')
            .select('manifest_id, container_number, container_type, pod')
            .in('manifest_id', manifestIds)
            .range(from, from + 999)
          if (containerError) throw containerError
          const batch = (containers ?? []) as Array<{ manifest_id: string; container_number: string | null; container_type: string | null; pod: string | null }>
          if (!batch.length) break
          for (const c of batch) {
            const voyageId = manifestToVoyage.get(c.manifest_id)
            if (voyageId == null) continue
            const entry = containersByVoyage.get(voyageId) ?? { numbers: new Set(), types: new Map(), pods: new Set() }
            const num = String(c.container_number ?? '').trim().toUpperCase()
            if (num) entry.numbers.add(num)
            const type = String(c.container_type ?? '').trim() || 'Nao informado'
            entry.types.set(type, (entry.types.get(type) ?? 0) + 1)
            const pod = String(c.pod ?? '').trim()
            if (pod) entry.pods.add(pod)
            containersByVoyage.set(voyageId, entry)
          }
          if (batch.length < 1000) break
          from += 1000
        }
      }

      for (const voyageId of normalizedIds) {
        const entry = containersByVoyage.get(voyageId)
        const typeEntries = Array.from(entry?.types.entries() ?? [])
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => `${label} (${count})`)
        byVoyageId[voyageId] = {
          totalManifests: manifestCountByVoyage.get(voyageId) ?? 0,
          distinctContainers: entry?.numbers.size ?? 0,
          containerTypes: typeEntries.join(' | '),
          destinations: Array.from(entry?.pods ?? []).sort((a, b) => a.localeCompare(b, 'pt-BR')).join(' | '),
        }
      }

      return { byVoyageId }
    },
  })
}
