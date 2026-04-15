import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addManualBlCharge,
  calculateLocalChargesBatch,
  calculateBlLocalCharges,
  listLocalChargeOperationalRows,
  deleteChargeTableItem,
  deleteManualBlCharge,
  markLocalChargesReadyBatch,
  markLocalChargesReviewedBatch,
  listManualChargeItemsForBl,
  markBlChargesReviewed,
  markBlReadyForBilling,
  saveChargeTable,
  saveChargeTableItem,
  setChargeTableActive,
  deleteCustomerRateOverride,
  listBlLocalChargeLines,
  listCustomerRateOverrides,
  listOverrideChargeItems,
  listOverrideCustomers,
  listLocalChargePendencies,
  listLocalChargeTables,
  saveCustomerRateOverride,
  updateManualBlCharge,
} from '../services/localCharges'

export function useBlLocalChargeLines(blId?: string) {
  return useQuery({
    queryKey: ['bl-local-charge-lines', blId],
    enabled: Boolean(blId),
    queryFn: () => listBlLocalChargeLines(blId!),
  })
}

export function useManualChargeItemsForBl(blId?: string) {
  return useQuery({
    queryKey: ['manual-charge-items', blId],
    enabled: Boolean(blId),
    queryFn: () => listManualChargeItemsForBl(blId!),
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

export function useAddManualBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeItemId: number; quantity: number; notes?: string | null; actorId?: string | null }) =>
      addManualBlCharge(blId!, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}

export function useUpdateManualBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeCalculationId: number; quantity: number; notes?: string | null; actorId?: string | null }) =>
      updateManualBlCharge(payload.chargeCalculationId, {
        quantity: payload.quantity,
        notes: payload.notes,
        actorId: payload.actorId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
      ])
    },
  })
}

export function useDeleteManualBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeCalculationId: number; actorId?: string | null }) =>
      deleteManualBlCharge(payload.chargeCalculationId, payload.actorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
      ])
    },
  })
}

export function useMarkBlChargesReviewed(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload?: { actorId?: string | null }) => markBlChargesReviewed(blId!, payload?.actorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}

export function useMarkBlReadyForBilling(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload?: { actorId?: string | null }) => markBlReadyForBilling(blId!, payload?.actorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
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

export function useSaveChargeTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveChargeTable,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['local-charge-tables'] })
    },
  })
}

export function useSetChargeTableActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setChargeTableActive(id, active),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['local-charge-tables'] })
    },
  })
}

export function useSaveChargeTableItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveChargeTableItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['local-charge-tables'] })
      await queryClient.invalidateQueries({ queryKey: ['manual-charge-items'] })
      await queryClient.invalidateQueries({ queryKey: ['local-charge-override-items'] })
    },
  })
}

export function useDeleteChargeTableItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteChargeTableItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['local-charge-tables'] })
      await queryClient.invalidateQueries({ queryKey: ['manual-charge-items'] })
      await queryClient.invalidateQueries({ queryKey: ['local-charge-override-items'] })
    },
  })
}

export function useChargePendencies(limit = 100) {
  return useQuery({
    queryKey: ['local-charge-pendencies', limit],
    queryFn: () => listLocalChargePendencies(limit),
  })
}

export function useLocalChargeOperations(filters?: {
  search?: string
  cargoMode?: '' | 'container' | 'carga_solta'
  pod?: string
  voyageId?: number | null
  chargeStatus?: '' | 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  limit?: number
}) {
  return useQuery({
    queryKey: ['local-charge-operations', filters],
    queryFn: () => listLocalChargeOperationalRows(filters),
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

export function useBatchCalculateLocalCharges() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: { blIds: string[]; actorId?: string | null; recalculate?: boolean }) =>
      calculateLocalChargesBatch(payload.blIds, {
        actorId: payload.actorId ?? null,
        recalculate: payload.recalculate ?? true,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['local-charge-operations'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}

export function useBatchMarkLocalChargesReviewed() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: { blIds: string[]; actorId?: string | null }) =>
      markLocalChargesReviewedBatch(payload.blIds, payload.actorId ?? null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['local-charge-operations'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
      ])
    },
  })
}

export function useBatchMarkLocalChargesReady() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: { blIds: string[]; actorId?: string | null }) =>
      markLocalChargesReadyBatch(payload.blIds, payload.actorId ?? null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['local-charge-operations'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}
