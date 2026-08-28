import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/359_fix_extract_ncm_codes_un_number.sql'), 'utf8')

describe('extract_ncm_codes fix migration contract', () => {
  it('captura o prefixo UN como grupo próprio e descarta a ocorrência', () => {
    const sql = readMigration()

    expect(sql).toMatch(/\(\^\|\[\^A-Za-z\]\)\(UN\[\[:space:\]\]\+\)\?NCM/i)
    expect(sql).toMatch(/CONTINUE WHEN v_match\[2\] IS NOT NULL/i)
    // a guarda quebrada da 358 não pode sobreviver
    expect(sql).not.toMatch(/~\* 'N\$'/)
  })

  it('fatia a corrida em códigos de 4, 6 ou 8 dígitos em vez de truncar', () => {
    const sql = readMigration()

    expect(sql).toMatch(/regexp_matches\(v_match\[3\], '\[0-9\]\{4\}\(\?:\[.,\]\?\[0-9\]\{2\}\)\?\(\?:\[.,\]\?\[0-9\]\{2\}\)\?', 'g'\)/i)
    expect(sql).not.toMatch(/substring\(regexp_replace\([^)]*FROM 1 FOR 8\)/i)
  })

  it('corrige o backfill sem tocar em NCM decidido por gente ou pela importação', () => {
    const sql = readMigration()

    const guardas = sql.match(/NOT EXISTS \(\s*SELECT 1\s*FROM public\.audit_logs/gi) ?? []
    expect(guardas).toHaveLength(2)
    expect(sql).toMatch(/a\.entity_type = 'bl'[\s\S]{0,120}a\.field_name = 'ncm_codes'/i)
    // só reescreve quando a extração corrigida encontra algo
    expect(sql).toMatch(/AND cardinality\(public\.extract_ncm_codes\(b\.cargo_description\)\) > 0/i)
  })

  it('mantém a função fechada a PUBLIC, anon e authenticated', () => {
    expect(readMigration()).toMatch(
      /REVOKE ALL ON FUNCTION public\.extract_ncm_codes\(TEXT\) FROM PUBLIC, anon, authenticated/i,
    )
  })
})
