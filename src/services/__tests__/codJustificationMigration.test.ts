import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/310_cod_justification.sql'),
  'utf8',
)

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

describe('contrato da confirmação de COD', () => {
  it('remove as assinaturas antigas antes de publicar as novas', () => {
    expect(migration.indexOf('DROP FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID);')).toBeGreaterThanOrEqual(0)
    expect(migration.indexOf('DROP FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID);')).toBeGreaterThanOrEqual(0)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_cod\(\s*p_bl_id TEXT,\s*p_omission_id BIGINT,\s*p_justification TEXT,\s*p_changed_by UUID/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_transshipment\([\s\S]*p_justification TEXT,\s*p_changed_by UUID/i)
  })

  it('exige justificativa no COD, usa o texto auditado e mantém o ator autenticado', () => {
    expect(migration).toMatch(/v_justification TEXT := NULLIF\(btrim\(COALESCE\(p_justification, ''\)\), ''\)/i)
    expect(migration).toMatch(/Marcar COD exige justificativa/i)
    expect(migration).toMatch(/p_changed_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(migration).toMatch(/'COD apos omissao da escala de ' \|\| v_omitted \|\| ': ' \|\| v_justification/i)
    expect(migration).toMatch(/Reverter COD exige justificativa/i)
  })

  it('atualiza o POD antes da seam financeira e notifica a correção de COD', () => {
    const codBody = migration.match(/CREATE OR REPLACE FUNCTION public\.set_bl_cod[\s\S]*?\$function\$;/i)?.[0] ?? ''
    const restoreBody = migration.match(/CREATE OR REPLACE FUNCTION public\.set_bl_transshipment[\s\S]*?\$function\$;/i)?.[0] ?? ''
    expect(codBody.indexOf('UPDATE public.bls SET pod = v_discharge')).toBeLessThan(codBody.indexOf('PERFORM public.apply_cod_financial_effect'))
    expect(restoreBody.indexOf('UPDATE public.bls SET pod = v_original_pod')).toBeLessThan(restoreBody.indexOf('PERFORM public.apply_cod_financial_effect'))
    expect(restoreBody).toMatch(/IF v_was = 'cod' THEN[\s\S]*INSERT INTO public\.portal_notifications/i)
    expect(restoreBody).toMatch(/Correção de destino \(COD\)/i)
    expect(restoreBody).toMatch(/onward_vessel_name = NULLIF\(btrim\(COALESCE\(p_onward_vessel_name, ''\)\), ''\)/i)
  })

  it('concede execução somente à sessão autenticada nas assinaturas novas', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.set_bl_cod\(TEXT, BIGINT, TEXT, UUID\) FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_bl_cod\(TEXT, BIGINT, TEXT, UUID\) TO authenticated/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.set_bl_transshipment\(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID\) FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_bl_transshipment\(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID\) TO authenticated/i)
  })
})

describeLocal('assinaturas de COD no catálogo local', () => {
  it('remove o caminho antigo e publica somente a assinatura com justificativa', () => {
    expect(psql("SELECT to_regprocedure('public.set_bl_cod(text,bigint,uuid)') IS NULL AND to_regprocedure('public.set_bl_cod(text,bigint,text,uuid)') IS NOT NULL;")).toBe('t')
    expect(psql("SELECT to_regprocedure('public.set_bl_transshipment(text,bigint,text,text,text,timestamptz,timestamptz,uuid)') IS NULL AND to_regprocedure('public.set_bl_transshipment(text,bigint,text,text,text,timestamptz,timestamptz,text,uuid)') IS NOT NULL;")).toBe('t')
  })

  it('mantém EXECUTE apenas para authenticated', () => {
    expect(psql("SELECT has_function_privilege('authenticated', 'public.set_bl_cod(text,bigint,text,uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.set_bl_cod(text,bigint,text,uuid)', 'EXECUTE');")).toBe('t')
    expect(psql("SELECT has_function_privilege('authenticated', 'public.set_bl_transshipment(text,bigint,text,text,text,timestamptz,timestamptz,text,uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.set_bl_transshipment(text,bigint,text,text,text,timestamptz,timestamptz,text,uuid)', 'EXECUTE');")).toBe('t')
  })
})
