import { supabase } from './supabase'

export type LocalChargeLine = {
  id: number
  bl_id: string
  charge_table_id: number | null
  charge_item_id: number | null
  charge_name: string
  source: 'auto' | 'manual' | null
  status: 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt' | null
  quantity: number | null
  currency: string | null
  unit_value_brl: number | null
  unit_value_usd: number | null
  total_value_brl: number | null
  total_value_usd: number | null
  override_applied: boolean | null
  calculation_key: string | null
  notes: string | null
  review_reason: string | null
  calculated_at: string | null
}

export type LocalChargeCalculationResult = {
  bl_id: string
  status: 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  table_id: number | null
  line_count: number
  total_brl: number
  total_usd: number
  review_required: boolean
  exempt: boolean
  reason: string
}

export async function calculateBlLocalCharges(
  blId: string,
  options?: {
    actorId?: string | null
    recalculate?: boolean
  },
) {
  const { data, error } = await supabase.rpc('calculate_bl_local_charges', {
    p_bl_id: blId,
    p_actor: options?.actorId ?? null,
    p_recalculate: options?.recalculate ?? true,
  })

  if (error) throw error
  return normalizeCalculationResult(data)
}

export async function listBlLocalChargeLines(blId: string) {
  const { data, error } = await supabase.rpc('list_bl_local_charge_lines', {
    p_bl_id: blId,
  })

  if (error) throw error
  return (data ?? []) as LocalChargeLine[]
}

function normalizeCalculationResult(data: unknown): LocalChargeCalculationResult {
  const payload = (data ?? {}) as Record<string, unknown>
  return {
    bl_id: String(payload.bl_id ?? ''),
    status: String(payload.status ?? 'not_calculated') as LocalChargeCalculationResult['status'],
    table_id: payload.table_id === null || payload.table_id === undefined ? null : Number(payload.table_id),
    line_count: Number(payload.line_count ?? 0),
    total_brl: Number(payload.total_brl ?? 0),
    total_usd: Number(payload.total_usd ?? 0),
    review_required: Boolean(payload.review_required),
    exempt: Boolean(payload.exempt),
    reason: String(payload.reason ?? ''),
  }
}

