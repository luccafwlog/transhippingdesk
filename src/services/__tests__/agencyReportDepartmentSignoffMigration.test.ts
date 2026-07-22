import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/223_agency_report_department_signoff.sql'),
  'utf8',
)

describe('migration 223 — sign-off departamental', () => {
  it('cria a tabela departamental com RLS e trigger de ADR fechado', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agency_departure_report_department_signoffs')
    expect(sql).toContain("CHECK (department IN ('operacoes', 'documentacao', 'equipamentos'))")
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('EXECUTE FUNCTION public.agency_report_reject_closed_write()')
  })

  it('so permite assinar com todas as secoes do departamento resolvidas', () => {
    expect(sql).toMatch(/Assinar exige todas as secoes do departamento resolvidas/)
    expect(sql).toContain("COALESCE((\n          SELECT so.state FROM public.agency_departure_report_signoffs so")
    expect(sql).toContain("RAISE EXCEPTION 'Departamento % tem secoes pendentes")
  })

  it('exige justificativa para reabrir e grava evento em audit_logs', () => {
    expect(sql).toContain('Reabrir o sign-off departamental exige justificativa.')
    expect(sql).toContain("'agency_departure_report_department_signoff'")
  })

  it('e idempotente quando o estado pedido ja e o atual', () => {
    expect(sql).toMatch(/IF v_currently_signed = p_signed THEN\s*RETURN jsonb_build_object\('report_id', v_report_id, 'unchanged', TRUE\);/)
  })

  it('protege a RPC por departamento/admin e restringe grants', () => {
    expect(sql).toContain("IF v_role NOT IN ('administrativo', p_department) THEN")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.set_agency_report_department_signoff(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.set_agency_report_department_signoff(BIGINT, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;')
  })

  it('estende get_agency_report_actor_names para assinantes e historico departamentais', () => {
    expect(sql).toContain('dso.signed_by FROM public.agency_departure_report_department_signoffs dso')
    expect(sql).toContain("al.entity_type IN ('agency_departure_report_signoff', 'agency_departure_report_department_signoff')")
  })
})
