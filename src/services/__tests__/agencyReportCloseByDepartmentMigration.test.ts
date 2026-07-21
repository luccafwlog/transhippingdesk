import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/224_agency_report_close_by_department.sql'),
  'utf8',
)

describe('migration 224 — fechamento por 3 departamentos', () => {
  it('conta departamentos assinados, nao secoes, para o gate de fechamento', () => {
    expect(sql).toContain('FROM public.agency_departure_report_department_signoffs')
    expect(sql).toContain('WHERE report_id = v_report_id AND signed_at IS NOT NULL')
    expect(sql).toContain("IF v_signed_departments <> 3 THEN")
    expect(sql).toContain("RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados")
  })

  it('reabertura tambem limpa os sign-offs departamentais', () => {
    expect(sql).toContain('UPDATE public.agency_departure_report_department_signoffs')
    expect(sql).toMatch(/SET signed_by = NULL, signed_at = NULL\s*\n\s*WHERE report_id = v_report_id;\s*\n\s*\n\s*INSERT INTO public\.audit_logs/)
  })
})
