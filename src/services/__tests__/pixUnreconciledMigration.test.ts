import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/324_pix_unreconciled_persistence.sql'),
  'utf8',
)

describe('persistencia server-side de PIX nao conciliado', () => {
  it('preserva cada linha pela identidade do import e da linha, sem depender de TXID', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.pix_reconciliation_exceptions')
    expect(sql).toContain('import_key TEXT NOT NULL')
    expect(sql).toContain('line_number INTEGER NOT NULL')
    expect(sql).toContain('UNIQUE (import_key, line_number)')
    expect(sql).toContain('txid TEXT NOT NULL DEFAULT')
    expect(sql).toContain('normalized_txid TEXT NOT NULL DEFAULT')
  })

  it('protege tabela e RPCs, e escreve alertas pelo contrato da fundacao', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY pix_reconciliation_exceptions_select')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.upsert_pix_reconciliation_exceptions[\s\S]*SECURITY DEFINER/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_pix_reconciliation_exceptions[\s\S]*SECURITY DEFINER/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_pix_reconciliation_exception[\s\S]*SECURITY DEFINER/)
    expect(sql).toContain("'pix_unreconciled', 'pix_transaction'")
    expect(sql).toContain("public.upsert_alert_item(")
    expect(sql).toContain("public.resolve_alert_item(")
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.upsert_pix_reconciliation_exceptions/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.upsert_pix_reconciliation_exceptions[\s\S]*TO authenticated/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_pix_reconciliation_exception/)
  })

  it('resolve somente apos baixa autoritativa em settlement ou demurrage paga', () => {
    expect(sql).toContain('public.ledger_settlements')
    expect(sql).toContain('all_settlements.payment_id = first_settlement.payment_id')
    expect(sql).toContain("d.conciliated_by_extract = true")
    expect(sql).toContain("p_resolution_source NOT IN ('local', 'demurrage')")
    expect(sql).not.toContain('INSERT INTO public.invoices')
    expect(sql).not.toContain('INSERT INTO public.payments')
  })
})
