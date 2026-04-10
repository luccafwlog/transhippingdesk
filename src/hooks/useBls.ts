import {
  countDistinctContainerNumbers,
  countDistinctContainerNumbersBy,
  countDistinctContainersAcrossGroups,
} from '../lib/containerCounts'
import { useQuery } from '@tanstack/react-query'
import { normalizeText } from '../lib/utils'
import { supabase } from '../services/supabase'
import type { AuditLog, BL, BLDetail, BLListItem, ContainerListItem } from '../types/database'

const blSelect = `
  *,
  customer:customers(id, cnpj_cpf, name),
  voyage:voyages(id, voyage_number, eta, ata, status, vessel:vessels(id, name, carrier:carriers(id, name, scac))),
  bl_containers(id, bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number, created_at)
`

const exportBatchSize = 1000

export type BlFilters = {
  search: string
  voyageId: string
  pol: string
  pod: string
  reviewStatus: string
  financialStatus: string
  cargoProfile: string
  page: number
  pageSize: number
}

export type ContainerFilters = {
  search: string
  voyageId: string
  pol: string
  pod: string
  reviewStatus: string
  financialStatus: string
  cargoProfile: string
  page: number
  pageSize: number
}

export function useBls(filters: BlFilters) {
  return useQuery({
    queryKey: ['bls', filters],
    queryFn: async () => {
      if (filters.cargoProfile && filters.cargoProfile !== 'standard') {
        const allRows = await fetchAllBls(filters)
        const from = (filters.page - 1) * filters.pageSize
        const to = from + filters.pageSize
        return {
          rows: allRows.slice(from, to),
          count: allRows.length,
        }
      }

      const from = (filters.page - 1) * filters.pageSize
      const to = from + filters.pageSize - 1

      let query = supabase.from('bls').select(blSelect, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to)
      query = applyBlFilters(query, filters)

      const { data, error, count } = await query
      if (error) throw error

      return {
        rows: (data ?? []) as unknown as BLListItem[],
        count: count ?? 0,
      }
    },
  })
}

export function useContainers(filters: ContainerFilters) {
  return useQuery({
    queryKey: ['containers', filters],
    queryFn: async () => {
      const filteredRows = await fetchAllContainers(filters)
      const from = (filters.page - 1) * filters.pageSize
      const to = from + filters.pageSize
      const typeGroups = new Map<string, ContainerListItem[]>()

      for (const row of filteredRows) {
        const typeLabel = String(row.type ?? '').trim() || 'Nao informado'
        const group = typeGroups.get(typeLabel)

        if (group) {
          group.push(row)
        } else {
          typeGroups.set(typeLabel, [row])
        }
      }

      return {
        rows: filteredRows.slice(from, to),
        count: filteredRows.length,
        distinctCount: countDistinctContainerNumbers(filteredRows),
        oogDistinctCount: countDistinctContainerNumbersBy(filteredRows, (container) => Boolean(container.is_oog)),
        imoDistinctCount: countDistinctContainerNumbersBy(filteredRows, (container) => Boolean(container.is_imo)),
        blCount: new Set(filteredRows.map((container) => container.bl?.id).filter(Boolean)).size,
        typeSummary: Array.from(typeGroups.entries())
          .map(([type, rows]) => ({
            type,
            distinctCount: countDistinctContainerNumbers(rows),
          }))
          .sort((left, right) => right.distinctCount - left.distinctCount || left.type.localeCompare(right.type, 'pt-BR')),
      }
    },
  })
}

export function useBlSummary(filters: BlFilters) {
  return useQuery({
    queryKey: ['bl-summary', toSummaryFilters(filters)],
    queryFn: async () => {
      const rows = await fetchAllBls(filters)

      return {
        totalBls: rows.length,
        totalDistinctContainers: countDistinctContainersAcrossGroups(rows, (row) => row.bl_containers),
        pendingReview: rows.filter((row) => row.review_status === 'pending_review').length,
        pendingFinancial: rows.filter((row) => row.financial_status === 'pending').length,
      }
    },
  })
}

export async function fetchAllBls(filters: BlFilters) {
  const rows: BLListItem[] = []
  let from = 0

  while (true) {
    const to = from + exportBatchSize - 1
    let query = supabase.from('bls').select(blSelect).order('created_at', { ascending: false }).range(from, to)
    query = applyBlFilters(query, filters)

    const { data, error } = await query
    if (error) throw error

    const batch = (data ?? []) as unknown as BLListItem[]
    rows.push(...batch)

    if (batch.length < exportBatchSize) {
      break
    }

    from += exportBatchSize
  }

  return applyCargoProfile(rows, filters.cargoProfile)
}

export async function fetchAllContainers(filters: ContainerFilters) {
  const rows = await fetchAllBls({
    search: '',
    voyageId: filters.voyageId,
    pol: filters.pol,
    pod: filters.pod,
    reviewStatus: filters.reviewStatus,
    financialStatus: filters.financialStatus,
    cargoProfile: '',
    page: 1,
    pageSize: exportBatchSize,
  })

  const flattenedRows = rows.flatMap((bl) =>
    (bl.bl_containers ?? []).map(
      (container) =>
        ({
          ...container,
          bl,
        }) as unknown as ContainerListItem,
    ),
  )

  return applyContainerFilters(flattenedRows, filters)
}

