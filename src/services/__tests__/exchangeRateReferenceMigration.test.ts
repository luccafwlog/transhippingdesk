import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../../supabase/migrations/200_exchange_rate_reference.sql', import.meta.url), 'utf8')

describe('migration 200 exchange rate reference', () => {
  it('persiste uma referência singleton por upsert', () => {
    expect(sql).toMatch(/id SMALLINT PRIMARY KEY DEFAULT 1 CHECK \(id = 1\)/)
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/)
  })

  it('protege a escrita e não concede execução a anon', () => {
    expect(sql).toContain("public._portal_actor_role() IS NULL")
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.save_exchange_rate_reference\([\s\S]*?FROM PUBLIC, anon/)
  })

  it('expõe ao Portal somente ROE e data de atualização após validar a sessão', () => {
    expect(sql).toMatch(/portal_get_current_roe\(\)[\s\S]*?RETURNS TABLE \(roe NUMERIC, updated_at TIMESTAMPTZ\)/)
    expect(sql).toContain('PERFORM public.current_portal_customer_id()')
    const portalBody = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.portal_get_current_roe'))
    expect(portalBody).not.toMatch(/RETURNS TABLE[^;]*ptax/i)
  })
})
