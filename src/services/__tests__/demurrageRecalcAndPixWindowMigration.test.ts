import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Contrato SQL das ADRs 0014/0015: recálculo diário de Demurrage (155) e
// conciliação PIX por txid + janela das duas PTAX (158). Detecta drift no SQL
// versionado; não prova aplicação remota.

describe('demurrage recalculate RPCs migration (155)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/155_demurrage_recalculate_rpcs.sql'),
    'utf8',
  )

  it('defines the service_role-only core with the expected signature', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices(NUMERIC, DATE, TEXT) FROM PUBLIC, anon, authenticated',
    )
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices(NUMERIC, DATE, TEXT) TO service_role',
    )
  })

  it('guards the manual wrapper with auth.uid() + is_active_user()', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices_manual(p_ptax NUMERIC)',
    )
    expect(sql).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_user\(\)/)
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.recalculate_demurrage_invoices_manual(NUMERIC) TO authenticated',
    )
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.recalculate_demurrage_invoices_manual(NUMERIC) FROM PUBLIC, anon',
    )
  })
})

describe('demurrage PIX window conciliation migration (158)', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/158_demurrage_pix_window_conciliation.sql'),
    'utf8',
  )

  it('window helper returns the two most recent history entries and blocks anon', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_demurrage_recent_values(p_invoice_id BIGINT, p_date DATE)',
    )
    expect(sql).toContain('LIMIT 2')
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_demurrage_recent_values(BIGINT, DATE) FROM PUBLIC, anon',
    )
  })

  it('confirm_demurrage_pix_matches freezes the paid value and ends recalculation', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_demurrage_pix_matches(p_matches jsonb)',
    )
    expect(sql).toMatch(/paid_at = r\.paid_at/)
    expect(sql).toMatch(/pix_txid = r\.pix_txid/)
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.confirm_demurrage_pix_matches(jsonb) FROM PUBLIC, anon',
    )
  })

  it('unified wrapper anchors on the statement payment date and aborts without it', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_unified_pix_matches(p_matches JSONB)',
    )
    expect(sql).toContain('Data do extrato nao parseada')
    expect(sql).toContain('public.reconcile_invoice_payment_by_txid')
  })
})
