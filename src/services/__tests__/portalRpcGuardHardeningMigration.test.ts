import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/192_portal_rpc_guard_hardening.sql', 'utf8')

describe('Portal RPC guard hardening (192)', () => {
  it('revoga o EXECUTE herdado do PUBLIC nas RPCs de provisionamento', () => {
    for (const fn of [
      'portal_set_exception(BIGINT,TEXT,TEXT)',
      'portal_return_to_analysis(BIGINT,TEXT,TEXT,TEXT)',
      'portal_provisioning_backfill(TEXT)',
      'portal_provisioning_preflight()',
      'portal_admin_change_cnpj(BIGINT,TEXT,TEXT)',
      'portal_cancel_invite(BIGINT,TEXT,TEXT)',
      'portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT)',
    ]) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC;`)
    }
  })

  it('usa guardas NULL-safe para negar role indefinido', () => {
    // As antigas comparações `v_role <> ...` / `v_role NOT IN (...)` retornavam
    // NULL para role indefinido (anon ou cliente do Portal), falhando em aberto.
    expect(sql).toContain("v_role IS DISTINCT FROM 'administrativo'")
    expect(sql).toContain("v_role IS NULL OR v_role NOT IN ('administrativo','documentacao')")
    // Não pode restar nenhuma guarda fail-open na forma antiga.
    expect(sql).not.toMatch(/IF v_role <> 'administrativo' THEN/)
    expect(sql).not.toMatch(/IF v_role NOT IN \('administrativo','documentacao'\) THEN/)
  })

  it('protege o pré-voo com guarda de administrador/serviço', () => {
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role' AND public._portal_actor_role() IS DISTINCT FROM 'administrativo'")
  })
})
