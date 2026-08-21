import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/324_review_bl_alerts_lifecycle.sql')

describe('migration 324: ciclo de vida dos alertas de revisão de B/L e Granito', () => {
  it('declara as funções de reconciliação de alertas, triggers e detectores para B/L e Granito', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reconcile_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reconcile_granite_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_reconcile_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.trg_reconcile_granite_bl_review_alerts/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.detect_bl_review_pendencies/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.detect_granite_bl_review_pendencies/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.run_alert_detectors/i)

    expect(sql).toMatch(/review_customer_unlinked/i)
    expect(sql).toMatch(/review_customer_email_missing/i)
    expect(sql).toMatch(/review_breakbulk_weight_missing/i)
    expect(sql).toMatch(/review_granite_customer_unlinked/i)

    expect(sql).toMatch(/upsert_alert_item/i)
    expect(sql).toMatch(/resolve_alert_item/i)
    expect(sql).toMatch(/compute_bl_review_pendencies/i)

    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reconcile_bl_review_alerts\(TEXT(?:,\s*TEXT)?\) TO service_role/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reconcile_granite_bl_review_alerts\(BIGINT(?:,\s*TEXT)?\) TO service_role/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.detect_bl_review_pendencies\(\) TO service_role/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.detect_granite_bl_review_pendencies\(\) TO service_role/i)
  })

  it('integra os detectores de revisão ao executor de cron de 15 minutos', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch(/v_bl_review := public\.detect_bl_review_pendencies\(\)/i)
    expect(sql).toMatch(/v_granite_review := public\.detect_granite_bl_review_pendencies\(\)/i)
    expect(sql).toMatch(/'bl_review_pendencies', v_bl_review/i)
    expect(sql).toMatch(/'granite_bl_review_pendencies', v_granite_review/i)
  })
})
