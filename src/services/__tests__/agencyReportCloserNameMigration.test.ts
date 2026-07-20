import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/217_agency_report_closer_name_read.sql')

describe('migration 217 — nome do autor do fechamento do ADR', () => {
  it('expõe somente o nome do autor no escopo de um ADR que o usuário pode ler', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.get_agency_report_closer_name[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toContain('SECURITY DEFINER')
    expect(body).toContain('SET search_path = public, pg_temp')
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_read_user\(\)/)
    expect(body).toMatch(/FROM public\.agency_departure_reports[\s\S]*voyage_id = p_voyage_id[\s\S]*port = upper\(btrim\(p_port\)\)/)
    expect(body).toMatch(/SELECT full_name INTO v_closer_name[\s\S]*FROM public\.user_profiles[\s\S]*WHERE id = v_closed_by/)
    expect(body).not.toMatch(/FROM public\.user_profiles[\s\S]*WHERE id = auth\.uid\(\)/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_agency_report_closer_name\(BIGINT, TEXT\) FROM PUBLIC, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_agency_report_closer_name\(BIGINT, TEXT\) TO authenticated/)
  })
})
