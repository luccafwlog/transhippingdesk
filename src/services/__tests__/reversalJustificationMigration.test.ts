import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260614180000_require_justification_on_payment_reversal.sql'),
  'utf8',
)

describe('cancelar baixa exige justificativa e admin', () => {
  it('recria os dois RPCs de cancelamento de baixa mantendo o is_admin()', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reverse_invoice_payment\b/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reverse_demurrage_payment\b/)
    expect(sql.match(/NOT public\.is_admin\(\)/g)).toHaveLength(2)
  })

  it('bloqueia o cancelamento de baixa sem justificativa nos dois RPCs', () => {
    const guards = sql.match(/NULLIF\(TRIM\(COALESCE\(p_reason, ''\)\), ''\) IS NULL/g)
    expect(guards).not.toBeNull()
    expect(guards!.length).toBe(2)
    expect(sql).toContain('Informe a justificativa para cancelar a baixa.')
  })

  it('grava a justificativa informada no audit_logs (sem fallback generico)', () => {
    expect(sql.match(/TRIM\(p_reason\)/g)).toHaveLength(2)
  })
})
