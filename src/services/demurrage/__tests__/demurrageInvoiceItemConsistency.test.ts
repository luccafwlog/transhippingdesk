import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { __setDemurrageRateGroupsForTest, calculateDemurrage } from '../demurrageRates'

// Invariantes da migration 204: todo resultado de calculateDemurrage deve
// satisfaze-los por construcao — se este teste quebrar, a RPC passara a
// rejeitar emissoes legitimas do frontend.
function satisfiesSqlInvariants(r: ReturnType<typeof calculateDemurrage>, dischargeDate: string, returnDate: string) {
  const dayDiff = Math.round(
    (new Date(`${returnDate}T12:00:00`).getTime() - new Date(`${dischargeDate}T12:00:00`).getTime()) / 86400000,
  )
  return (
    r.total_days === dayDiff &&
    r.free_days >= 0 &&
    r.days_p1 >= 0 &&
    r.days_p2 >= 0 &&
    r.rate_p1_usd >= 0 &&
    r.rate_p2_usd >= 0 &&
    r.days_p1 + r.days_p2 <= Math.max(r.total_days - r.free_days, 0) &&
    Math.abs(r.total_usd - (r.days_p1 * r.rate_p1_usd + r.days_p2 * r.rate_p2_usd)) <= 0.01
  )
}

afterEach(() => __setDemurrageRateGroupsForTest(null))

describe('paridade calculateDemurrage x invariantes da RPC (migration 204)', () => {
  it('cobre faixas normais, free time, override e faixa com gap', () => {
    __setDemurrageRateGroupsForTest([
      { aliases: ['20GP'], freeUntil: 21, p1: { range: [22, 30], usd: 100 }, p2: { range: [31, Infinity], usd: 150 } },
      // Gap deliberado entre P1 (ate 30) e P2 (a partir de 35): dias 31-34 nao cobrados.
      { aliases: ['40HC'], freeUntil: 10, p1: { range: [11, 30], usd: 80 }, p2: { range: [35, Infinity], usd: 120 } },
    ])

    const cases: Array<[string, string, string, number | null, number | null, number | null]> = [
      ['20GP', '2026-01-01', '2026-01-10', null, null, null], // dentro do free time
      ['20GP', '2026-01-01', '2026-02-15', null, null, null], // P1 + P2
      ['20GP', '2026-01-01', '2026-01-25', null, null, null], // so P1
      ['20GP', '2026-01-01', '2026-03-01', 35, null, null], // override empurra alem de P2
      ['20GP', '2026-01-01', '2026-02-15', 5, 90, 200], // override curto + taxas override
      ['40HC', '2026-01-01', '2026-03-10', null, null, null], // faixa com gap
      ['20GP', '2026-01-01', '2026-01-01', null, null, null], // devolucao no mesmo dia
    ]

    for (const [type, discharge, ret, ft, ov1, ov2] of cases) {
      const result = calculateDemurrage(type, discharge, ret, ft, ov1, ov2)
      expect(satisfiesSqlInvariants(result, discharge, ret), `${type} ${discharge}->${ret} ft=${ft}`).toBe(true)
    }
  })
})

describe('migration 204 — contrato', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/204_demurrage_invoice_item_consistency.sql'),
    'utf8',
  )

  it('redefine a RPC com validacao por item e clausulas de seguranca preservadas', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_demurrage_invoice_with_items\b/)
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = public, pg_temp/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC, anon/)
  })

  it('valida aritmetica do subtotal, total_days derivado das datas e faixas nao-negativas', () => {
    expect(sql).toMatch(/item\.total_days, -1\) <> \(item\.return_date - item\.discharge_date\)/)
    expect(sql).toMatch(/item\.days_p1 \+ item\.days_p2 > GREATEST\(item\.total_days - item\.free_days, 0\)/)
    expect(sql).toMatch(/item\.days_p1 \* item\.rate_p1_usd \+ item\.days_p2 \* item\.rate_p2_usd/)
    expect(sql).toMatch(/Calculo de Demurrage inconsistente/)
  })
})
