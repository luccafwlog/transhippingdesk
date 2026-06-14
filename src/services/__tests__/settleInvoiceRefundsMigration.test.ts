import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260614170000_settle_invoice_refunds.sql'),
  'utf8',
)

describe('baixa de restituicao (pending -> settled)', () => {
  it('lista as restituicoes de uma fatura respeitando a RLS', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_invoice_refunds\(p_invoice_id BIGINT\)/)
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.list_invoice_refunds(BIGINT) TO authenticated')
  })

  it('exige admin e so efetua restituicao pendente', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.settle_invoice_refund\(/)
    expect(sql).toContain('NOT public.is_admin()')
    expect(sql).toContain("v_refund.status <> 'pending'")
    expect(sql).toContain("SET status = 'settled', settled_at = now()")
  })

  it('registra a baixa da restituicao em audit_logs', () => {
    expect(sql).toContain("'invoice_refund', p_refund_id::TEXT, 'status', 'pending', 'settled'")
  })
})
