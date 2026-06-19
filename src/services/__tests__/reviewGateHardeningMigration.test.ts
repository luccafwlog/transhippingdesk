import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260619130000_review_gate_hardening.sql',
)
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''

describe('review gate hardening migration', () => {
  it('existe como migration posterior aos PRs 249-251', () => {
    expect(existsSync(migrationPath)).toBe(true)
  })

  it('considera portal funcional somente com conta ativa e usuario Auth', () => {
    expect(sql).toContain('a.active = true')
    expect(sql).toContain('a.auth_user_id IS NOT NULL')
  })

  it('mantem helpers privilegiados fora da API publica', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(TEXT) FROM PUBLIC, anon, authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.compute_bl_review_pendencies(BIGINT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated',
    )
  })

  it('restaura reconciliacao, billing hold e sincronizacao da fila', () => {
    expect(sql).toContain('customer_reconciliation_status = CASE')
    expect(sql).toContain('customer_reconciliation_notes = CASE')
    expect(sql).toContain('billing_hold_reason = CASE')
    expect(sql).toContain('PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id)')
  })

  it('audita o status real em vez do status fabricado pelo cliente', () => {
    expect(sql).toContain("a->>'field_name' IS DISTINCT FROM 'review_status'")
    expect(sql).toMatch(/'review_status',\s+v_previous_status,\s+v_status/)
  })

  it('aplica o gate na importacao antes do billing', () => {
    const gatePosition = sql.indexOf(
      'PERFORM public.apply_bl_review_gate_after_import(v_bl_ids, p_uploaded_by)',
    )
    const billingPosition = sql.indexOf(
      'PERFORM public.run_billing_for_import_batch(v_batch_id, p_uploaded_by, true)',
    )

    expect(gatePosition).toBeGreaterThan(-1)
    expect(billingPosition).toBeGreaterThan(gatePosition)
  })

  it('bloqueia promocao e faturamento por pendencias canonicas', () => {
    expect(sql).toContain('v_review_reasons := public.compute_bl_review_pendencies(p_bl_id)')
    expect(sql).toMatch(
      /public\.compute_bl_review_pendencies\(\s*NEW\.customer_id,\s*NEW\.cargo_mode,\s*NEW\.bb_weight_ton\s*\)/,
    )
    expect(sql).toContain('B/L possui pendencias no gate de revisao')
  })

  it('nao executa backfill top-level dos BLs historicos', () => {
    expect(sql).not.toMatch(
      /^UPDATE\s+public\.bls\s+SET\s+review_status\s*=\s*'pending_review'/im,
    )
  })

  it('documenta reversao operacional', () => {
    expect(sql).toContain('-- Rollback:')
  })
})
