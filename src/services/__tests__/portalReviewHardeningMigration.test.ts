import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const rpcs = readFileSync('supabase/migrations/191_portal_review_hardening.sql', 'utf8')
const config = readFileSync('supabase/config.toml', 'utf8')

describe('Portal review hardening', () => {
  it('não expõe helpers de auditoria nem aceita sistema do caller', () => {
    expect(rpcs).toContain('REVOKE ALL ON FUNCTION public._portal_actor_role() FROM PUBLIC, anon, authenticated;')
    expect(rpcs).toContain('REVOKE ALL ON FUNCTION public._portal_log_event')
    expect(rpcs).toContain("CASE WHEN auth.role() = 'service_role' THEN 'sistema'")
    expect(rpcs).toContain("auth.role() <> 'service_role'")
  })

  it('configura autenticação própria para webhook e digest', () => {
    expect(config).toContain('[functions.portal-email-webhook]\nverify_jwt = false')
    expect(config).toContain('[functions.portal-daily-digest]\nverify_jwt = false')
  })
})
