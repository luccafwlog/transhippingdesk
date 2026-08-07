import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Registro histórico: as asserções abaixo descrevem o conteúdo da migration
// 266, não o comportamento atual do motor. A ADR 0040 (migration 274) removeu
// a trava do ETA e a resolução da tabela por vigência — o comportamento vigente
// está em `chargeTableValidityInformationalMigration.test.ts`.
describe('rate reference date from pod eta migration (266, supersedida pela 274)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/266_rate_reference_date_from_pod_eta.sql'),
    'utf8',
  )

  it('redefines calculate_bl_local_charges keeping the earlier guards', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_bl_local_charges\b/)
    expect(sql).toContain("IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN")
    expect(sql).toContain('v_is_lcl_movement')
  })

  it('reads v_ref_date from the voyage pod_schedule_snapshot eta, not upload/created dates', () => {
    expect(sql).toContain("pod_schedule_snapshot -> v_bl.pod ->> 'eta'")
    expect(sql).not.toContain('COALESCE((v_bl.uploaded_at)::DATE, (v_bl.created_at)::DATE, CURRENT_DATE)')
  })

  it('validates the eta text is an ISO date before casting, so malformed audit text degrades to review:no_eta instead of raising', () => {
    expect(sql).toContain("v_eta_raw.eta_text ~ '^\\d{4}-\\d{2}-\\d{2}$'")
    expect(sql).not.toContain("NULLIF(v.pod_schedule_snapshot -> v_bl.pod ->> 'eta', '')::DATE")
  })

  it('flags missing eta as review_required instead of falling back to another date', () => {
    expect(sql).toContain("'review:no_eta'")
    expect(sql).toContain('IF v_ref_date IS NULL THEN')
  })

  it('runs the eta check after the vehicle exemption early return, not before', () => {
    const exemptReturnIndex = sql.indexOf("'exempt', true,")
    const etaCheckIndex = sql.indexOf("'review:no_eta'")
    expect(exemptReturnIndex).toBeGreaterThan(-1)
    expect(etaCheckIndex).toBeGreaterThan(exemptReturnIndex)
  })

  it('only resolves the charge table (and therefore the item loop and overrides) when v_ref_date is present', () => {
    const guardIndex = sql.indexOf('IF v_ref_date IS NOT NULL THEN')
    const resolveIndex = sql.indexOf('public.resolve_local_charge_table_id(v_bl.cargo_mode, v_bl.pod, v_ref_date)')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(resolveIndex).toBeGreaterThan(guardIndex)
  })
})
