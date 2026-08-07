import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('freeze consolidated invoice items migration (261)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/261_freeze_consolidated_invoice_items.sql'),
    'utf8',
  )

  it('freezes invoice_items inside create_local_consolidated_invoice_core at consolidation time', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_local_consolidated_invoice_core\b/)
    expect(sql).toContain('INSERT INTO public.invoice_items')
    expect(sql).toContain("jsonb_build_object('reconciled', true)")
  })

  it('backfills invoice_items only for consolidadas that do not have it yet', () => {
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = l.invoice_id)')
    expect(sql).toContain("'backfilled', true")
  })

  it('decouples portal_invoice_details BL summary from the items-empty check', () => {
    const bodyStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.portal_invoice_details')
    expect(bodyStart).toBeGreaterThan(-1)
    const body = sql.slice(bodyStart)
    // v_bls is rebuilt from invoice_receivable_links under its own guard...
    expect(body).toMatch(/IF v_bls = '\[\]'::JSONB THEN/)
    // ...independent of the v_items guard, so a frozen consolidada still shows its B/L list.
    const blsGuardIndex = body.indexOf("IF v_bls = '[]'::JSONB THEN")
    const itemsGuardIndex = body.indexOf("IF v_items = '[]'::JSONB THEN")
    expect(blsGuardIndex).toBeGreaterThan(-1)
    expect(itemsGuardIndex).toBeGreaterThan(blsGuardIndex)
  })

  it('grants portal execute on the redefined function', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.portal_invoice_details(bigint) TO authenticated, anon')
  })
})
