import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('portal create consolidation jsonb fix migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/121_fix_portal_create_consolidation_jsonb.sql'),
    'utf8',
  )

  it('redefines portal_create_consolidation', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_create_consolidation\(p_receivable_ids BIGINT\[\]\)/)
    expect(sql).toContain('SECURITY DEFINER')
  })

  it('captures the jsonb result and extracts invoice_id from it', () => {
    // The core function RETURNS jsonb; it must be stored in a jsonb variable,
    // never assigned straight into a bigint via SELECT ... INTO.
    expect(sql).toContain('v_result JSONB')
    expect(sql).toContain('v_result := public.create_local_consolidated_invoice_core(')
    expect(sql).toContain("v_invoice_id := (v_result->>'invoice_id')::BIGINT")
    expect(sql).not.toMatch(/create_local_consolidated_invoice_core\([^)]*\)\s*INTO\s+v_invoice_id/s)
  })

  it('keeps rate limiting and returns the full result object', () => {
    expect(sql).toContain("public.check_portal_rate_limit('create_consolidation', 3, 10)")
    expect(sql).toContain('RETURN v_result;')
  })
})
