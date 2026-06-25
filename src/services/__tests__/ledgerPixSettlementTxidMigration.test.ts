import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger PIX settlement TXID migration', () => {
  it('keeps only one PIX TXID settlement row per invoice payment', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/075_ledger_pix_txid_single_settlement_row.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.keep_single_pix_txid_settlement_row\b/)
    expect(sql).toContain("NEW.source = 'pix_extract'")
    expect(sql).toContain('NEW.pix_txid := NULL')
    expect(sql).toContain('l.invoice_id = NEW.invoice_id')
    expect(sql).toContain('l.receivable_id < NEW.receivable_id')
    expect(sql).toMatch(/CREATE TRIGGER trg_keep_single_pix_txid_settlement_row\s+BEFORE INSERT ON public\.ledger_settlements/)
  })
})
