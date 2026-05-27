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
  bl_containers(id, bl_id, container_number, seal_number, type, tare_weight_kg, gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number, created_at),
  bl_breakbulk_items(id, bl_id, item_description, package_qty, package_unit, gross_weight_kg, cbm, marks, created_at)
`

const exportBatchSize = 1000

export type BlFilters = {
  search: string
  voyageId: string
  cargoMode?: 'container' | 'carga_solta' | ''
  pol: string
  pod: string
  reviewStatus: string
  financialStatus: string
  chargeStatus: string
  cargoProfile: string
  page: number
  pageSize: number
}

export type ContainerFilters = {
  search: string
  voyageId: string
  cargoMode?: 'container' | 'carga_solta' | ''
  pol: string
  pod: string
  reviewStatus: string
  financialStatus: string
  chargeStatus: string
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
        chargePending: rows.filter((row) => row.charge_status === 'review_required' || row.charge_status === 'not_calculated').length,
        chargeReady: rows.filter((row) => row.charge_status === 'ready_for_billing').length,
        chargeExempt: rows.filter((row) => row.charge_status === 'exempt').length,
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
    cargoMode: filters.cargoMode ?? 'container',
    pol: filters.pol,
    pod: filters.pod,
    reviewStatus: filters.reviewStatus,
    financialStatus: filters.financialStatus,
    chargeStatus: filters.chargeStatus,
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
          bl_breakbulk_items(*),
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
    // Port codes are stable — refresh only once every 10 minutes
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      // Use a lightweight RPC instead of loading 5000 rows
      const { data, error } = await supabase
        .from('bls')
        .select('pol, pod')
        .limit(500)

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
          import_batches(
            id,
            voyage_id,
            cargo_mode,
            filename,
            uploaded_at,
            status,
            total_bls
          ),
          granite_manifests(
            id,
            voyage_id,
            loading_port,
            discharge_port,
            total_bls,
            total_weight_kg,
            granite_bls(id, charge_status)
          ),
          vazios_manifests(
            id,
            voyage_id,
            description,
            total_bookings,
            vazios_bookings(id, container_number, container_type, origin_terminal, destination)
          ),
          bls(
            *,
            bl_containers(id, container_number, type, is_oog, is_imo),
            bl_breakbulk_items(id, gross_weight_kg, cbm)
          )
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
          import_batches?: Array<{
            id: number
            voyage_id: number | null
            cargo_mode: 'container' | 'carga_solta' | null
            filename: string
            uploaded_at: string | null
            status: 'processing' | 'completed' | 'partial' | 'failed' | null
            total_bls: number | null
          }> | null
          granite_manifests?: Array<{
            id: string
            voyage_id: number | null
            loading_port: string | null
            discharge_port: string | null
            total_bls: number | null
            total_weight_kg: number | null
            granite_bls?: Array<{
              id: string
              charge_status: 'not_calculated' | 'calculated' | 'ready_for_billing' | 'invoiced' | null
            }> | null
          }> | null
          vazios_manifests?: Array<{
            id: string
            voyage_id: number | null
            description: string | null
            total_bookings: number | null
            vazios_bookings?: Array<{
              id: string
              container_number: string | null
              container_type: string | null
              origin_terminal: string | null
              destination: string | null
            }> | null
          }> | null
          bls?: Array<{
            id: string
            batch_id: number | null
            cargo_mode: 'container' | 'carga_solta' | null
            ce_mercante: string | null
            bb_machine_qty: number | null
          bb_packages_qty: number | null
          bb_packages_total: number | null
          bb_weight_ton: number | null
          shipper: string | null
          consignee: string | null
          notify_party: string | null
          pol: string | null
          pod: string | null
          total_weight_kg: number | null
          total_cbm: number | null
          bl_containers?: Array<{
            id: number
            container_number: string
            type?: string | null
            is_oog?: boolean | null
            is_imo?: boolean | null
          }> | null
          bl_breakbulk_items?: Array<{
            id: number
            gross_weight_kg?: number | null
            cbm?: number | null
          }> | null
        }> | null
      }>
    },
  })
}

// Remove caracteres que podem alterar o parser de filtros do PostgREST
// (vírgula, parênteses, ponto, dois-pontos, aspas) ou os curingas do LIKE
// (% e _). Isso evita injeção via .or()/.ilike() com input do usuário.
function escapeFilterTerm(value: string) {
  return value.replace(/[%_,.():*"\\]/g, ' ').trim()
}

function applyBlFilters(query: ReturnType<typeof supabase.from>, filters: BlFilters) {
  let nextQuery = query

  if (filters.search) {
    const term = escapeFilterTerm(filters.search)
    if (term) {
      nextQuery = nextQuery.or(`id.ilike.%${term}%,consignee.ilike.%${term}%`)
    }
  }

  if (filters.voyageId) nextQuery = nextQuery.eq('voyage_id', Number(filters.voyageId))
  if (filters.cargoMode) nextQuery = nextQuery.eq('cargo_mode', filters.cargoMode)
  if (filters.pol) {
    const pol = escapeFilterTerm(filters.pol)
    if (pol) nextQuery = nextQuery.ilike('pol', `%${pol}%`)
  }
  if (filters.pod) {
    const pod = escapeFilterTerm(filters.pod)
    if (pod) nextQuery = nextQuery.ilike('pod', `%${pod}%`)
  }
  if (filters.reviewStatus) nextQuery = nextQuery.eq('review_status', filters.reviewStatus as NonNullable<BL['review_status']>)
  if (filters.financialStatus) {
    nextQuery = nextQuery.eq('financial_status', filters.financialStatus as NonNullable<BL['financial_status']>)
  }
  if (filters.chargeStatus) {
    nextQuery = nextQuery.eq('charge_status', filters.chargeStatus as NonNullable<BL['charge_status']>)
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
