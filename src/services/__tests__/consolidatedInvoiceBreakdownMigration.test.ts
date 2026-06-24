import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('consolidated invoice breakdown migration', () => {
  it('restricts the breakdown RPC to active admins', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/090_restrict_consolidated_invoice_breakdown.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_consolidated_invoice_item_breakdown\b/)
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('public.is_active_user()')
    expect(sql).toContain('public.is_admin()')
    expect(sql).toContain('AND irl.invoice_id = p_invoice_id')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_consolidated_invoice_item_breakdown(bigint) TO authenticated')
  })
})
