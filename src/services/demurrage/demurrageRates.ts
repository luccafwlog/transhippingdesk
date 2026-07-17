import { supabase } from '../supabase'
import { buildDemurrageRateUpsertPayload, type DemurrageRateUpsertInput } from './demurrageRateUpsertPayload'
import { reportBestEffortFailure } from '../../lib/telemetry'
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

const RATE_CACHE_TTL_MS = 5 * 60 * 1000
const RATES_UNAVAILABLE_MESSAGE = 'Tarifas de Demurrage indisponíveis. Verifique a tabela de tarifas antes de calcular.'
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
  // A tarifa do banco é a única fonte de verdade; não existe fallback estático
  // (CONTEXT.md, Tarifa de Demurrage).
  throw new Error(RATES_UNAVAILABLE_MESSAGE)
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

  const resolved = error ? [] : toRateGroups((data ?? []) as DemurrageRate[])
  if (error || resolved.length === 0) {
    reportBestEffortFailure(
      'ensureDemurrageRatesLoaded: tarifas de demurrage indisponiveis',
      error ?? new Error('demurrage_rates vazia'),
      { rowCount: data?.length ?? 0 },
    )
    if (!dynamicRateGroups) {
      throw new Error(RATES_UNAVAILABLE_MESSAGE)
    }
    dynamicRateGroupsLoadedAt = now
    return
  }

  dynamicRateGroups = resolved
  dynamicRateGroupsLoadedAt = now
}

export function invalidateDemurrageRatesCache() {
  dynamicRateGroupsLoadedAt = 0
}

// CRUD administrativo das tarifas. Toda escrita invalida o cache em memoria
// usado pelo calculo, para a proxima resolucao de tarifa ler o banco.
export async function listDemurrageRates(): Promise<DemurrageRate[]> {
  const { data, error } = await supabase
    .from('demurrage_rates')
    .select('*')
    .order('container_type', { ascending: true })
  if (error) throw error
  return (data ?? []) as DemurrageRate[]
}

export async function upsertDemurrageRate(rate: DemurrageRateUpsertInput) {
  const { error } = await supabase.from('demurrage_rates').upsert(buildDemurrageRateUpsertPayload(rate))
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export async function deleteDemurrageRate(id: number) {
  const { error } = await supabase.from('demurrage_rates').delete().eq('id', id)
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export async function toggleDemurrageRateActive(id: number, active: boolean) {
  const { error } = await supabase.from('demurrage_rates').update({ active }).eq('id', id)
  if (error) throw error
  invalidateDemurrageRatesCache()
}

function getRate(containerType: string | null, freeTimeOverride?: number | null, ov1?: number | null, ov2?: number | null): ResolvedRate {
  const type = (containerType ?? '').toUpperCase().trim()
  const groups = resolveActiveRateGroups()
  const group = groups.find((g) => g.aliases.includes(type))
  if (!group) {
    throw new Error(`Tipo de container "${type || '(vazio)'}" sem tarifa de Demurrage cadastrada. Cadastre a tarifa em Tarifas de Demurrage antes de calcular.`)
  }

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

export function __setDemurrageRateGroupsForTest(groups: RateGroup[] | null) {
  dynamicRateGroups = groups
  dynamicRateGroupsLoadedAt = groups ? Date.now() : 0
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
  // P2 nunca pode incluir dias dentro do free time: quando o override empurra o
  // início da cobrança (freeUntil+1) além do início da faixa P2 do grupo, a
  // contagem de P2 começa na cobrança, não no dia fixo da faixa.
  const p2Start = Math.max(rate.p2.range[0], rate.freeUntil + 1)
  const diasP2 = Math.max(0, dc - p2Start + 1)
  const totalUSD = diasP1 * rate.p1.usd + diasP2 * rate.p2.usd

  return { total_days: dc, free_days: rate.freeUntil, days_p1: diasP1, rate_p1_usd: rate.p1.usd, days_p2: diasP2, rate_p2_usd: rate.p2.usd, total_usd: totalUSD, status: 'overdue' }
}
