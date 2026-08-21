import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Migration 332: Unified Alerts Runner', () => {
  const migrationPath = resolve(process.cwd(), 'supabase/migrations/332_unified_alerts_runner.sql')
  const sql = readFileSync(migrationPath, 'utf8')

  it('declara a função public.run_alert_detectors com security definer e controle server-only', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.run_alert_detectors\(\)/i)
    expect(sql).toMatch(/LANGUAGE plpgsql/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/i)
  })

  it('chama todos os detectores dos blocos 520 a 524', () => {
    expect(sql).toContain('public.detect_overdue_invoices()')
    expect(sql).toContain('public.detect_agency_report_pending()')
    expect(sql).toContain('public.detect_agency_report_deadline_missed()')
    expect(sql).toContain('public.detect_bl_review_pendencies()')
    expect(sql).toContain('public.detect_granite_bl_review_pendencies()')
    expect(sql).toContain('public.detect_voyage_operation_alerts()')
    expect(sql).toContain('public.reconcile_client_portal_alerts()')
  })

  it('restringe grants para service_role exclusivamente', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.run_alert_detectors() FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.run_alert_detectors() TO service_role;')
  })
})
