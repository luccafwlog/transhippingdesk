import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/369_charge_lines_expoem_tabela_de_cobranca.sql'),
  'utf8',
)

describe('migration 369 — linhas de calculo expoem a tabela de cobranca', () => {
  // RETURNS TABLE muda de forma: CREATE OR REPLACE nao altera tipo de retorno.
  it('recria a funcao, porque o retorno muda de forma', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.list_bl_local_charge_lines(TEXT);')
    expect(sql).toContain('CREATE FUNCTION public.list_bl_local_charge_lines(p_bl_id TEXT)')
  })

  it('acrescenta as tres colunas da conferencia', () => {
    expect(sql).toContain('charge_table_name TEXT')
    expect(sql).toContain('charge_table_pod TEXT')
    expect(sql).toContain('application_basis TEXT')
    expect(sql).toContain('LEFT JOIN public.charge_tables AS ct ON ct.id = cc.charge_table_id')
  })

  // A tabela vem da linha (cc.charge_table_id), nao do item: e a tabela vigente
  // no momento do calculo que o operador confere.
  it('resolve a tabela pela linha de calculo, nao pelo item', () => {
    expect(sql).toContain('ct.name AS charge_table_name')
    expect(sql).toContain('ct.pod AS charge_table_pod')
    expect(sql).not.toContain('cti.charge_table_id')
  })

  // A 212 ja trocara esta RPC de leitura para is_active_read_user() (exclui
  // Equipamentos de is_active_user(), nao de leitura). O DROP+CREATE nao pode
  // reabrir essa lacuna reaplicando o corpo antigo da 151.
  it('preserva o gate de usuario ativo de leitura (212) e a ordenacao da 151', () => {
    expect(sql).toContain('IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN')
    expect(sql).not.toContain('NOT public.is_active_user()')
    expect(sql).toContain("RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501'")
    expect(sql).toContain('ORDER BY cc.source DESC, cc.id ASC')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
  })

  it('reaplica os grants originais apos recriar a funcao', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.list_bl_local_charge_lines(TEXT) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.list_bl_local_charge_lines(TEXT) TO authenticated;')
  })

  it('nao remove nenhuma coluna que a 151 ja devolvia', () => {
    const previous = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/151_guard_definer_rpcs_active_user.sql'),
      'utf8',
    )
    const start = previous.indexOf('CREATE OR REPLACE FUNCTION public.list_bl_local_charge_lines(p_bl_id TEXT)')
    const columns = previous
      .slice(previous.indexOf('RETURNS TABLE (', start), previous.indexOf(')\nLANGUAGE plpgsql', start))
      .split('\n')
      .map((row) => row.trim().split(' ')[0])
      .filter((name) => /^[a-z_]+$/.test(name))

    expect(columns.length).toBeGreaterThan(10)
    for (const column of columns) {
      expect(sql, `coluna ausente no retorno novo: ${column}`).toContain(`  ${column} `)
    }
  })
})
