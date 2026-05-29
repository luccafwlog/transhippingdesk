import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { BL, BLContainer, Customer, Voyage, Vessel, Carrier } from '../types/database'

export type ReviewQueueItem = (BL & {
  customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
  voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
    vessel?: (Pick<Vessel, 'id' | 'name'> & {
      carrier?: Pick<Carrier, 'id' | 'name'> | null
    }) | null
  }) | null
  bl_containers?: Pick<BLContainer, 'id' | 'container_number' | 'is_imo' | 'is_oog'>[] | null
  review_reasons?: string[]
  source: 'bl'
}) | {
  id: string
  bl_number: string
  shipper?: string | null
  consignee?: string | null
  pol?: string | null
  pod?: string | null
  total_weight_kg?: number | null
  total_cbm?: number | null
  notes?: string | null
  updated_at?: string | null
  customer_id?: number | null
  customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
  voyage?: { vessel?: { name?: string | null } | null; voyage_number?: string | null } | null
  charge_status?: string | null
  review_reasons?: string[]
  source: 'granite'
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const [blResult, graniteResult] = await Promise.all([
        supabase
          .from('bls')
          .select(
            `*,
            customer:customers(id, cnpj_cpf, name),
            voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
            bl_containers(id, container_number, is_imo, is_oog)`,
          )
          .eq('review_status', 'pending_review')
          .order('created_at', { ascending: false })
          .range(0, 499),

        supabase
          .from('granite_bls')
          .select(
            `id, bl_number, shipper_name, shipper_cnpj, discharge_port, loading_port, vessel_voyage, updated_at, client_id, charge_status,
            customer:customers(id, cnpj_cpf, name),
            manifest:granite_manifests(voyage:voyages(id, voyage_number, vessel:vessels(id, name)))`,
          )
          .is('client_id', null)
          .order('created_at', { ascending: false })
          .range(0, 499),
      ])

      if (blResult.error) throw blResult.error

      const blItems = ((blResult.data ?? []) as unknown as (Omit<ReviewQueueItem & { source: 'bl' }, 'source'>)[]).map((row) => ({
        ...row,
        review_reasons: extractReviewReasons((row as { notes?: string | null }).notes),
        source: 'bl' as const,
      }))

      let graniteData = graniteResult.data
      if (graniteResult.error) {
        // Fallback defensivo: se o join de relacoes falhar por schema/permissao,
        // ainda retornamos a fila de granito sem metadados de viagem.
        const fallback = await supabase
          .from('granite_bls')
          .select('id, bl_number, shipper_name, shipper_cnpj, discharge_port, loading_port, vessel_voyage, updated_at, client_id, charge_status, customer:customers(id, cnpj_cpf, name)')
          .is('client_id', null)
          .order('created_at', { ascending: false })
          .range(0, 499)
        if (fallback.error) {
          console.error('[review-queue] granite query failed (primary + fallback)', {
            primary: graniteResult.error,
            fallback: fallback.error,
          })
          graniteData = []
        } else {
          graniteData = fallback.data
        }
      }

      const graniteRows = (graniteData ?? []) as unknown as Array<{
        id: string
        bl_number: string
        shipper_name: string | null
        shipper_cnpj: string | null
        discharge_port: string | null
        loading_port: string | null
        vessel_voyage: string | null
        updated_at: string | null
        client_id: number | null
        charge_status: string | null
        customer: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
        manifest?: { voyage: { id: number; voyage_number: string; vessel: { id: number; name: string } | null } | null } | null
      }>

      const graniteItems = graniteRows.map((row) => ({
        id: row.id,
        bl_number: row.bl_number,
        shipper: row.shipper_name,
        consignee: null,
        pol: row.loading_port,
        pod: row.discharge_port,
        total_weight_kg: null,
        total_cbm: null,
        notes: null,
        updated_at: row.updated_at,
        customer_id: row.client_id,
        charge_status: row.charge_status,
        customer: row.customer,
        voyage: row.manifest?.voyage
          ? { vessel: row.manifest.voyage.vessel, voyage_number: row.manifest.voyage.voyage_number }
          : null,
        review_reasons: ['Cliente nao vinculado (Granito)'],
        source: 'granite' as const,
      }))

      return [...blItems, ...graniteItems] as ReviewQueueItem[]
    },
  })
}

function extractReviewReasons(notes?: string | null) {
  if (!notes) return []
  const marker = 'Pend'
  if (!notes.startsWith(marker)) return [notes]

  const parts = notes.split(':')
  if (parts.length < 2) return [notes]

  return parts
    .slice(1)
    .join(':')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
