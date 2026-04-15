import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'

export type OperationalCounts = {
  pendingReview: number
  chargeReviewRequired: number
  readyForBilling: number
}

/**
 * Retorna contagens de pendências operacionais para exibição no nav.
 * staleTime de 60s — atualiza em background sem bloquear navegação.
 * Em caso de erro retorna 0 em todos os campos para não quebrar o layout.
 */
export function useOperationalCounts(): OperationalCounts {
  const pendingReview = useQuery({
    queryKey: ['op-count', 'pending-review'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .eq('review_status', 'pending_review')
      if (error) return 0
      return count ?? 0
    },
    staleTime: 60_000,
  })

  const chargeReviewRequired = useQuery({
    queryKey: ['op-count', 'charge-review-required'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .eq('charge_status', 'review_required')
      if (error) return 0
      return count ?? 0
    },
    staleTime: 60_000,
  })

  const readyForBilling = useQuery({
    queryKey: ['op-count', 'ready-for-billing'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .eq('charge_status', 'ready_for_billing')
      if (error) return 0
      return count ?? 0
    },
    staleTime: 60_000,
  })

  return {
    pendingReview: pendingReview.data ?? 0,
    chargeReviewRequired: chargeReviewRequired.data ?? 0,
    readyForBilling: readyForBilling.data ?? 0,
  }
}
