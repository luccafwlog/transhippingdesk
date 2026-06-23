import { supabase } from '../supabase'
import type { DemurrageCalcResult, DemurrageRate } from '../../types/database'

export type RateGroup = {
  aliases: string[]
  freeUntil: number
  p1: { range: [number, number]; usd: number }
  p2: { range: [number, number]; usd: number }
}

type ResolvedRate = {
  freeUntil: number
  p1: { range: [number, number]; usd: number }
  p2: { range: [number, number]; usd: number }
}

const STATIC_RATE_GROUPS: RateGroup[] = [
  { aliases: ['20GP', '20G0', '20HC', '20HQ', '22G1', '20G1'], freeUntil: 21, p1: { range: [22, 30], usd: 30 }, p2: { range: [31, Infinity], usd: 50 } },
  { aliases: ['40GP', '40G0', '40HC', '40HQ', '40G1', '42G1', '45G1'], freeUntil: 21, p1: { range: [22, 30], usd: 60 }, p2: { range: [31, Infinity], usd: 80 } },
  { aliases: ['20FR', '20OT', '20FT'], freeUntil: 21, p1: { range: [22, 30], usd: 50 }, p2: { range: [31, Infinity], usd: 80 } },
  { aliases: ['40FR', '40OT', '40FT'], freeUntil: 21, p1: { range: [22, 30], usd: 100 }, p2: { range: [31, Infinity], usd: 140 } },
  { aliases: ['20RF', '20RQ', '20R1'], freeUntil: 10, p1: { range: [11, 19], usd: 95 }, p2: { range: [20, Infinity], usd: 110 } },
  { aliases: ['40RF', '40RQ', '40R1', '45R1'], freeUntil: 10, p1: { range: [11, 19], usd: 190 }, p2: { range: [20, Infinity], usd: 220 } },
]

const DEFAULT_RATE: RateGroup = STATIC_RATE_GROUPS[0]
const RATE_CACHE_TTL_MS = 5 * 60 * 1000
let dynamicRateGroups: RateGroup[] | null = null
let dynamicRateGroupsLoadedAt = 0

function resolveActiveRateGroups(): RateGroup[] {
  if (dynamicRateGroups && dynamicRateGroups.length > 0) {
    if (Date.now() - dynamicRateGroupsLoadedAt < RATE_CACHE_TTL_MS) {
      return dynamicRateGroups
    }
    // Cache stale — serve current data, trigger background refresh
    void ensureDemurrageRatesLoaded(true)
    return dynamicRateGroups
  }
  return STATIC_RATE_GROUPS
}

function toRateGroups(rows: DemurrageRate[]): RateGroup[] {
  const grouped = new Map<string, DemurrageRate>()
  for (const row of rows) {
    const key = String(row.container_type ?? '').trim().toUpperCase()
    if (!key || grouped.has(key)) continue
    grouped.set(key, row)
  }

  const groups: RateGroup[] = []
  for (const row of grouped.values()) {
    groups.push({
      aliases: [String(row.container_type).trim().toUpperCase()],
      freeUntil: Number(row.free_days ?? 0),
      p1: {
        range: [Number(row.p1_day_from ?? 0), Number(row.p1_day_to ?? 0)],
        usd: Number(row.p1_usd ?? 0),
      },
      p2: {
        range: [Number(row.p2_day_from ?? 0), Infinity],
        usd: Number(row.p2_usd ?? 0),
      },
    })
  }
  return groups
}

export async function ensureDemurrageRatesLoaded(force = false) {
  const now = Date.now()
  if (!force && dynamicRateGroups && now - dynamicRateGroupsLoadedAt < RATE_CACHE_TTL_MS) {
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('demurrage_rates')
    .select('*')
    .eq('active', true)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order('valid_from', { ascending: false })
    .order('id', { ascending: false })

  if (error) {
    if (!dynamicRateGroups) {
      dynamicRateGroups = STATIC_RATE_GROUPS
    }
    dynamicRateGroupsLoadedAt = now
    return
  }

  const resolved = toRateGroups((data ?? []) as DemurrageRate[])
  dynamicRateGroups = resolved.length > 0 ? resolved : STATIC_RATE_GROUPS
  dynamicRateGroupsLoadedAt = now
}

export function invalidateDemurrageRatesCache() {
  dynamicRateGroupsLoadedAt = 0
}

function getRate(containerType: string | null, freeTimeOverride?: number | null, ov1?: number | null, ov2?: number | null): ResolvedRate {
  const type = (containerType ?? '').toUpperCase().trim()
  const groups = resolveActiveRateGroups()
  const group = groups.find((g) => g.aliases.includes(type)) ?? groups[0] ?? DEFAULT_RATE

  const freeUntil = freeTimeOverride != null ? freeTimeOverride : group.freeUntil
  const p1Start = freeUntil + 1
  const p1End = group.p1.range[1]
  const p1Range: [number, number] = [p1Start, p1End]
  const p2Range: [number, number] = [group.p2.range[0], Infinity]

  return {
    freeUntil,
    p1: { range: p1Range, usd: ov1 != null ? ov1 : group.p1.usd },
    p2: { range: p2Range, usd: ov2 != null ? ov2 : group.p2.usd },
  }
}

function noonMs(dateStr: string): number {
  if (!dateStr) throw new Error(`Data inválida em cálculo de demurrage: string vazia`)
  const ms = new Date(`${dateStr}T12:00:00`).getTime()
  if (!Number.isFinite(ms)) throw new Error(`Data inválida em cálculo de demurrage: "${dateStr}"`)
  return ms
}

export function calculateDemurrage(
  containerType: string | null,
  dischargeDate: string,
  returnDate: string,
  freeTimeOverride?: number | null,
  ov1?: number | null,
  ov2?: number | null,
): DemurrageCalcResult {
  const rate = getRate(containerType, freeTimeOverride, ov1, ov2)
  const dischargeMs = noonMs(dischargeDate)
  const returnMs = noonMs(returnDate)
  if (returnMs < dischargeMs) {
    throw new Error('Data de devolucao nao pode ser anterior a descarga.')
  }
  const dc = Math.round((returnMs - dischargeMs) / 86400000)

  if (dc <= rate.freeUntil) {
    return { total_days: dc, free_days: dc, days_p1: 0, rate_p1_usd: rate.p1.usd, days_p2: 0, rate_p2_usd: rate.p2.usd, total_usd: 0, status: 'within_free_time' }
  }

  const diasP1 = Math.max(0, Math.min(dc, rate.p1.range[1]) - rate.p1.range[0] + 1)
  const diasP2 = Math.max(0, dc - rate.p2.range[0] + 1)
  const totalUSD = diasP1 * rate.p1.usd + diasP2 * rate.p2.usd

  return { total_days: dc, free_days: rate.freeUntil, days_p1: diasP1, rate_p1_usd: rate.p1.usd, days_p2: diasP2, rate_p2_usd: rate.p2.usd, total_usd: totalUSD, status: 'overdue' }
}
