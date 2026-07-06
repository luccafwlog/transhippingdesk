import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/168_overdue_invoice_alerts_ptbr_entity.sql'),
  'utf8',
)

describe('overdue invoice alerts migration', () => {
  it('keeps detect_overdue_invoices behind the active-user definer gate', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.detect_overdue_invoices()')
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('SET search_path = public, pg_temp')
    expect(sql).toContain('IF auth.uid() IS NULL OR NOT public.is_active_user() THEN')
    expect(sql).toContain("RAISE EXCEPTION 'Usuario sem permissao ativa' USING ERRCODE = '42501'")
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.detect_overdue_invoices() FROM PUBLIC, anon;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.detect_overdue_invoices() TO authenticated;')
  })

  it('stores invoice alerts by invoice number with a legacy id fallback and dedupe guard', () => {
    expect(sql).toContain('v_invoice_entity_id := COALESCE(v_row.invoice_number, v_row.id::text);')
    expect(sql).toContain('AND entity_id IN (v_invoice_entity_id, v_row.id::text)')
    expect(sql).toContain('SET entity_id = i.invoice_number')
  })

  it('uses Portuguese alert copy and Brazilian currency formatting without US to_char mask', () => {
    expect(sql).toContain('Fatura %s venceu em %s')
    expect(sql).toContain("',' ||")
    expect(sql).toContain('WHILE length(v_balance_integer) > 3 LOOP')
    expect(sql).toContain("v_balance_grouped := '.' || right(v_balance_integer, 3) || v_balance_grouped;")
    expect(sql).not.toContain('Invoice %s venceu')
    expect(sql).not.toContain("FM999,999,990.00")
  })
})
