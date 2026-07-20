import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/209_customer_receivables_read_rpc.sql', 'utf8')

describe('209_customer_receivables_read_rpc', () => {
  it('expõe get_customer_receivables como leitura protegida com erro explícito para usuário inativo', () => {
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.get_customer_receivables[\s\S]*?\$function\$;/i)?.[0] ?? ''
    expect(body).toMatch(/SECURITY DEFINER/i)
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\)/i)
    expect(body).toMatch(/RAISE EXCEPTION 'Usuario sem permissao ativa\.' USING ERRCODE = '42501'/i)
    expect(body).toMatch(/FROM public\.bl_receivables r\s*\n\s*WHERE r\.customer_id = p_customer_id/i)
  })

  it('não altera a policy de SELECT existente da tabela financeira', () => {
    expect(sql).not.toMatch(/DROP POLICY/i)
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })

  it('restringe EXECUTE ao authenticated', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_customer_receivables\(BIGINT\) FROM PUBLIC, anon/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_customer_receivables\(BIGINT\) TO authenticated/i)
  })
})
