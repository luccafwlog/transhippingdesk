import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/213_agency_departure_reports.sql'),
  'utf-8',
)

describe('migration 213 — agregado do Agency Departure Report', () => {
  it('ancora em (voyage_id, port) com unicidade', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agency_departure_reports')
    expect(sql).toContain('UNIQUE (voyage_id, port)')
  })

  it('nunca usa o prefixo abreviado adr_', () => {
    expect(sql).not.toMatch(/\badr_/)
  })

  it('sign-off valida o departamento dono da secao', () => {
    expect(sql).toContain('agency_report_section_owner')
    expect(sql).toMatch(/v_role NOT IN \('administrativo', v_owner\)/)
  })

  it('bloqueia sign-off fechado e deixa escrita somente nas RPCs', () => {
    expect(sql).toContain("status = 'closed'")
    expect(sql).not.toMatch(/CREATE POLICY \S+ ON public\.agency_departure_report\S* FOR (INSERT|UPDATE|DELETE|ALL)/)
  })

  it('permite leitura a perfis ativos e protege as RPCs definidoras', () => {
    expect(sql).toContain('public.is_active_read_user()')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.set_agency_report_signoff')
  })
})
