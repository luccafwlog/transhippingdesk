import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/218_agency_report_reopen_admin.sql')
const closeMigrationPath = resolve(process.cwd(), 'supabase/migrations/214_agency_report_pending_alerts.sql')

describe('migration 218 — RBAC da reabertura do Agency Departure Report', () => {
  it('restringe reabertura direta a administradores ativos', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.reopen_agency_departure_report[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toContain('SECURITY DEFINER')
    expect(body).toContain('SET search_path = public, pg_temp')
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\) OR NOT public\.is_admin\(\)/)
    expect(body).toMatch(/RAISE EXCEPTION 'Sem permissao\.' USING ERRCODE = '42501'/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.reopen_agency_departure_report\(BIGINT, TEXT, TEXT\) FROM PUBLIC, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reopen_agency_departure_report\(BIGINT, TEXT, TEXT\) TO authenticated/)
  })

  it('preserva o fechamento para qualquer usuário interno ativo', () => {
    const closeSql = readFileSync(closeMigrationPath, 'utf8')
    const closeBody = closeSql.match(/CREATE OR REPLACE FUNCTION public\.close_agency_departure_report[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(closeBody).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\)/)
    expect(closeBody).not.toContain('public.is_admin()')
  })
})
