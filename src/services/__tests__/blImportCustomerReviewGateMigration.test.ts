import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/163_bl_import_customer_review_gate.sql'), 'utf8')

describe('BL import customer review-gate migration contract', () => {
  it('persists customer reconciliation fields and adopts matched customers for existing unlinked BLs', () => {
    const sql = readMigration()

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.import_bl_freight_transactional/i)
    expect(sql).toMatch(/customer_reconciliation_status TEXT/i)
    expect(sql).toMatch(/customer_reconciliation_notes TEXT/i)
    expect(sql).toMatch(/billing_hold_reason TEXT/i)
    expect(sql).toMatch(/customer_id = CASE[\s\S]+bls\.customer_id IS NULL[\s\S]+EXCLUDED\.customer_id IS NOT NULL[\s\S]+THEN EXCLUDED\.customer_id/i)
    expect(sql).toMatch(/customer_reconciliation_status = CASE[\s\S]+EXCLUDED\.customer_reconciliation_status/i)
    expect(sql).toMatch(/bls\.customer_id = EXCLUDED\.customer_id[\s\S]+EXCLUDED\.customer_reconciliation_status IN \('matched_document', 'matched_name'\)/i)
  })

  it('runs the review gate and queues name-only matches instead of treating them as billable', () => {
    const sql = readMigration()
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.import_bl_freight_transactional'))

    expect(body).toMatch(/PERFORM public\.apply_bl_review_gate_after_import\(v_imported_bl_ids, p_changed_by\)/i)
    expect(body).toMatch(/review_status = 'pending_review'[\s\S]+customer_reconciliation_status = 'matched_name'/i)
    expect(body).toMatch(/PERFORM public\.sync_customer_reconciliation_queue_for_bl\(v_bl_id\)/i)
    expect(body).not.toMatch(/run_billing|calculate_bl_local_charges|INSERT INTO public\.charge_calculations|INSERT INTO public\.invoice_bls/i)
  })

  it('backfills already-imported BLs whose document resolves to a customer', () => {
    const sql = readMigration()

    expect(sql).toMatch(/WITH matched AS \([\s\S]+JOIN public\.customers AS c[\s\S]+normalize_document_text\(c\.cnpj_cpf\)[\s\S]+normalize_document_text\(b\.manifest_customer_cnpj_cpf\)/i)
    expect(sql).toMatch(/UPDATE public\.bls AS b[\s\S]+customer_id = matched\.customer_id[\s\S]+customer_reconciliation_status = 'matched_document'/i)
    expect(sql).toMatch(/COALESCE\(b\.customer_reconciliation_status, 'missing_customer'\) IN \('missing_customer', 'matched_name'\)/i)
    expect(sql).toMatch(/PERFORM public\.sync_customer_reconciliation_queue_for_bl\(v_bl_id\)/i)
  })
})
