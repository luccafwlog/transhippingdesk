import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/225_agency_report_department_alerts.sql'),
  'utf8',
)

describe('migration 225 — alertas de pendência por departamento', () => {
  it('detecta pendência por departamento (qualquer seção sua ainda pendente), não por seção', () => {
    expect(sql).toContain("'agency_report_department_pending'")
    expect(sql).toContain("unnest(ARRAY['operacoes', 'documentacao', 'equipamentos']) AS department")
    expect(sql).toContain('public.agency_report_section_owner(all_sections.section) = dep.department')
  })

  it('mantém o corte pós-ATD e deduplica alertas de departamento ativos', () => {
    expect(sql).toMatch(/changed_at >= TIMESTAMPTZ/)
    expect(sql).toMatch(/NOT EXISTS[\s\S]*agency_report_department_pending/)
  })

  it('sign-off por seção deixa de fechar o alerta obsoleto por seção', () => {
    const [, signoffFunctionBody] = sql.split('CREATE OR REPLACE FUNCTION public.set_agency_report_signoff(')
    expect(signoffFunctionBody).not.toContain('agency_report_section_pending')
  })

  it('sign-off departamental fecha o alerta do departamento ao assinar', () => {
    expect(sql).toMatch(/set_agency_report_department_signoff[\s\S]*IF p_signed THEN\s*UPDATE public\.alerts[\s\S]*agency_report_department_pending/)
  })

  it('protege a RPC de deteccao por usuário ativo', () => {
    expect(sql).toContain('IF auth.uid() IS NULL OR NOT public.is_active_user() THEN')
  })
})
