import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/214_agency_report_pending_alerts.sql'),
  'utf8',
)

describe('migration 214 — pendências de Agency Departure Report pós-ATD', () => {
  it('detecta somente escalas com ATD atual e seções pendentes de ADR aberto', () => {
    expect(sql).toContain("field_name = 'atd'")
    expect(sql).toContain("COALESCE(r.status, 'open') = 'open'")
    expect(sql).toContain("COALESCE(so.state, 'pending') = 'pending'")
  })

  it('mantém o corte de implantação, normaliza o porto e deduplica alertas ativos', () => {
    expect(sql).toMatch(/changed_at >= TIMESTAMPTZ/)
    expect(sql).toMatch(/upper\(trim\(split_part/)
    expect(sql).toMatch(/NOT EXISTS[\s\S]*agency_report_section_pending/)
  })

  it('protege a RPC por usuário ativo e restringe sua execução', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('IF auth.uid() IS NULL OR NOT public.is_active_user() THEN')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;')
  })
})
