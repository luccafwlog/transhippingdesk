import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('rateio rounding last share absorbs difference migration (269)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/269_rateio_rounding_last_share_absorbs_diff.sql'),
    'utf8',
  )

  it('redefines calculate_bl_local_charges keeping the earlier guards', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).toContain("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
    expect(sql).toContain('v_is_lcl_movement')
  })

  it('captures the share group (classification, share_count, is_last) alongside the aggregate quantities', () => {
    expect(sql).toContain("MAX(b2.id) AS last_bl_id")
    expect(sql).toContain("'is_last', (p_bl_id = last_bl_id)")
    expect(sql).toContain('INTO v_qty_total, v_qty_std, v_qty_imo, v_qty_oog, v_qty_dual, v_container_shares')
  })

  it('container_distinct_voyage items sum per-container amounts instead of ROUND(aggregate qty * rate, 2)', () => {
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges')
    const bodyAfterOverride = sql.indexOf('v_override := item.override_value IS NOT NULL;', fnStart)
    const nextFooter = sql.indexOf('REVOKE ALL ON FUNCTION', fnStart)
    const body = sql.slice(bodyAfterOverride, nextFooter)

    expect(body).toContain("IF item.application_basis = 'container_distinct_voyage' AND v_bl.cargo_mode = 'container' THEN")
    expect(body).toContain('FROM jsonb_array_elements(COALESCE(v_container_shares')
    expect(body).toContain(
      "CASE WHEN (elem->>'is_last')::BOOLEAN\n              THEN COALESCE(v_unit_brl, 0) - ((elem->>'share_count')::NUMERIC - 1) * ROUND(COALESCE(v_unit_brl, 0) / (elem->>'share_count')::NUMERIC, 2)",
    )
    // Outros application_basis (bl, weight_ton) continuam no caminho antigo.
    expect(body).toContain("v_total_line_brl := CASE WHEN item.currency = 'USD' THEN NULL ELSE ROUND(v_qty * COALESCE(v_unit_brl, 0), 2) END;")
  })

  it('applies the same standard/imo/oog bucket filter as the old quantity selection, so classification is unchanged', () => {
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.calculate_bl_local_charges')
    const bodyAfterOverride = sql.indexOf('v_override := item.override_value IS NOT NULL;', fnStart)
    const body = sql.slice(bodyAfterOverride)

    expect(body).toContain("NOT v_is_thd")
    expect(body).toContain("item.cargo_profile = 'standard' AND NOT (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN")
    expect(body).toContain("item.cargo_profile = 'imo' AND (elem->>'has_imo')::BOOLEAN AND NOT (elem->>'has_oog')::BOOLEAN")
    expect(body).toContain("item.cargo_profile = 'oog' AND (elem->>'has_oog')::BOOLEAN AND NOT (elem->>'has_imo')::BOOLEAN")
  })
})
