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

export type VoyageVehicleStat = {
  totalVehicles: number
  distinctContainerCount: number
  containerNumbers: string[]
  brandSummary: string
  vehicleByContainerTypeSummary: string
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

      const voyages = (data ?? []) as unknown as Array<{
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
      const batchSize = 1000
      const rows: VehicleListItem[] = []
      let from = 0

      while (true) {
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
          .range(from, from + batchSize - 1)

        if (error) throw error

        const batch = (data ?? []) as unknown as VehicleListItem[]
        if (!batch.length) break

        rows.push(...batch)
        if (batch.length < batchSize) break
        from += batchSize
      }

      return rows
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

  const brandMap = new Map<string, number>()
  const vehicleTypeMap = new Map<string, number>()
  const containerTypeMap = new Map<string, Set<string>>()

  for (const row of filtered) {
    const brand = String(row.brand ?? '').trim() || 'Nao informado'
    brandMap.set(brand, (brandMap.get(brand) ?? 0) + 1)

    const containerType = String(row.container?.type ?? '').trim() || 'Nao informado'
    vehicleTypeMap.set(containerType, (vehicleTypeMap.get(containerType) ?? 0) + 1)

    const containerNumber = String(row.container?.container_number ?? '').trim().toUpperCase()
    const currentSet = containerTypeMap.get(containerType) ?? new Set<string>()
    if (containerNumber) {
      currentSet.add(containerNumber)
    }
    containerTypeMap.set(containerType, currentSet)
  }

  return {
    ...query,
    data: {
      rows: filtered.slice(from, to),
      count: filtered.length,
      totalWeightKg: filtered.reduce((sum, row) => sum + Number(row.weight_kg ?? 0), 0),
      totalCbm: filtered.reduce((sum, row) => sum + Number(row.cbm ?? 0), 0),
      distinctContainerCount: new Set(filtered.map((row) => row.container?.container_number).filter(Boolean)).size,
      distinctBlCount: new Set(filtered.map((row) => row.bl?.id).filter(Boolean)).size,
      vehiclesByBrand: Array.from(brandMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
      vehiclesByContainerType: Array.from(vehicleTypeMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
      containersByContainerType: Array.from(containerTypeMap.entries())
        .map(([label, numbers]) => ({ label, count: numbers.size }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'pt-BR')),
    },
  }
}

export function useVoyageVehicleStats(voyageIds: number[]) {
  const normalizedVoyageIds = useMemo(
    () => Array.from(new Set(voyageIds)).filter((id) => Number.isFinite(id)).sort((left, right) => left - right),
    [voyageIds],
  )

  return useQuery({
    queryKey: ['voyage-vehicle-stats', normalizedVoyageIds],
    enabled: normalizedVoyageIds.length > 0,
    queryFn: async () => {
      const batchSize = 1000
      const byVoyageId: Record<number, VoyageVehicleStat> = {}
      const working = new Map<
        number,
        {
          totalVehicles: number
          containers: Set<string>
          brands: Map<string, number>
          vehicleByContainerType: Map<string, number>
        }
      >()

      for (const voyageChunk of chunkNumberArray(normalizedVoyageIds, 200)) {
        let from = 0

        while (true) {
          const { data, error } = await supabase
            .from('vehicles')
            .select('id, voyage_id, brand, container:bl_containers(container_number, type)')
            .in('voyage_id', voyageChunk)
            .order('id', { ascending: true })
            .range(from, from + batchSize - 1)

          if (error) throw error

          const rows = (data ?? []) as Array<{
            id: number
            voyage_id: number
            brand: string | null
            container?: { container_number?: string | null; type?: string | null } | null
          }>

          if (!rows.length) break

          for (const row of rows) {
            const current =
              working.get(row.voyage_id) ??
              {
                totalVehicles: 0,
                containers: new Set<string>(),
                brands: new Map<string, number>(),
                vehicleByContainerType: new Map<string, number>(),
              }

            current.totalVehicles += 1

            const brand = String(row.brand ?? '').trim() || 'Nao informado'
            current.brands.set(brand, (current.brands.get(brand) ?? 0) + 1)

            const containerType = String(row.container?.type ?? '').trim() || 'Nao informado'
            current.vehicleByContainerType.set(
              containerType,
              (current.vehicleByContainerType.get(containerType) ?? 0) + 1,
            )

            const containerNumber = String(row.container?.container_number ?? '').trim().toUpperCase()
            if (containerNumber) {
              current.containers.add(containerNumber)
            }

            working.set(row.voyage_id, current)
          }

          if (rows.length < batchSize) break
          from += batchSize
        }
      }

      for (const voyageId of normalizedVoyageIds) {
        const current = working.get(voyageId)
        byVoyageId[voyageId] = {
          totalVehicles: current?.totalVehicles ?? 0,
          distinctContainerCount: current?.containers.size ?? 0,
          containerNumbers: current ? Array.from(current.containers).sort((left, right) => left.localeCompare(right, 'pt-BR')) : [],
          brandSummary: summarizeCounts(current?.brands),
          vehicleByContainerTypeSummary: summarizeCounts(current?.vehicleByContainerType),
        }
      }

      return { byVoyageId }
    },
  })
}

function summarizeCounts(source?: Map<string, number>) {
  if (!source || source.size === 0) return '-'

  return Array.from(source.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .slice(0, 6)
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}

function chunkNumberArray(values: number[], chunkSize: number) {
  if (!values.length) return []
  const chunks: number[][] = []

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }

  return chunks
}
