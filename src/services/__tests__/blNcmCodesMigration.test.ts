import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/358_bl_ncm_codes.sql'), 'utf8')

describe('B/L NCM codes migration contract', () => {
  it('cria a coluna com default vazio e valida que todo código é dígito', () => {
    const sql = readMigration()

    expect(sql).toMatch(/ALTER TABLE public\.bls\s+ADD COLUMN IF NOT EXISTS ncm_codes TEXT\[\] NOT NULL DEFAULT '\{\}'/i)
    expect(sql).toMatch(/COMMENT ON COLUMN public\.bls\.ncm_codes/i)
    expect(sql).toMatch(/CHECK \(array_to_string\(ncm_codes, ','\) ~ '\^\(\[0-9\]\{4,8\}\(,\[0-9\]\{4,8\}\)\*\)\?\$'\)/i)
    // CHECK não aceita subconsulta; a validação tem de ser expressão pura
    expect(sql).not.toMatch(/CHECK \([^)]*SELECT/i)
  })

  it('faz backfill da descrição e, na carga solta, dos itens do manifesto', () => {
    const sql = readMigration()

    expect(sql).toMatch(/UPDATE public\.bls AS b\s+SET ncm_codes = public\.extract_ncm_codes\(b\.cargo_description\)/i)
    expect(sql).toMatch(/FROM public\.bl_breakbulk_items[\s\S]{0,400}UPDATE public\.bls AS b\s+SET ncm_codes = item_codes\.codes/i)
    // backfill nunca sobrescreve NCM já cadastrado
    expect(sql).toMatch(/AND cardinality\(b\.ncm_codes\) = 0/i)
  })

  it('deixa o NCM editável na ficha via save_bl_review', () => {
    const sql = readMigration()

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.save_bl_review/i)
    expect(sql).toMatch(/ncm_codes\s+= CASE\s+WHEN p_update_payload \? 'ncm_codes'\s+THEN public\.normalize_ncm_codes/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_bl_review\(TEXT, TIMESTAMPTZ, JSONB, JSONB, UUID\) TO authenticated/i)
  })

  it('importação preenche o NCM declarado e nunca apaga o cadastro manual', () => {
    const sql = readMigration()

    // container: wrapper novo, e documento sem NCM não toca no que está gravado
    expect(sql).toMatch(/RENAME TO import_bl_freight_transactional_legacy_357/i)
    expect(sql).toMatch(/CONTINUE WHEN cardinality\(v_next\) = 0/i)
    expect(sql).toMatch(/INSERT INTO public\.audit_logs[\s\S]{0,300}'ncm_codes'/i)
    // carga solta: mesma regra dentro do UPDATE do manifesto
    expect(sql).toMatch(/ncm_codes = CASE\s+WHEN cardinality\(public\.normalize_ncm_codes\(source\.row->'ncm_codes'\)\) > 0[\s\S]{0,200}ELSE target\.ncm_codes/i)
  })

  it('normaliza e extrai com as mesmas regras do helper do front', () => {
    const sql = readMigration()

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.normalize_ncm_codes\(p_codes JSONB\)\s+RETURNS TEXT\[\]/i)
    expect(sql).toMatch(/WHERE length\(digits\) BETWEEN 4 AND 8/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.extract_ncm_codes\(p_text TEXT\)\s+RETURNS TEXT\[\]/i)
    // "UN NCM.:3556" é número ONU, não NCM
    expect(sql).toMatch(/CONTINUE WHEN btrim\(COALESCE\(v_match\[1\], ''\)\) ~\* 'N\$'/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.normalize_ncm_codes\(JSONB\) FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.extract_ncm_codes\(TEXT\) FROM PUBLIC, anon, authenticated/i)
  })
})
