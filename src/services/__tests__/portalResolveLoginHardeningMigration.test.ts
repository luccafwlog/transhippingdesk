import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('portal resolve login hardening migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/122_harden_portal_resolve_login.sql'),
    'utf8',
  )

  it('stores anonymous resolution attempts by hash instead of raw login', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.portal_login_resolution_attempts/)
    expect(sql).toContain('login_hash TEXT NOT NULL')
    expect(sql).toContain("extensions.digest(v_lookup_key, 'sha256')")
    expect(sql).not.toContain('p_login TEXT NOT NULL')
  })

  it('rate limits anonymous resolution before account lookup', () => {
    const rateLimitPosition = sql.indexOf('portal_login_resolution_attempts')
    const lookupPosition = sql.indexOf('FROM public.customer_portal_accounts AS a')

    expect(rateLimitPosition).toBeGreaterThan(-1)
    expect(lookupPosition).toBeGreaterThan(-1)
    expect(rateLimitPosition).toBeLessThan(lookupPosition)
    expect(sql).toContain("USING ERRCODE = 'P0429'")
  })

  it('keeps anon execute while using generic failure messages', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_resolve_login(TEXT) TO anon')
    expect(sql).toContain('Credenciais invalidas para o portal do cliente.')
    expect(sql).not.toContain('Nenhuma conta de portal encontrada')
  })

  it('protects the attempt table with RLS and no public grants', () => {
    expect(sql).toContain('ALTER TABLE public.portal_login_resolution_attempts ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON public.portal_login_resolution_attempts FROM PUBLIC, anon, authenticated')
  })
})
