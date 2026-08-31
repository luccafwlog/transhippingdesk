import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/365_port_alias_qindgao.sql'),
  'utf-8',
)

describe('migration 365 — alias de porto QINDGAO para CNTAO', () => {
  it('define a funcao SQL normalize_port_code com suporte a QINDGAO', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value TEXT)')
    expect(sql).toContain("'QINDGAO'")
    expect(sql).toContain("'QINGDAO'")
    expect(sql).toContain("'CNTAO'")
    expect(sql).toContain("'CNQDG'")
  })

  it('restringe privilegios de execucao', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.normalize_port_code(TEXT) FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.normalize_port_code(TEXT) TO authenticated, service_role;')
  })
})
