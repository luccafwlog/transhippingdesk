import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260618163840_guard_invoiceable_ready_state.sql'),
  'utf8',
)

describe('invoiceable ready state migration', () => {
  it('requires at least one positive BRL charge before marking a BL ready', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing')
    expect(sql).toContain('v_invoiceable_count')
    expect(sql).toContain('COALESCE(total_value_brl, 0) > 0')
    expect(sql).toContain("status IN ('calculated', 'reviewed', 'ready_for_billing')")
    expect(sql).toContain('B/L sem linhas BRL faturaveis')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.promote_calculated_bl_ready_for_billing')
  })
})
