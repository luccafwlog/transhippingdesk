import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/271_agency_report_deadline_missed.sql'),
  'utf8',
)

describe('migration 271 — vencimento do Prazo de Conclusão do ADR (ADR 0039)', () => {
  it('grava a vigência do compromisso e não retroage', () => {
    expect(sql).toContain("VALUES ('agency_report_deadline_missed', clock_timestamp())")
    expect(sql).toMatch(/atd >= \(\s*SELECT captured_at::DATE/)
  })

  it('calcula o vencimento em dias úteis, sem contar o dia do ATD', () => {
    expect(sql).toContain('EXTRACT(ISODOW FROM v_cursor) < 6')
    expect(sql).toContain('v_cursor := v_cursor + 1;')
  })

  it('exclui escala omitida e deduplica por (viagem, porto, departamento)', () => {
    expect(sql).toMatch(/field_name = 'omitted'/)
    expect(sql).toMatch(/NOT EXISTS[\s\S]*agency_report_deadline_missed/)
  })

  it('protege as RPCs por usuário ativo e restringe sua execução', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('IF auth.uid() IS NULL OR NOT public.is_active_user() THEN')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.detect_agency_report_deadline_missed() FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.detect_agency_report_deadline_missed() TO authenticated;')
  })

  it('fecha o alerta de vencimento junto com o Fechamento do ADR, sem substituir o de pendência', () => {
    expect(sql).toMatch(/close_agency_departure_report[\s\S]*agency_report_section_pending/)
    expect(sql).toMatch(/close_agency_departure_report[\s\S]*agency_report_deadline_missed/)
  })
})
