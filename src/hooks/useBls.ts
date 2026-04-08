import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { AuditLog, BL, BLDetail, BLListItem } from '../types/database'

export type BlFilters = {
  search: string
  voyageId: string
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
      const from = (filters.page - 1) * filters.pageSize
      const to = from + filters.pageSize - 1

      let query = supabase
        .from('bls')
        .select(
          `
          *,
          customer:customers(id, cnpj_cpf, name),
          voyage:voyages(id, voyage_number, eta, ata, status, vessel:vessels(id, name, carrier:carriers(id, name, scac))),
          bl_containers(id, container_number, is_oog, is_imo)
        `,
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(from, to)

      if (filters.search) {
        query = query.or(`id.ilike.%${filters.search}%,consignee.ilike.%${filters.search}%`)
      }

      if (filters.voyageId) query = query.eq('voyage_id', Number(filters.voyageId))
      if (filters.pod) query = query.ilike('pod', `%${filters.pod}%`)
      if (filters.reviewStatus) query = query.eq('review_status', filters.reviewStatus as NonNullable<BL['review_status']>)
      if (filters.financialStatus) {
        query = query.eq('financial_status', filters.financialStatus as NonNullable<BL['financial_status']>)
      }

      const { data, error, count } = await query
      if (error) throw error

      const rows = (data ?? []) as unknown as BLListItem[]

      return {
        rows:
          filters.cargoProfile && filters.cargoProfile !== 'standard'
            ? rows.filter((row) =>
                row.bl_containers?.some((container) =>
                  filters.cargoProfile === 'oog' ? container.is_oog : container.is_imo,
                ),
              )
            : rows,
        count: count ?? 0,
      }
    },
  })
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
          bl_containers(*)
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
          bls(id, pol, pod, bl_containers(id))
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
        bls?: Array<{ id: string; pol: string | null; pod: string | null; bl_containers?: Array<{ id: number }> | null }> | null
      }>
    },
  })
}
