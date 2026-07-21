import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/219_agency_report_alert_copy.sql')

describe('migration 219 — copy legível dos alertas pós-ATD do ADR', () => {
  it('gera mensagem com labels pt-BR e nomeia o departamento dono', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.agency_report_section_label/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.agency_report_department_label/)
    expect(sql).toMatch(/WHEN 'vazios_embarcados' THEN 'Vazios embarcados'/)
    expect(sql).toMatch(/WHEN 'documentacao' THEN 'Documentação'/)

    const detect = sql.match(/CREATE OR REPLACE FUNCTION public\.detect_agency_report_pending[\s\S]*?\$function\$;/i)?.[0] ?? ''
    expect(detect).toContain('SECURITY DEFINER')
    expect(detect).toMatch(/agency_report_section_label\(p\.section\)/)
    expect(detect).toMatch(/agency_report_department_label\(public\.agency_report_section_owner\(p\.section\)\)/)
    expect(detect).toContain('seção "')
    expect(detect).toContain('pendente — ')
    // Preserva o contrato da 214: baseline, dedupe e entity_id compostos.
    expect(detect).toMatch(/changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00\+00'/)
    expect(detect).toMatch(/a\.status <> 'closed'/)

    // Backfill só reescreve alertas não fechados do tipo, derivando do entity_id.
    expect(sql).toMatch(/UPDATE public\.alerts[\s\S]*type = 'agency_report_section_pending'[\s\S]*status <> 'closed'/)
    expect(sql).toMatch(/split_part\(entity_id, '::', 2\)/)
  })
})
