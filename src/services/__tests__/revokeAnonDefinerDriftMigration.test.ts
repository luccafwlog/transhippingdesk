import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('revoke anon SECURITY DEFINER drift migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260624110000_revoke_anon_definer_drift.sql'),
    'utf8',
  )

  it('revokes EXECUTE from PUBLIC and anon across all public SECURITY DEFINER functions', () => {
    expect(sql).toMatch(/FROM pg_proc p/)
    expect(sql).toContain('p.prosecdef')
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon")
  })

  it('also revokes EXECUTE from authenticated for trigger-returning functions', () => {
    expect(sql).toContain("prorettype = 'trigger'::regtype")
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION %s FROM authenticated")
  })

  it('carves out and re-asserts the ADR 0013 anon exception (portal_resolve_login)', () => {
    expect(sql).toContain("p.proname <> 'portal_resolve_login'")
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_resolve_login(text) TO anon')
  })
})
