import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('vehicle exemption requires lcl movement migration (265)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/265_vehicle_exemption_requires_lcl_movement.sql'),
    'utf8',
  )

  it('redefines calculate_bl_local_charges keeping the earlier guards', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).toContain("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
    expect(sql).toContain("'review:no_containers'")
  })

  it('stops writing container_load_type', () => {
    expect(sql).not.toContain('SET container_load_type')
    expect(sql).not.toContain('container_load_type,')
  })

  it('requires movement_to to indicate LCL or CFS before exempting a vehicle bl', () => {
    expect(sql).toContain('b.movement_to,')
    expect(sql).toContain("UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%'")
    expect(sql).toContain("UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'")
    const guardIndex = sql.indexOf('v_is_lcl_movement := v_bl.movement_to IS NOT NULL')
    const exemptIfIndex = sql.indexOf("IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN")
    expect(guardIndex).toBeGreaterThan(-1)
    expect(exemptIfIndex).toBeGreaterThan(guardIndex)
  })

  it('missing or unrecognized movement_to falls through to normal charging, not exemption', () => {
    // v_is_lcl_movement defaults to false and is only flipped true by a positive LIKE match —
    // there is no ELSE branch that exempts, so absence of proof means the item loop below runs.
    expect(sql).toContain('v_is_lcl_movement BOOLEAN := false;')
  })

  it('keeps the authenticated-only grant', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.calculate_bl_local_charges(TEXT, UUID, BOOLEAN) TO authenticated')
  })
})
