import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(process.cwd(), 'supabase/migrations')
const migrationPath = resolve(migrationsDir, '228_agency_report_section_observation.sql')
const sql = readFileSync(migrationPath, 'utf8')

function functionBody(name: string) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$;`, 'i')
  return sql.match(re)?.[0] ?? ''
}

describe('migration 228 — Observacao por secao substitui Ocorrencias', () => {
  it('existe', () => {
    expect(existsSync(migrationPath)).toBe(true)
  })

  it('remove linhas de resolucao da secao ocorrencias antes de estreitar o CHECK', () => {
    const deleteIndex = sql.indexOf("DELETE FROM public.agency_departure_report_signoffs WHERE section = 'ocorrencias';")
    const checkIndex = sql.indexOf('agency_departure_report_signoffs_section_check CHECK')
    expect(deleteIndex).toBeGreaterThan(-1)
    expect(checkIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeLessThan(checkIndex)
  })

  it('estreita o CHECK de secao para as 7 remanescentes, sem ocorrencias', () => {
    expect(sql).toMatch(
      /CHECK \(section IN \(\s*'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',\s*'vazios_embarcados', 'vazios_descarregados', 'operacao_patio'\s*\)\)/,
    )
    expect(sql).not.toMatch(/CHECK \(section IN \([^)]*'ocorrencias'[^)]*\)\)/)
  })

  it('adiciona a coluna observation (nullable)', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS observation TEXT;')
  })

  it('agency_report_section_owner deixa de mapear ocorrencias', () => {
    const body = functionBody('agency_report_section_owner')
    expect(body).not.toMatch(/'ocorrencias'/)
    expect(body).toMatch(/WHEN 'datas' THEN 'operacoes'/)
  })

  describe('set_agency_report_section_observation', () => {
    const body = functionBody('set_agency_report_section_observation')

    it('existe e restringe escrita ao dono da secao', () => {
      expect(body).not.toBe('')
      expect(body).toMatch(/IF v_role NOT IN \('administrativo', v_owner\) THEN/)
      expect(body).toMatch(/RAISE EXCEPTION 'Secao invalida\.' USING ERRCODE = '22023'/)
    })

    it('sobrescrever nao exige justificativa nem grava audit_logs', () => {
      expect(body).not.toMatch(/justification/i)
      expect(body).not.toMatch(/audit_logs/)
    })

    it('nao altera state/signed_by/signed_at da resolucao de secao', () => {
      expect(body).toMatch(/ON CONFLICT \(report_id, section\) DO UPDATE SET\s*observation = EXCLUDED\.observation;/)
    })

    it('bloqueia escrita com ADR fechado', () => {
      expect(body).toMatch(/ADR fechado: reabra antes de alterar a observacao\./)
    })

    it('restringe grants a authenticated', () => {
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.set_agency_report_section_observation(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;')
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.set_agency_report_section_observation(BIGINT, TEXT, TEXT, TEXT) TO authenticated;')
    })
  })

  it('set_agency_report_department_signoff deixa de considerar ocorrencias (Operacoes com 1 secao)', () => {
    const body = functionBody('set_agency_report_department_signoff')
    expect(body).not.toBe('')
    expect(body).not.toMatch(/'ocorrencias'/)
    expect(body).toMatch(
      /\('datas'\), \('carga_descarregada'\), \('carga_carregada'\), \('veiculos'\),\s*\('vazios_embarcados'\), \('vazios_descarregados'\), \('operacao_patio'\)/,
    )
  })

  it('detect_agency_report_pending deixa de considerar ocorrencias', () => {
    const body = functionBody('detect_agency_report_pending')
    expect(body).not.toBe('')
    expect(body).not.toMatch(/'ocorrencias'/)
    expect(body).toMatch(
      /\('datas'\), \('carga_descarregada'\), \('carga_carregada'\), \('veiculos'\),\s*\('vazios_embarcados'\), \('vazios_descarregados'\), \('operacao_patio'\)/,
    )
  })

  it('nenhuma migration posterior a 228 volta a incluir ocorrencias no gate departamental ou no alerta de pendencia', () => {
    const laterMigrations = readdirSync(migrationsDir)
      .filter((name) => /^\d+_.*\.sql$/.test(name) && Number(name.split('_')[0]) > 228)
      .sort()

    for (const name of laterMigrations) {
      const laterSql = readFileSync(resolve(migrationsDir, name), 'utf8')
      for (const fn of ['set_agency_report_department_signoff', 'detect_agency_report_pending']) {
        const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?\\$function\\$;`, 'i')
        const body = laterSql.match(re)?.[0]
        if (body) {
          expect(body, `${name} nao deve reintroduzir 'ocorrencias' em ${fn}`).not.toMatch(/'ocorrencias'/)
        }
      }
    }
  })
})
