import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/300_portal_assisted_email_change_invalidates_invites.sql', 'utf8')

describe('Troca assistida não deixa link self-service solto (300)', () => {
  // Achado C: a 195 zerava pending_recovery_email mas deixava o convite
  // `confirmacao_email` vivo por até 48h; o link caía depois numa confirmação
  // que não tinha o que aplicar.
  it('invalida os convites de confirmação de email pendentes da conta', () => {
    expect(sql).toContain("UPDATE public.portal_invites SET status='invalidado_por_reenvio' WHERE account_id=v_account.id AND purpose='confirmacao_email' AND status='pendente';")
  })

  it('preserva as guardas, a revogação de sessões e a auditoria da 195', () => {
    expect(sql).toContain("v_role IS NULL OR v_role NOT IN ('administrativo','documentacao')")
    expect(sql).toContain("IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória.'")
    expect(sql).toContain('IF v_account.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(v_account.auth_user_id); END IF;')
    expect(sql).toContain('PERFORM public._portal_log_event(')
  })

  it('mantém a recusa de endereço suprimido no caminho assistido', () => {
    expect(sql).toContain('SELECT 1 FROM public.portal_suppressed_emails WHERE email=lower(p_new_email)')
  })

  it('mantém a fronteira de execução', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) TO authenticated;')
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.portal_assisted_email_change(BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;')
  })
})