export function useBlDetail(blId?: string) {
  return useQuery({
    queryKey: ['bl-detail', blId],
    enabled: Boolean(blId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bls')
        .select(
          `
          *,
          customer:customers(*),
          voyage:voyages(*, vessel:vessels(*, carrier:carriers(*))),
          bl_containers(*),
          vehicles(*, container:bl_containers(id, container_number, type, seal_number))
        `,
        )
        .eq('id', blId!)
        .single()

      if (error) throw error
      return data as unknown as BLDetail
    },
  })
}

export function useAuditLogs(entityType: string, entityId?: string) {
  return useQuery({
    queryKey: ['audit-logs', entityType, entityId],
    enabled: Boolean(entityId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId!)
        .order('changed_at', { ascending: false })
        .range(0, 199)

      if (error) throw error
      return (data ?? []) as AuditLog[]
    },
  })
}

export function useVoyageOptions() {
  return useQuery({
    queryKey: ['voyage-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voyages')
        .select('id, voyage_number, vessel:vessels(name)')
        .order('created_at', { ascending: false })
        .range(0, 499)

      if (error) throw error
      return (data ?? []) as unknown as { id: number; voyage_number: string; vessel?: { name: string } | null }[]
    },
  })
}

export function usePortOptions() {
  return useQuery({
    queryKey: ['port-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bls')
        .select('pol, pod')
        .order('created_at', { ascending: false })
        .range(0, 4999)

      if (error) throw error

      const pols = new Set<string>()
      const pods = new Set<string>()

      for (const row of data ?? []) {
        const pol = String(row.pol ?? '').trim()
        const pod = String(row.pod ?? '').trim()

        if (pol) pols.add(pol)
        if (pod) pods.add(pod)
      }

      return {
        pols: Array.from(pols).sort((left, right) => left.localeCompare(right, 'pt-BR')),
        pods: Array.from(pods).sort((left, right) => left.localeCompare(right, 'pt-BR')),
      }
    },
  })
}

export function useVoyages() {
  return useQuery({
    queryKey: ['voyages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voyages')
        .select(
          `
          *,
          vessel:vessels(id, name, imo, carrier:carriers(id, name, scac)),
          pol:ports!voyages_pol_id_fkey(id, name, locode, country),
          pod:ports!voyages_pod_id_fkey(id, name, locode, country),
          bls(id, pol, pod, bl_containers(id, container_number, type, is_oog, is_imo))
        `,
        )
        .order('created_at', { ascending: false })
        .range(0, 499)

      if (error) throw error

      return (data ?? []) as unknown as Array<{
        id: number
        voyage_number: string
        etd: string | null
        eta: string | null
        ata: string | null
        status: string | null
        vessel?: { id: number; name: string; imo: string | null; carrier?: { id: number; name: string; scac: string | null } | null } | null
        pol?: { id: number; name: string; locode: string | null; country: string | null } | null
        pod?: { id: number; name: string; locode: string | null; country: string | null } | null
        bls?: Array<{
          id: string
          pol: string | null
          pod: string | null
          bl_containers?: Array<{
            id: number
            container_number: string
            type?: string | null
            is_oog?: boolean | null
            is_imo?: boolean | null
          }> | null
        }> | null
      }>
    },
  })
}

function applyBlFilters(query: ReturnType<typeof supabase.from>, filters: BlFilters) {
  let nextQuery = query

  if (filters.search) {
    nextQuery = nextQuery.or(`id.ilike.%${filters.search}%,consignee.ilike.%${filters.search}%`)
  }

  if (filters.voyageId) nextQuery = nextQuery.eq('voyage_id', Number(filters.voyageId))
  if (filters.pol) nextQuery = nextQuery.ilike('pol', `%${filters.pol}%`)
  if (filters.pod) nextQuery = nextQuery.ilike('pod', `%${filters.pod}%`)
  if (filters.reviewStatus) nextQuery = nextQuery.eq('review_status', filters.reviewStatus as NonNullable<BL['review_status']>)
  if (filters.financialStatus) {
    nextQuery = nextQuery.eq('financial_status', filters.financialStatus as NonNullable<BL['financial_status']>)
  }

  return nextQuery
}

function applyCargoProfile(rows: BLListItem[], cargoProfile: string) {
  if (!cargoProfile || cargoProfile === 'standard') {
    return rows
  }

  return rows.filter((row) =>
    row.bl_containers?.some((container) => (cargoProfile === 'oog' ? container.is_oog : container.is_imo)),
  )
}

function applyContainerFilters(rows: ContainerListItem[], filters: ContainerFilters) {
  const searchTerm = normalizeText(filters.search)

  return rows.filter((row) => {
    if (filters.cargoProfile === 'oog' && !row.is_oog) return false
    if (filters.cargoProfile === 'imo' && !row.is_imo) return false

    if (!searchTerm) return true

    const values = [
      row.container_number,
      row.seal_number,
      row.type,
      row.imo_class,
      row.un_number,
      row.bl?.id,
      row.bl?.consignee,
      row.bl?.customer?.name,
      row.bl?.customer?.cnpj_cpf,
      row.bl?.voyage?.vessel?.name,
      row.bl?.voyage?.vessel?.carrier?.name,
    ]

    return values.some((value) => normalizeText(String(value ?? '')).includes(searchTerm))
  })
}

function toSummaryFilters<TFilters extends { page: number; pageSize: number }>(filters: TFilters) {
  const { page, pageSize, ...summaryFilters } = filters
  void page
  void pageSize
  return summaryFilters
}
