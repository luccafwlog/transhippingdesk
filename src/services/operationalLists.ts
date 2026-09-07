import type { BLListItem, ContainerListItem } from '../types/database'
import { supabase } from './supabase'

export type OperationalListFilters = {
  search?: string
  voyageId?: string | number
  cargoMode?: 'container' | 'carga_solta' | '' | null
  pol?: string
  pod?: string
  reviewStatus?: string
  financialStatus?: string
  chargeStatus?: string
  cargoProfile?: string
}

export type OperationalBlPage = {
  rows: BLListItem[]
  count: number
}

export type OperationalBlSummary = {
  totalBls: number
  totalDistinctContainers: number
  pendingReview: number
  pendingFinancial: number
  chargePending: number
  chargeReady: number
  chargeExempt: number
}

export type OperationalContainerFilters = OperationalListFilters & {
  containerType?: string
  vehicleContainer?: '' | 'true' | 'false' | null
}

export type OperationalContainerPage = {
  rows: ContainerListItem[]
  count: number
  distinctCount: number
  oogDistinctCount: number
  imoDistinctCount: number
  blCount: number
  typeSummary: Array<{ type: string; distinctCount: number }>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function baseArgs(filters: OperationalListFilters) {
  return {
    p_search: filters.search?.trim() || null,
    p_voyage_id: filters.voyageId ? Number(filters.voyageId) : null,
    p_cargo_mode: filters.cargoMode || null,
    p_pol: filters.pol?.trim() || null,
    p_pod: filters.pod?.trim() || null,
    p_review_status: filters.reviewStatus || null,
    p_financial_status: filters.financialStatus || null,
    p_charge_status: filters.chargeStatus || null,
    p_cargo_profile: filters.cargoProfile || null,
  }
}

export async function listOperationalBls(
  filters: OperationalListFilters,
  page: number,
  pageSize: number,
): Promise<OperationalBlPage> {
  const { data, error } = await supabase.rpc('operational_list_bls', {
    p_page: page,
    p_page_size: pageSize,
    ...baseArgs(filters),
  })
  if (error) throw error
  const payload = asRecord(data)
  return {
    rows: Array.isArray(payload.rows) ? payload.rows as BLListItem[] : [],
    count: asNumber(payload.count),
  }
}

export async function getOperationalBlSummary(filters: OperationalListFilters): Promise<OperationalBlSummary> {
  const { data, error } = await supabase.rpc('operational_list_bl_summary', baseArgs(filters))
  if (error) throw error
  const payload = asRecord(data)
  return {
    totalBls: asNumber(payload.totalBls),
    totalDistinctContainers: asNumber(payload.totalDistinctContainers),
    pendingReview: asNumber(payload.pendingReview),
    pendingFinancial: asNumber(payload.pendingFinancial),
    chargePending: asNumber(payload.chargePending),
    chargeReady: asNumber(payload.chargeReady),
    chargeExempt: asNumber(payload.chargeExempt),
  }
}

export async function listOperationalContainers(
  filters: OperationalContainerFilters,
  page: number,
  pageSize: number,
): Promise<OperationalContainerPage> {
  const vehicleContainer = filters.vehicleContainer === 'true'
    ? true
    : filters.vehicleContainer === 'false'
      ? false
      : null
  const { data, error } = await supabase.rpc('operational_list_containers', {
    p_page: page,
    p_page_size: pageSize,
    ...baseArgs(filters),
    p_container_type: filters.containerType?.trim() || null,
    p_vehicle_container: vehicleContainer,
  })
  if (error) throw error
  const payload = asRecord(data)
  return {
    rows: Array.isArray(payload.rows) ? payload.rows as ContainerListItem[] : [],
    count: asNumber(payload.count),
    distinctCount: asNumber(payload.distinctCount),
    oogDistinctCount: asNumber(payload.oogDistinctCount),
    imoDistinctCount: asNumber(payload.imoDistinctCount),
    blCount: asNumber(payload.blCount),
    typeSummary: Array.isArray(payload.typeSummary)
      ? payload.typeSummary.flatMap((value) => {
        const row = asRecord(value)
        return typeof row.type === 'string' ? [{ type: row.type, distinctCount: asNumber(row.distinctCount) }] : []
      })
      : [],
  }
}

