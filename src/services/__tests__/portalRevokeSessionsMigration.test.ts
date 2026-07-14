import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/194_portal_revoke_sessions.sql', 'utf8')

describe('Portal revoke sessions (194)', () => {
  it('apaga sessões e refresh tokens do usuário', () => {
    expect(sql).toContain('DELETE FROM auth.sessions WHERE user_id = p_user_id')
    expect(sql).toContain('DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text')
  })

  it('restringe a execução a service_role', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.portal_revoke_sessions(uuid) FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_revoke_sessions(uuid) TO service_role')
  })
})
