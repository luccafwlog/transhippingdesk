import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('portal invoice consolidated breakdown migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/120_portal_invoice_consolidated_breakdown.sql'),
    'utf8',
  )

  it('redefines portal_invoice_details', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_invoice_details\(p_invoice_id bigint\)/)
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('v_customer_id bigint := public.current_portal_customer_id()')
    expect(sql).toContain('i.customer_id = v_customer_id')
  })

  it('reconstructs the per-BL charge breakdown from charge_calculations', () => {
    expect(sql).toContain('FROM public.charge_calculations AS cc')
    expect(sql).toContain('LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id')
    // Same status gate the internal breakdown uses.
    expect(sql).toContain("COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')")
  })

  it('only uses detailed lines when they reconcile with the BL ledger subtotal', () => {
    expect(sql).toContain('ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01')
    // Fallback aggregated line per BL when the breakdown does not reconcile.
    expect(sql).toContain("'BL ' || links.bl_id || ' - Taxas locais'")
  })
})
