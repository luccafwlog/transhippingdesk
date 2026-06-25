import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/111_pix_exact_and_manual_overpayment_refunds.sql'),
  'utf8',
)

describe('PIX exato + restituicao de excedente manual', () => {
  it('cria a tabela invoice_refunds com FK em cascata no pagamento', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.invoice_refunds\b/)
    // Ao estornar (DELETE em payments) a restituicao some junto.
    expect(sql).toMatch(/payment_id BIGINT NOT NULL REFERENCES public\.payments\(id\) ON DELETE CASCADE/)
    expect(sql).toContain("CHECK (status IN ('pending', 'settled', 'cancelled'))")
    expect(sql).toContain('ALTER TABLE public.invoice_refunds ENABLE ROW LEVEL SECURITY')
  })

  it('exige valor exato na conciliacao por PIX', () => {
    expect(sql).toContain("COALESCE(p_source, 'manual') = 'pix_extract' AND ABS(p_amount_brl - v_open) > 0.01")
  })

  it('aloca no maximo o saldo aberto e registra o excedente manual como restituicao', () => {
    expect(sql).toContain('v_remaining := ROUND(LEAST(p_amount_brl, v_open)::NUMERIC, 2)')
    expect(sql).toContain("v_excess := ROUND(GREATEST(p_amount_brl - v_open, 0)::NUMERIC, 2)")
    // Excedente so e aceito na baixa manual.
    expect(sql).toContain("v_excess > 0.01 AND COALESCE(p_source, 'manual') <> 'manual'")
    expect(sql).toMatch(/INSERT INTO public\.invoice_refunds[\s\S]*VALUES \(p_invoice_id, v_payment_id, v_excess, 'pending'/)
  })

  it('expoe o valor a restituir no retorno da RPC', () => {
    expect(sql).toContain("'refund_due_brl', v_excess")
  })
})
