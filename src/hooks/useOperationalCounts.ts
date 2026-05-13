import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../services/supabase'

export type OperationalCounts = {
  pendingReview: number
  chargeReviewRequired: number
  readyForBilling: number
  openAlerts: number
  blsWithoutCustomer: number
}

/**
 * Retorna contagens de pendências operacionais para exibição no nav.
 * staleTime de 60s — atualiza em background sem bloquear navegação.
 * Em caso de erro retorna 0 em todos os campos para não quebrar o layout.
 */
export function useOperationalCounts(): OperationalCounts {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('op-counts-alerts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['op-count', 'open-alerts'] })
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [queryClient])

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

  const openAlerts = useQuery({
    queryKey: ['op-count', 'open-alerts'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('alerts')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'closed')
      if (error) return 0
      return count ?? 0
    },
    staleTime: 60_000,
  })

  const blsWithoutCustomer = useQuery({
    queryKey: ['op-count', 'bls-without-customer'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .is('customer_id', null)
      if (error) return 0
      return count ?? 0
    },
    staleTime: 60_000,
  })

  return {
    pendingReview: pendingReview.data ?? 0,
    chargeReviewRequired: chargeReviewRequired.data ?? 0,
    readyForBilling: readyForBilling.data ?? 0,
    openAlerts: openAlerts.data ?? 0,
    blsWithoutCustomer: blsWithoutCustomer.data ?? 0,
  }
}
