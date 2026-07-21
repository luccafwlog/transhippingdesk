import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/221_agency_report_signoff_history.sql')

describe('migration 221 — histórico e justificativa do sign-off do Agency Departure Report', () => {
  it('exige justificativa apenas ao alterar uma decisão já registrada', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.set_agency_report_signoff[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toContain('p_justification TEXT DEFAULT NULL')
    expect(body).toMatch(/v_current <> 'pending' AND v_justification IS NULL/)
    expect(body).toMatch(/RAISE EXCEPTION 'Alterar uma decisao ja registrada exige justificativa\.' USING ERRCODE = '22023'/)
  })

  it('não exige justificativa nem grava evento quando o estado não muda', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.set_agency_report_signoff[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toMatch(/v_current = p_state THEN\s*\n\s*RETURN jsonb_build_object\('report_id', v_report_id, 'unchanged', TRUE\)/)
  })

  it('grava a transição em audit_logs em vez de criar tabela nova', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.set_agency_report_signoff[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(sql).not.toMatch(/CREATE TABLE/i)
    expect(body).toMatch(/INSERT INTO public\.audit_logs/)
    expect(body).toMatch(/'agency_departure_report_signoff'/)
    expect(body).toMatch(/p_voyage_id \|\| '::' \|\| upper\(btrim\(p_port\)\) \|\| '::' \|\| p_section/)
  })

  it('mantém least-privilege: revoke PUBLIC/anon e grant apenas para authenticated', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_agency_report_signoff\(BIGINT, TEXT, TEXT, TEXT, TEXT\) FROM PUBLIC, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_agency_report_signoff\(BIGINT, TEXT, TEXT, TEXT, TEXT\) TO authenticated/)
  })

  it('estende get_agency_report_actor_names para resolver autores do histórico', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.get_agency_report_actor_names[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toMatch(/al\.entity_type = 'agency_departure_report_signoff'/)
    expect(body).toMatch(/SECURITY DEFINER/)
  })
})
