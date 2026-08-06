import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('fix review 501 faturamento migration (270)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/270_fix_review_501_faturamento.sql'),
    'utf8',
  )

  it('achado 1: invoice_bls.subtotal_brl sums the converted USD->BRL amount, not raw total_value_brl', () => {
    const subtotalSubqueryIndex = sql.indexOf('SUM(COALESCE(cc.total_value_brl,')
    expect(subtotalSubqueryIndex).toBeGreaterThan(-1)
    const subtotalSubquery = sql.slice(subtotalSubqueryIndex, subtotalSubqueryIndex + 400)
    expect(subtotalSubquery).toContain("CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * v_roe, 2) END")
  })

  it('achado 4: consolidation uses each receivable frozen ROE instead of re-reading current ROE', () => {
    expect(sql).toContain('roe_frozen')
    expect(sql).toContain('roe_effective_date_frozen')
    expect(sql).toContain('JOIN public.bl_receivables br ON br.id = l.receivable_id')
    // the consolidated detail conversion must reference the per-receivable frozen roe, not a single re-read v_roe
    const consolidatedCalcs = sql.slice(sql.indexOf('calcs AS ('), sql.indexOf('bl_recon AS ('))
    expect(consolidatedCalcs).toContain('links.roe_frozen')
  })

  it('achado 8: guards valid_from > valid_to before constructing any daterange', () => {
    expect(sql).toContain('valid_from > valid_to')
    expect(sql).toContain('customer_rate_overrides_validate_range')
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.customer_rate_overrides')
  })

  it('achado 3: falls back to voyages.eta when the POD schedule snapshot has no valid ETA yet', () => {
    const fnIndex = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges')
    expect(fnIndex).toBeGreaterThan(-1)
    const fnBody = sql.slice(fnIndex)
    const firstRefDateNullIndex = fnBody.indexOf('IF v_ref_date IS NULL THEN')
    const fallbackIndex = fnBody.indexOf('FROM public.voyages AS v\n    WHERE v.id = v_bl.voyage_id\n      AND v.eta IS NOT NULL')
    const noEtaInsertIndex = fnBody.indexOf("'review:no_eta'")
    expect(fallbackIndex).toBeGreaterThan(firstRefDateNullIndex)
    expect(noEtaInsertIndex).toBeGreaterThan(fallbackIndex)
  })
})
