import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { normalizeText } from '../lib/utils'
import { supabase } from '../services/supabase'
import type { VehicleListItem } from '../types/database'

export type VehiclePageFilters = {
  search: string
  container: string
  bl: string
  page: number
  pageSize: number
}

export function useVehicleOptions() {
  return useQuery({
    queryKey: ['vehicle-voyage-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voyages')
        .select('id, voyage_number, vessel:vessels(id, name)')
        .order('created_at', { ascending: false })
        .range(0, 999)

      if (error) throw error

      const voyages = (data ?? []) as Array<{
        id: number
        voyage_number: string
        vessel?: { id: number; name: string } | null
      }>

      const vesselMap = new Map<number, { id: number; name: string }>()
      for (const voyage of voyages) {
        if (voyage.vessel?.id && voyage.vessel.name) {
          vesselMap.set(voyage.vessel.id, { id: voyage.vessel.id, name: voyage.vessel.name })
        }
      }

      return {
        vessels: Array.from(vesselMap.values()).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
        voyages,
      }
    },
  })
}

export function useVehicles(voyageId: number | null, filters: VehiclePageFilters) {
  const query = useQuery({
    queryKey: ['vehicles', voyageId],
    enabled: Boolean(voyageId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select(
          `
          *,
          container:bl_containers(id, container_number, type, seal_number),
          bl:bls(id, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name)))
        `,
        )
        .eq('voyage_id', voyageId!)
        .order('created_at', { ascending: false })
        .range(0, 4999)

      if (error) throw error
      return (data ?? []) as unknown as VehicleListItem[]
    },
  })

  const filtered = useMemo(() => {
    const rows = query.data ?? []
    const searchTerm = normalizeText(filters.search)
    const containerTerm = normalizeText(filters.container)
    const blTerm = normalizeText(filters.bl)

    return rows.filter((row) => {
      if (searchTerm && !normalizeText(row.chassis).includes(searchTerm)) return false
      if (containerTerm && !normalizeText(row.container?.container_number ?? '').includes(containerTerm)) return false
      if (blTerm && !normalizeText(row.bl?.id ?? '').includes(blTerm)) return false
      return true
    })
  }, [filters.bl, filters.container, filters.search, query.data])

  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize

  return {
    ...query,
    data: {
      rows: filtered.slice(from, to),
      count: filtered.length,
      totalWeightKg: filtered.reduce((sum, row) => sum + Number(row.weight_kg ?? 0), 0),
      totalCbm: filtered.reduce((sum, row) => sum + Number(row.cbm ?? 0), 0),
      distinctContainerCount: new Set(filtered.map((row) => row.container?.container_number).filter(Boolean)).size,
      distinctBlCount: new Set(filtered.map((row) => row.bl?.id).filter(Boolean)).size,
    },
  }
}
