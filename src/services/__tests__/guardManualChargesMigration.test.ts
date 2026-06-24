import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/108_guard_manual_charges_and_clear_pix_on_reversal.sql',
  ),
  'utf8',
)

describe('guard manual charges + clear PIX on reversal migration', () => {
  it('A) bloqueia taxa manual de B/L quando o B/L ja foi faturado/pago', () => {
    // add/update/delete_manual_bl_charge devem checar bls.financial_status.
    const guards = sql.match(
      /COALESCE\(v_(?:bl|row)\.(?:financial_status|bl_financial_status), 'open'\) IN \('invoiced', 'partially_paid', 'paid'\)/g,
    )
    expect(guards).not.toBeNull()
    expect(guards!.length).toBe(3)
  })

  it('B) restringe itens manuais de fatura a status em aberto (issued/overdue/draft)', () => {
    const guards = sql.match(/COALESCE\(v_invoice\.status, 'issued'\) NOT IN \('issued', 'overdue', 'draft'\)/g)
    expect(guards).not.toBeNull()
    expect(guards!.length).toBe(2)
  })

  it('C) estorno local libera o TXID conciliado', () => {
    expect(sql).toMatch(/FUNCTION public\.reverse_invoice_payment\b/)
    expect(sql).toContain('pix_txid = NULL')
    expect(sql).toContain('conciliated_by_extract = false')
  })
})
