import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/222_agency_report_operacao_patio_section.sql'),
  'utf8',
)

describe('migration 222 — oitava secao operacao_patio do ADR', () => {
  it('estende o CHECK de secao para as 8 secoes', () => {
    expect(sql).toMatch(/ADD CONSTRAINT agency_departure_report_signoffs_section_check CHECK \(section IN \(/)
    expect(sql).toContain("'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',")
    expect(sql).toContain("'vazios_embarcados', 'vazios_descarregados', 'ocorrencias', 'operacao_patio'")
  })

  it('atribui operacao_patio a Equipamentos no dono da secao', () => {
    expect(sql).toMatch(/WHEN 'operacao_patio' THEN 'equipamentos'/)
  })
})
