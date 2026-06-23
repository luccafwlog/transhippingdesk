import { supabasePortal } from './supabase'
import type { VesselSchedule } from '../types/database'

export async function listVesselSchedules(): Promise<VesselSchedule[]> {
  const { data, error } = await supabasePortal
    .from('vessel_schedules')
    .select('*')
    .order('display_order', { ascending: true })

  if (error) {
    console.error('[vesselSchedules] erro ao buscar:', error.message)
    throw error
  }

  return (data ?? []).map(normalizeVesselSchedule)
}

function normalizeVesselSchedule(raw: Record<string, unknown>): VesselSchedule {
  return {
    id: String(raw.id),
    vessel_name: String(raw.vessel_name ?? ''),
    voyage: String(raw.voyage ?? ''),
    imo_number: raw.imo_number ? String(raw.imo_number) : null,
    qingdao_etd: String(raw.qingdao_etd ?? 'X'),
    shanghai_etd: String(raw.shanghai_etd ?? 'X'),
    taicang_etd: String(raw.taicang_etd ?? 'X'),
    ningbo_etd: String(raw.ningbo_etd ?? 'X'),
    nansha_etd: String(raw.nansha_etd ?? 'X'),
    salvador_eta: String(raw.salvador_eta ?? 'X'),
    vitoria_eta: String(raw.vitoria_eta ?? 'X'),
    pecem_eta: raw.pecem_eta ? String(raw.pecem_eta) : null,
    display_order: raw.display_order != null ? Number(raw.display_order) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  }
}
