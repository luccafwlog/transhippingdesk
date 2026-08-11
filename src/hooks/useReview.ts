import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { BL, BLContainer, Customer, Voyage, Vessel, Carrier } from '../types/database'

// Cliente da fila + contatos visiveis ao operador. O estado do portal nao e
// lido por join porque customer_portal_accounts tem RLS administrativa; as
// pendencias canonicas ja chegam na linha gerenciada de `notes`.
export type ReviewCustomer = Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> & {
  customer_contacts?: { email: string | null }[] | null
}

export type ReviewQueueItem = (BL & {
  customer?: ReviewCustomer | null
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
  manifest_customer_cnpj_cpf?: string | null
  customer?: ReviewCustomer | null
  voyage?: { vessel?: { name?: string | null } | null; voyage_number?: string | null } | null
  charge_status?: string | null
  review_reasons?: string[]
  source: 'granite'
}

export function useReviewQueue() {
  const query = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const [blResult, graniteResult] = await Promise.all([
        supabase
          .from('bls')
          .select(
            `*,
            customer:customers!bls_customer_id_fkey(id, cnpj_cpf, name, customer_contacts(email)),
            voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
            bl_containers(id, container_number, is_imo, is_oog)`,
          )
          .eq('review_status', 'pending_review')
          .order('created_at', { ascending: false })
          .range(0, 499),

        supabase
          .from('granite_bls')
          .select(
            `id, bl_number, shipper_name, shipper_cnpj, discharge_port, loading_port, vessel_voyage, created_at, client_id, charge_status,
            customer:customers!granite_bls_client_id_fkey(id, cnpj_cpf, name, customer_contacts(email)),
            suggested_customer:customers!granite_bls_suggested_client_id_fkey(id, cnpj_cpf, name),
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
      let graniteUnavailable = false
      if (graniteResult.error) {
        // Fallback defensivo: se o join de relacoes falhar por schema/permissao,
        // ainda retornamos a fila de granito sem metadados de viagem.
        const fallback = await supabase
          .from('granite_bls')
          .select('id, bl_number, shipper_name, shipper_cnpj, discharge_port, loading_port, vessel_voyage, created_at, client_id, suggested_client_id, charge_status, customer:customers!granite_bls_client_id_fkey(id, cnpj_cpf, name, customer_contacts(email)), suggested_customer:customers!granite_bls_suggested_client_id_fkey(id, cnpj_cpf, name)')
          .is('client_id', null)
          .order('created_at', { ascending: false })
          .range(0, 499)
        if (fallback.error) {
          console.error('[review-queue] granite query failed (primary + fallback)', {
            primary: graniteResult.error,
            fallback: fallback.error,
          })
          graniteData = []
          graniteUnavailable = true
        } else {
          // O fallback nao traz `manifest`; o mapeamento abaixo trata o campo como opcional.
          graniteData = fallback.data as unknown as typeof graniteData
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
        created_at: string | null
        client_id: number | null
        charge_status: string | null
        customer: ReviewCustomer | null
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
        updated_at: row.created_at,
        customer_id: row.client_id,
        manifest_customer_cnpj_cpf: row.shipper_cnpj,
        charge_status: row.charge_status,
        customer: row.customer,
        voyage: row.manifest?.voyage
          ? { vessel: row.manifest.voyage.vessel, voyage_number: row.manifest.voyage.voyage_number }
          : null,
        review_reasons: ['Cliente nao vinculado (Granito)'],
        source: 'granite' as const,
      }))

      return { items: [...blItems, ...graniteItems] as ReviewQueueItem[], graniteUnavailable }
    },
  })

  // Mantém o contrato histórico (data = lista) e expõe a falha parcial de
  // granito separadamente para a página renderizar um aviso visível —
  // nunca uma fila incompleta em silêncio.
  return { ...query, data: query.data?.items, graniteUnavailable: query.data?.graniteUnavailable ?? false }
}

export function extractReviewReasons(notes?: string | null) {
  if (!notes) return []
  const match = notes.match(/(?:^|\n)Pendencias de importacao:\s*([^\n]*)/i)
  if (!match?.[1]) return []

  return match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
