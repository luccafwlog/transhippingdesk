import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { BL, BLContainer, Customer, Voyage, Vessel, Carrier } from '../types/database'

export type ReviewQueueItem = BL & {
  customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
  voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
    vessel?: (Pick<Vessel, 'id' | 'name'> & {
      carrier?: Pick<Carrier, 'id' | 'name'> | null
    }) | null
  }) | null
  bl_containers?: Pick<BLContainer, 'id' | 'container_number' | 'is_imo' | 'is_oog'>[] | null
  review_reasons?: string[]
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bls')
        .select(
          `
          *,
          customer:customers(id, cnpj_cpf, name),
          voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
          bl_containers(id, container_number, is_imo, is_oog)
        `,
        )
        .eq('review_status', 'pending_review')
        .order('created_at', { ascending: false })
        .range(0, 499)

      if (error) throw error

      return ((data ?? []) as unknown as ReviewQueueItem[]).map((row) => ({
        ...row,
        review_reasons: extractReviewReasons(row.notes),
      }))
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
