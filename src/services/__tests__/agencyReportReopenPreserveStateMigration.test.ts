import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(process.cwd(), 'supabase/migrations')
const migrationPath = resolve(migrationsDir, '227_agency_report_reopen_preserve_state.sql')

function reopenBody(sql: string) {
  return sql.match(/CREATE OR REPLACE FUNCTION public\.reopen_agency_departure_report[\s\S]*?\$function\$;/i)?.[0] ?? ''
}

describe('migration 227 — reabertura preserva secoes e sign-offs departamentais', () => {
  it('existe e redefine reopen_agency_departure_report', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')
    expect(reopenBody(sql)).not.toBe('')
  })

  it('nao reseta secoes nem sign-offs departamentais', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = reopenBody(sql)
    expect(body).not.toMatch(/UPDATE public\.agency_departure_report_signoffs/)
    expect(body).not.toMatch(/UPDATE public\.agency_departure_report_department_signoffs/)
  })

  it('continua alterando status/closed_at/closed_by/closed_snapshot do relatorio', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = reopenBody(sql)
    expect(body).toMatch(/UPDATE public\.agency_departure_reports\s*\n\s*SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL/)
  })

  it('mantem o guard de admin e a exigencia de justificativa', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = reopenBody(sql)
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\) OR NOT public\.is_admin\(\)/)
    expect(body).toMatch(/RAISE EXCEPTION 'Reabertura exige justificativa\.' USING ERRCODE = '22023'/)
  })

  it('continua gravando a transicao de status em audit_logs', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    const body = reopenBody(sql)
    expect(body).toMatch(/INSERT INTO public\.audit_logs/)
    expect(body).toMatch(/'agency_departure_report', p_voyage_id \|\| '::' \|\| upper\(btrim\(p_port\)\)/)
  })

  it('restringe grants a authenticated', () => {
    const sql = readFileSync(migrationPath, 'utf8')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) TO authenticated;')
  })

  it('nenhuma migration posterior a 227 redefine reopen_agency_departure_report resetando secoes/sign-offs', () => {
    const laterMigrations = readdirSync(migrationsDir)
      .filter((name) => /^\d+_.*\.sql$/.test(name) && Number(name.split('_')[0]) > 227)
      .sort()

    const redefinitions = laterMigrations
      .map((name) => ({ name, sql: readFileSync(resolve(migrationsDir, name), 'utf8') }))
      .filter(({ sql }) => /CREATE OR REPLACE FUNCTION public\.reopen_agency_departure_report/i.test(sql))

    for (const { name, sql } of redefinitions) {
      const body = reopenBody(sql)
      expect(body, `${name} nao deve voltar a resetar secoes/sign-offs na reabertura`)
        .not.toMatch(/UPDATE public\.agency_departure_report_signoffs/)
      expect(body, `${name} nao deve voltar a resetar secoes/sign-offs na reabertura`)
        .not.toMatch(/UPDATE public\.agency_departure_report_department_signoffs/)
    }
  })
})
