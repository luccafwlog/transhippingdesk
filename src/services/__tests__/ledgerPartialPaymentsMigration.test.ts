import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger partial payments migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260612162000_register_ledger_partial_payments.sql'),
    'utf8',
  )

  it('keeps ledger payment registration atomic while supporting partial payments', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.register_ledger_invoice_payment\b/)
    expect(sql).toContain("v_next_status := CASE WHEN v_remaining_open <= 0.01 THEN 'paid' ELSE 'partially_paid' END")
    expect(sql).toContain("'partially_settled'")
    expect(sql).toContain('v_all_receivable_ids BIGINT[]')
    expect(sql).toContain('l.receivable_id = ANY(v_all_receivable_ids)')
    expect(sql).toContain("event_type, receivable_id, actor, payload")
    expect(sql).not.toContain('Pagamento parcial nao suportado')
  })

  it('still rejects overpayments instead of allocating beyond the open ledger balance', () => {
    expect(sql).toContain('IF p_amount_brl - v_open > 0.01 THEN')
    expect(sql).toContain('excede o saldo em aberto')
  })
})
