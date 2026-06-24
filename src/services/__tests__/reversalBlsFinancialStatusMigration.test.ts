import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/118_fix_bls_financial_status_on_reversal.sql'),
  'utf8',
)

describe('cancelar baixa: bls.financial_status valido', () => {
  it('mapeia bls.financial_status para paid/invoiced (valores do constraint)', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reverse_invoice_payment\b/)
    expect(sql).toMatch(
      /SET financial_status = \(\s*SELECT CASE\s*WHEN COUNT\(\*\) FILTER \(WHERE br\.balance_brl > 0\.01\) = 0 THEN 'paid'\s*ELSE 'invoiced'\s*END/,
    )
  })

  it('nao grava mais os valores invalidos open/partially_paid em bls', () => {
    // 'ELSE open' so existia no bloco de bls (bl_receivables usa THEN 'open').
    expect(sql).not.toContain("ELSE 'open'")
    // 'THEN partially_paid' so existia no bloco de bls (invoices.status usa ELSE 'partially_paid').
    expect(sql).not.toContain("THEN 'partially_paid'")
  })

  it('mantem o guard de admin e justificativa obrigatoria', () => {
    expect(sql).toContain('NOT public.is_admin()')
    expect(sql).toContain('Informe a justificativa para cancelar a baixa.')
  })
})
