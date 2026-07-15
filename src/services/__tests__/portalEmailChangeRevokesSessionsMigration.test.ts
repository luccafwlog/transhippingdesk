import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/195_portal_email_change_revokes_sessions.sql', 'utf8')

describe('Troca de email de recuperação encerra sessões (195)', () => {
  it('chama portal_revoke_sessions quando há auth_user_id vinculado', () => {
    expect(sql).toContain('IF v_account.auth_user_id IS NOT NULL THEN PERFORM public.portal_revoke_sessions(v_account.auth_user_id); END IF;')
  })

  it('mantém as guardas de permissão e auditoria da troca assistida', () => {
    expect(sql).toContain("v_role IS NULL OR v_role NOT IN ('administrativo','documentacao')")
    expect(sql).toContain('PERFORM public._portal_log_event(')
  })
})
