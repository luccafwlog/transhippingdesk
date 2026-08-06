import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('lock recalc of invoiced bl migration (262)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/262_lock_recalc_invoiced_bl.sql'),
    'utf8',
  )

  it('redefines calculate_bl_local_charges keeping the active-user guard', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).toContain("IF auth.uid() IS NULL OR NOT public.is_active_user() THEN")
  })

  it('reads financial_status and rejects invoiced/partially_paid/paid before touching charge_calculations', () => {
    expect(sql).toContain('b.financial_status,')
    const guardIndex = sql.indexOf("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
    const deleteIndex = sql.indexOf('DELETE FROM public.charge_calculations')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(guardIndex)
    expect(sql).toContain("USING ERRCODE = '22023'")
  })

  it('keeps the authenticated-only grant', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) TO authenticated')
  })
})
