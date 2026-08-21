import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/330_bloco_522_financial_guards.sql'),
  'utf8',
)

describe('migration 330 — guards financeiros forward do Bloco 522', () => {
  it('bloqueia os overloads históricos de emissão de Granito sem apagar histórico', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_invoice_from_granite_bls(')
    expect(migration).toContain('p_issue_now BOOLEAN')
    expect(migration).toMatch(/RAISE EXCEPTION[^;]*Granito[^;]*faturamento/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.create_invoice_from_granite_bls\(UUID\[\], BIGINT, DATE, TEXT, UUID\)\s+FROM PUBLIC, anon, authenticated;/)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.create_invoice_from_granite_bls\(UUID\[\], BIGINT, DATE, TEXT, BOOLEAN, UUID\)\s+FROM PUBLIC, anon, authenticated;/)
  })

  it('impede que atualização futura do Granito volte a ready_for_billing', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.guard_granite_financial_status()')
    expect(migration).toContain("NEW.charge_status := 'calculated'")
    expect(migration).toContain('DROP TRIGGER IF EXISTS guard_granite_financial_status_on_change')
    expect(migration).toContain('CREATE TRIGGER guard_granite_financial_status_on_change')
  })
})
