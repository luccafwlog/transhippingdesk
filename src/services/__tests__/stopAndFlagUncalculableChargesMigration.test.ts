import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('stop and flag uncalculable charges migration (264)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/264_stop_and_flag_uncalculable_charges.sql'),
    'utf8',
  )

  it('redefines calculate_bl_local_charges keeping the invoiced-lock guard', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).toContain("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
  })

  it('flags a B/L de container without any registered container instead of silently skipping', () => {
    expect(sql).toContain("'review:no_containers'")
    expect(sql).toContain('SELECT NOT EXISTS(')
  })

  it('flags THD items registered with cargo_profile any instead of computing zero', () => {
    expect(sql).toContain("CONCAT('review:thd_any_profile:', item.id)")
  })

  it('flags items whose application_basis the engine does not implement (e.g. teu)', () => {
    expect(sql).toContain("CONCAT('review:unsupported_basis:', item.id)")
  })

  it('none of the three new guards fall through to the silent qty<=0 CONTINUE', () => {
    const noContainersIndex = sql.indexOf("'review:no_containers'")
    const zeroQtyContinueIndex = sql.indexOf('IF COALESCE(v_qty, 0) <= 0 THEN')
    expect(noContainersIndex).toBeGreaterThan(-1)
    expect(zeroQtyContinueIndex).toBeGreaterThan(noContainersIndex)
  })
})
