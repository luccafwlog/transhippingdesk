import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/364_consolidate_bl_review_alerts_by_customer.sql')

describe('migration 364: consolidação dos alertas de revisão de B/L por cliente', () => {
  it('declara as funções de reconciliação agrupadas por cliente, triggers e detectores', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reconcile_customer_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reconcile_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.detect_bl_review_pendencies/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_reconcile_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_reconcile_bl_review_on_portal_change/i)

    expect(sql).toMatch(/review_customer_unlinked/i)
    expect(sql).toMatch(/review_customer_email_missing/i)
    expect(sql).toMatch(/review_portal_not_ready/i)
    expect(sql).toMatch(/review_breakbulk_weight_missing/i)

    expect(sql).toMatch(/upsert_alert_item/i)
    expect(sql).toMatch(/resolve_alert_item/i)

    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reconcile_customer_bl_review_alerts\(BIGINT,\s*TEXT(?:,\s*TEXT)?\) TO service_role/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reconcile_bl_review_alerts\(TEXT(?:,\s*TEXT)?\) TO service_role/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.detect_bl_review_pendencies\(\) TO service_role/i)
  })

  it('garante que a permissão de execução foi revogada de PUBLIC, anon e authenticated', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.reconcile_customer_bl_review_alerts\(BIGINT,\s*TEXT,\s*TEXT\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.reconcile_bl_review_alerts\(TEXT,\s*TEXT\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.detect_bl_review_pendencies\(\) FROM PUBLIC, anon, authenticated/i)
  })
})
