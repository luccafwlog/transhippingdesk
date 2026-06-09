import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('remaining permissive RLS hardening migration', () => {
  it('replaces permissive policies on BAPLIE and voyage export tables', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260609134000_harden_remaining_permissive_rls.sql'),
      'utf8',
    )

    expect(sql).toContain('baplie_reconciliation_resolutions')
    expect(sql).toContain('baplie_containers')
    expect(sql).toContain('voyage_export_schedules')
    expect(sql).toContain('DROP POLICY IF EXISTS')
    expect(sql).toContain('public.is_active_user()')
    expect(sql).toContain('public.is_admin()')
  })
})
