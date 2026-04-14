import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculateBlLocalCharges,
  deleteCustomerRateOverride,
  listBlLocalChargeLines,
  listCustomerRateOverrides,
  listOverrideChargeItems,
  listOverrideCustomers,
  listLocalChargePendencies,
  listLocalChargeTables,
  saveCustomerRateOverride,
} from '../services/localCharges'

export function useBlLocalChargeLines(blId?: string) {
  return useQuery({
    queryKey: ['bl-local-charge-lines', blId],
    enabled: Boolean(blId),
    queryFn: () => listBlLocalChargeLines(blId!),
  })
}

export function useCalculateBlLocalCharges(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (options?: { actorId?: string | null; recalculate?: boolean }) =>
      calculateBlLocalCharges(blId!, { actorId: options?.actorId ?? null, recalculate: options?.recalculate ?? true }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}

export function useLocalChargeTables(filters?: { cargoMode?: '' | 'container' | 'carga_solta'; pod?: string }) {
  return useQuery({
    queryKey: ['local-charge-tables', filters],
    queryFn: () => listLocalChargeTables(filters),
  })
}

export function useChargePendencies(limit = 100) {
  return useQuery({
    queryKey: ['local-charge-pendencies', limit],
    queryFn: () => listLocalChargePendencies(limit),
  })
}

export function useCustomerRateOverrides(filters?: {
  customerSearch?: string
  cargoMode?: '' | 'container' | 'carga_solta'
  pod?: string
  limit?: number
}) {
  return useQuery({
    queryKey: ['local-charge-overrides', filters],
    queryFn: () => listCustomerRateOverrides(filters),
  })
}

export function useOverrideChargeItems() {
  return useQuery({
    queryKey: ['local-charge-override-items'],
    queryFn: () => listOverrideChargeItems(),
  })
}

export function useOverrideCustomers(search: string) {
  return useQuery({
    queryKey: ['local-charge-override-customers', search],
    queryFn: () => listOverrideCustomers(search),
  })
}

export function useSaveCustomerRateOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveCustomerRateOverride,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['local-charge-overrides'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines'] }),
      ])
    },
  })
}

export function useDeleteCustomerRateOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteCustomerRateOverride,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['local-charge-overrides'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines'] }),
      ])
    },
  })
}
