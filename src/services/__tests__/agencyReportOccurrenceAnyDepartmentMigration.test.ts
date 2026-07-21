import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/226_agency_report_occurrence_any_department.sql'),
  'utf8',
)

describe('migration 226 — ocorrência de qualquer departamento + tag de seção', () => {
  it('adiciona a coluna section, nullable, restrita às 8 seções válidas', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS section TEXT')
    expect(sql).toContain('section IS NULL OR section IN (')
    expect(sql).toContain("'vazios_embarcados', 'vazios_descarregados', 'ocorrencias', 'operacao_patio'")
  })

  it('amplia o insert de ocorrência para os 3 departamentos', () => {
    expect(sql).toContain("v_role NOT IN ('administrativo', 'operacoes', 'documentacao', 'equipamentos')")
  })

  it('valida a seção referenciada quando informada', () => {
    expect(sql).toContain('public.agency_report_section_owner(v_section) IS NULL')
  })

  it('mantém DEFAULT NULL para preservar chamadas antigas e restringe grants', () => {
    expect(sql).toContain('p_section TEXT DEFAULT NULL')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT, TEXT) TO authenticated;')
  })
})
