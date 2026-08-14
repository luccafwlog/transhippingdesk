import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/301_portal_credentials_revoked_guard.sql', 'utf8')

describe('Guard de credenciais revogadas do Portal (301)', () => {
  it('grava o marco na própria conta quando as sessões são revogadas', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS credentials_revoked_at TIMESTAMPTZ')
    expect(sql).toContain('UPDATE public.customer_portal_accounts SET credentials_revoked_at = now() WHERE auth_user_id = p_user_id;')
  })

  it('mantém a revogação de sessões e refresh tokens da 194', () => {
    expect(sql).toContain('DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;')
    expect(sql).toContain('DELETE FROM auth.sessions WHERE user_id = p_user_id;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_revoke_sessions(uuid) TO service_role;')
  })

  // Achado D: o JWT é aceito pela assinatura, sem consulta ao banco, então
  // apagar a sessão não invalidava o token já emitido. O guard novo vive no
  // MESMO ponto onde `active` já é relido — não é um guard por RPC.
  it('recusa token emitido antes do marco, no mesmo ponto que checa active', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.current_portal_customer_id()')
    expect(sql).toContain('AND a.active = true')
    expect(sql).toContain("v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);")
    expect(sql).toContain("IF v_issued_at IS NOT NULL AND v_issued_at < v_revoked_at - interval '5 seconds' THEN")
  })

  // Relógios do emissor (GoTrue) e do banco não são o mesmo; sem folga, a
  // sessão criada pelo próprio fluxo que revogou as anteriores cairia.
  it('dá folga de segundos ao token emitido logo depois da troca', () => {
    expect(sql).toContain("interval '5 seconds'")
  })

  // Sem `iat` acessível, o guard não rejeita: a limitação fica declarada em vez
  // de virar checagem espalhada por RPC.
  it('registra a limitação de iat indisponível', () => {
    expect(sql).toMatch(/Limitação registrada: se `auth\.jwt\(\)` não trouxer `iat`/)
  })

  it('não amplia a fronteira de execução do guard', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.current_portal_customer_id() FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.current_portal_customer_id() TO authenticated;')
    expect(sql).not.toContain('current_portal_customer_id() TO anon')
  })
})
