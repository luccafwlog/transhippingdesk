import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/220_agency_report_actor_names_read.sql')

describe('migration 220 — nomes dos atores do ADR', () => {
  it('expõe apenas os nomes dos atores de um ADR legível pelo usuário', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.get_agency_report_actor_names[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toContain('SECURITY DEFINER')
    expect(body).toContain('SET search_path = public, pg_temp')
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_read_user\(\)/)
    expect(body).toMatch(/RETURNS TABLE \(user_id UUID, full_name TEXT\)/)
    // Atores: quem fechou, quem assinou seções e quem lançou ocorrências.
    expect(body).toMatch(/closed_by/)
    expect(body).toMatch(/agency_departure_report_signoffs/)
    expect(body).toMatch(/agency_departure_report_occurrences/)
    // Nunca abre user_profiles arbitrariamente: filtra pelo conjunto de atores.
    expect(body).not.toMatch(/FROM public\.user_profiles up\s*;/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_agency_report_actor_names\(BIGINT, TEXT\) FROM PUBLIC, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_agency_report_actor_names\(BIGINT, TEXT\) TO authenticated/)
  })
})
