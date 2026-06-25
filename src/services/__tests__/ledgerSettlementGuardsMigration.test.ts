import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger settlement guard migration', () => {
  it('enforces one live ledger settlement per receivable and one normalized PIX TXID', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/071_ledger_settlement_uniqueness_guards.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_one_live_receivable\b/)
    expect(sql).toContain('ON public.ledger_settlements(receivable_id)')
    expect(sql).toContain("WHERE source IN ('manual', 'pix_extract')")

    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_settlements_unique_normalized_pix_txid\b/)
    expect(sql).toContain("UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))")
    expect(sql).toContain("WHERE pix_txid IS NOT NULL AND source = 'pix_extract'")
  })
})
