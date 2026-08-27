import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/349_restore_portal_provisioning_console_fields.sql'), 'utf8')

describe('migration 349 do read model do provisionamento do Portal', () => {
  it('restaura os sinais do email de recuperação depois das reconstruções posteriores da RPC', () => {
    expect(sql).toContain("pg_get_functiondef('public.portal_list_provisioning_console(bigint)'::regprocedure)")
    expect(sql).toContain("''recovery_email_status'', CASE WHEN v_full_access THEN a.recovery_email_status ELSE NULL END")
    expect(sql).toContain("''recovery_email_suppressed'', CASE WHEN v_full_access AND a.recovery_email IS NOT NULL THEN EXISTS")
    expect(sql).toContain('portal_suppressed_emails s WHERE s.email = lower(a.recovery_email)')
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.portal_list_provisioning_console(BIGINT) FROM PUBLIC, anon;')
  })
})
