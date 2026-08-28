import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/360_fix_bl_reimport_customer_relink.sql'), 'utf8')

describe('B/L re-import relink fixes migration contract', () => {
  it('refuses the relink when the ledger receivable already has a settlement', () => {
    const sql = readMigration()

    expect(sql).toMatch(/FROM public\.bl_receivables\s+WHERE bl_id = p_bl_id\s+AND status <> 'void'\s+AND COALESCE\(settled_amount_brl, 0\) > 0/i)
    expect(sql).toMatch(/v_settled_receivables > 0[\s\S]{0,200}baixa registrada/i)
  })

  it('moves only the live receivables, leaving void history with the previous customer', () => {
    const sql = readMigration()

    expect(sql).toMatch(/UPDATE public\.bl_receivables\s+SET customer_id = p_customer_id[\s\S]{0,200}AND status <> 'void'/i)
  })

  it('writes the consignee document even when the CNPJ resolves to the customer already linked', () => {
    const sql = readMigration()

    expect(sql).toMatch(/v_relink->>'applied'[\s\S]{0,120}v_relink->>'unchanged'[\s\S]{0,300}manifest_customer_cnpj_cpf = CASE/i)
  })

  it('re-syncs the reconciliation queue after the document columns are written', () => {
    const sql = readMigration()

    const documentUpdate = sql.indexOf('manifest_customer_cnpj_cpf = CASE')
    const queueSyncAfterDocument = sql.indexOf('PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl_id)')
    expect(documentUpdate).toBeGreaterThan(-1)
    expect(queueSyncAfterDocument).toBeGreaterThan(documentUpdate)
  })

  it('keeps the wrapper contract of migration 357: legacy call, route override, relinks in the result', () => {
    const sql = readMigration()

    expect(sql).toMatch(/v_result := public\.import_bl_freight_transactional_legacy_322\(p_bls, p_changed_by\)/i)
    expect(sql).toMatch(/IF v_billed AND COALESCE\(\(v_item->>'override_billing'\)::BOOLEAN, false\) THEN/i)
    expect(sql).toMatch(/jsonb_build_object\('customer_relinks', v_relinks\)/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.relink_bl_customer\(TEXT, BIGINT, UUID, TEXT\)\s*\n?\s*FROM PUBLIC, anon, authenticated/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.import_bl_freight_transactional\(JSONB, UUID\) TO authenticated/i)
    // o valor devido continua intocado: nenhuma coluna de dinheiro e reescrita
    expect(sql).not.toMatch(/SET[^;]*\b(total_brl|balance_brl|total_paid_brl|total_usd|original_amount_brl)\s*=/i)
  })
})
