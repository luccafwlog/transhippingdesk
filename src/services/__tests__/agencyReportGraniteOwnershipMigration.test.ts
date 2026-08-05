import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENCY_REPORT_SECTION_LABELS, AGENCY_REPORT_SECTIONS } from '../agencyDepartureReport'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/258_agency_report_granite_equipamentos.sql'),
  'utf8',
)

describe('migration 258 — Granito pertence a Equipamentos no ADR', () => {
  it('mantém o contrato TypeScript e as funções SQL de dono e rótulo alinhados', () => {
    expect(AGENCY_REPORT_SECTIONS.carga_carregada).toBe('equipamentos')
    expect(AGENCY_REPORT_SECTION_LABELS.carga_carregada).toBe('Granito')

    const owner = sql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_owner[\s\S]*?\$\$;/)?.[0] ?? ''
    const label = sql.match(/CREATE OR REPLACE FUNCTION public\.agency_report_section_label[\s\S]*?\$\$;/)?.[0] ?? ''

    expect(owner).toContain("WHEN 'carga_carregada' THEN 'equipamentos'")
    expect(label).toContain("WHEN 'carga_carregada' THEN 'Granito'")
  })
})
