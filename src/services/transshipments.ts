import { supabase } from './supabase'

const normPod = (value: string) => value.trim().toUpperCase()

// ponytail: database.ts ainda nao inclui voyage_omissions/bl_transshipments/RPCs; manter casts locais ate regenerar tipos com autorizacao.
export type BlDisposition = 'transshipment' | 'cod'

export interface BlTransshipment {
  id: number
  blId: string
  omissionId: number
  disposition: BlDisposition
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
}

export interface VoyageOmission {
  id: number
  voyageId: number
  omittedPod: string
  dischargePod: string
  reason: string | null
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
}

export async function omitVoyageEscala(input: {
  voyageId: number
  omittedPod: string
  dischargePod: string
  reason: string | null
  onwardVesselName?: string | null
  onwardCarrier?: string | null
  onwardVoyageNumber?: string | null
  onwardEtd?: string | null
  onwardEta?: string | null
  changedBy: string
}): Promise<number> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: number | null; error: Error | null }>)('omit_voyage_escala', {
    p_voyage_id: input.voyageId,
    p_omitted_pod: normPod(input.omittedPod),
    p_discharge_pod: normPod(input.dischargePod),
    p_reason: input.reason,
    p_onward_vessel_name: input.onwardVesselName ?? null,
    p_onward_carrier: input.onwardCarrier ?? null,
    p_onward_voyage_number: input.onwardVoyageNumber ?? null,
    p_onward_etd: input.onwardEtd ?? null,
    p_onward_eta: input.onwardEta ?? null,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
  return data as number
}

export async function setBlTransshipment(input: {
  blId: string
  omissionId: number
  changedBy: string
}): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: Error | null }>)('set_bl_transshipment', {
    p_bl_id: input.blId,
    p_omission_id: input.omissionId,
    p_onward_vessel_name: null,
    p_onward_carrier: null,
    p_onward_voyage_number: null,
    p_onward_etd: null,
    p_onward_eta: null,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function updateVoyageOmission(input: {
  omissionId: number
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
  reason: string | null
  changedBy: string
}): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: Error | null }>)('update_voyage_omission', {
    p_omission_id: input.omissionId,
    p_onward_vessel_name: input.onwardVesselName,
    p_onward_carrier: input.onwardCarrier,
    p_onward_voyage_number: input.onwardVoyageNumber,
    p_onward_etd: input.onwardEtd,
    p_onward_eta: input.onwardEta,
    p_reason: input.reason,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function setBlCod(input: {
  blId: string
  omissionId: number
  changedBy: string
}): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: Error | null }>)('set_bl_cod', {
    p_bl_id: input.blId,
    p_omission_id: input.omissionId,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function listVoyageOmissions(voyageId: number): Promise<VoyageOmission[]> {
  const { data, error } = await (supabase.from as unknown as (table: string) => {
    select: (columns: string) => {
      eq: (key: string, value: number) => Promise<{ data: unknown[] | null; error: Error | null }>
    }
  })('voyage_omissions')
    .select('id, voyage_id, omitted_pod, discharge_pod, reason, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta')
    .eq('voyage_id', voyageId)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    voyageId: Number(row.voyage_id),
    omittedPod: String(row.omitted_pod),
    dischargePod: String(row.discharge_pod),
    reason: (row.reason as string) ?? null,
    onwardVesselName: (row.onward_vessel_name as string) ?? null,
    onwardCarrier: (row.onward_carrier as string) ?? null,
    onwardVoyageNumber: (row.onward_voyage_number as string) ?? null,
    onwardEtd: (row.onward_etd as string) ?? null,
    onwardEta: (row.onward_eta as string) ?? null,
  }))
}

export async function listBlTransshipments(omissionId: number): Promise<BlTransshipment[]> {
  const { data, error } = await (supabase.from as unknown as (table: string) => {
    select: (columns: string) => {
      eq: (key: string, value: number) => Promise<{ data: unknown[] | null; error: Error | null }>
    }
  })('bl_transshipments')
    .select('id, bl_id, omission_id, disposition, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta')
    .eq('omission_id', omissionId)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapBlTransshipment)
}

export async function listBlTransshipmentByBlId(blId: string): Promise<BlTransshipment | null> {
  const { data, error } = await (supabase.from as unknown as (table: string) => {
    select: (columns: string) => {
      eq: (key: string, value: string) => Promise<{ data: unknown[] | null; error: Error | null }>
    }
  })('bl_transshipments')
    .select('id, bl_id, omission_id, disposition, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta')
    .eq('bl_id', blId)
  if (error) throw error
  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  return row ? mapBlTransshipment(row) : null
}

function mapBlTransshipment(row: Record<string, unknown>): BlTransshipment {
  return {
    id: Number(row.id),
    blId: String(row.bl_id),
    omissionId: Number(row.omission_id),
    disposition: row.disposition as BlDisposition,
    onwardVesselName: (row.onward_vessel_name as string) ?? null,
    onwardCarrier: (row.onward_carrier as string) ?? null,
    onwardVoyageNumber: (row.onward_voyage_number as string) ?? null,
    onwardEtd: (row.onward_etd as string) ?? null,
    onwardEta: (row.onward_eta as string) ?? null,
  }
}
