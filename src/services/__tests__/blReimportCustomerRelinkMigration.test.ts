import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/357_bl_reimport_customer_relink.sql'), 'utf8')

describe('B/L re-import customer relink migration contract', () => {
  it('moves the B/L and its open invoices to the new consignee without touching the amount', () => {
    const sql = readMigration()

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.relink_bl_customer\(\s*p_bl_id TEXT,\s*p_customer_id BIGINT,\s*p_changed_by UUID/i)
    expect(sql).toMatch(/UPDATE public\.bls[\s\S]{0,400}customer_id = p_customer_id/i)
    expect(sql).toMatch(/UPDATE public\.invoices SET customer_id = p_customer_id/i)
    expect(sql).toMatch(/UPDATE public\.demurrage_invoices SET customer_id = p_customer_id/i)
    expect(sql).toMatch(/UPDATE public\.bl_receivables\s+SET customer_id = p_customer_id/i)
    // o valor devido nao muda: nenhuma coluna de dinheiro e reescrita
    expect(sql).not.toMatch(/SET[^;]*\b(total_brl|balance_brl|total_paid_brl|total_usd|original_amount_brl)\s*=/i)
  })

  it('refuses to move an invoice that is consolidated, paid, or has no registered target customer', () => {
    const sql = readMigration()

    expect(sql).toMatch(/bl_count > 1[\s\S]{0,200}consolidada com outros B\/Ls/i)
    expect(sql).toMatch(/total_paid_brl, 0\) > 0 OR v_invoice\.status = 'paid'[\s\S]{0,200}pagamento registrado/i)
    expect(sql).toMatch(/p_customer_id IS NULL AND v_has_financials[\s\S]{0,300}nao esta cadastrado como cliente/i)
    expect(sql).toMatch(/IF cardinality\(v_blockers\) > 0 THEN[\s\S]{0,200}'applied', false/i)
  })

  it('audits the relink and re-syncs the reconciliation queue and review gate', () => {
    const sql = readMigration()

    expect(sql).toMatch(/INSERT INTO public\.audit_logs[\s\S]{0,300}VALUES \('bl', p_bl_id, 'customer_id'/i)
    expect(sql).toMatch(/INSERT INTO public\.audit_logs[\s\S]{0,300}VALUES \('invoice', v_invoice\.id::TEXT, 'customer_id'/i)
    expect(sql).toMatch(/PERFORM public\.sync_customer_reconciliation_queue_for_bl\(p_bl_id\)/i)
    expect(sql).toMatch(/PERFORM public\.apply_bl_review_gate_after_import\(/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.relink_bl_customer\(TEXT, BIGINT, UUID, TEXT\)\s*\n?\s*FROM PUBLIC, anon, authenticated/i)
  })

  it('wraps the import so route and voyage stop being dropped silently on a billed B/L', () => {
    const sql = readMigration()

    expect(sql).toMatch(/ALTER FUNCTION public\.import_bl_freight_transactional\(JSONB, UUID\)\s*\n?\s*RENAME TO import_bl_freight_transactional_legacy_322/i)
    expect(sql).toMatch(/v_result := public\.import_bl_freight_transactional_legacy_322\(p_bls, p_changed_by\)/i)
    expect(sql).toMatch(/IF v_billed AND COALESCE\(\(v_item->>'override_billing'\)::BOOLEAN, false\) THEN/i)
    expect(sql).toMatch(/voyage_id\s+= CASE WHEN v_item \? 'voyage_id'/i)
    expect(sql).toMatch(/pod\s+= CASE WHEN v_item \? 'pod'/i)
    expect(sql).toMatch(/IF COALESCE\(\(v_item->>'relink_customer'\)::BOOLEAN, false\) THEN[\s\S]{0,300}public\.relink_bl_customer\(/i)
    // aceitar a troca autoriza o documento junto; senão o B/L fica com cliente novo e CNPJ antigo
    expect(sql).toMatch(/v_relink->>'applied'[\s\S]{0,400}manifest_customer_cnpj_cpf = CASE[\s\S]{0,200}normalize_document_text/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.import_bl_freight_transactional\(JSONB, UUID\) FROM PUBLIC, anon/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.import_bl_freight_transactional\(JSONB, UUID\) TO authenticated/i)
  })
})
